import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PixeltableError, pixeltableSearch } from '../src/index';
import {
  createMockFetch,
  executeTool,
  jsonResponse,
  options,
  TEST_API_KEY,
  textResponse,
} from './helpers';

test('maps Pixeltable runtime errors from detail.error_code, message, and retryable', async () => {
  const { fetch } = createMockFetch(() =>
    jsonResponse(
      {
        detail: {
          error_code: 'JOB_REFUSED',
          message: 'too many background jobs',
          retryable: true,
          retry_after: 5,
        },
      },
      503,
      { 'retry-after': '5' },
    ),
  );

  await assert.rejects(
    executeTool(pixeltableSearch(options(fetch)), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.status, 503);
      assert.equal(error.errorCode, 'JOB_REFUSED');
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfter, 5);
      assert.equal(error.message, 'too many background jobs');
      return true;
    },
  );
});

test('maps a string detail as a missing-row 404', async () => {
  const { fetch } = createMockFetch(() => jsonResponse({ detail: 'query returned no rows' }, 404));
  await assert.rejects(
    executeTool(pixeltableSearch(options(fetch)), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.status, 404);
      assert.equal(error.errorCode, 'NOT_FOUND');
      assert.equal(error.retryable, false);
      assert.equal(error.message, 'query returned no rows');
      return true;
    },
  );
});

test('maps FastAPI validation arrays without leaking request secrets', async () => {
  const { fetch } = createMockFetch(() =>
    jsonResponse(
      {
        detail: [
          {
            type: 'missing',
            loc: ['body', 'query_text'],
            msg: 'Field required',
            input: { api_key: TEST_API_KEY },
          },
        ],
      },
      422,
    ),
  );

  await assert.rejects(
    executeTool(pixeltableSearch(options(fetch, { apiKey: TEST_API_KEY })), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.errorCode, 'VALIDATION_ERROR');
      assert.match(error.message, /query_text: Field required/);
      assert.doesNotMatch(error.message, new RegExp(TEST_API_KEY));
      assert.doesNotMatch(JSON.stringify(error.detail), new RegExp(TEST_API_KEY));
      return true;
    },
  );
});

test('maps Cloud gateway 401, 403, 404, 429, and 503 when detail is not a Pixeltable object', async () => {
  const cases: Array<{ status: number; errorCode: string; retryable: boolean; pattern: RegExp }> = [
    {
      status: 401,
      errorCode: 'UNAUTHORIZED',
      retryable: false,
      pattern: /invalid Pixeltable API key/,
    },
    { status: 403, errorCode: 'FORBIDDEN', retryable: false, pattern: /does not have access/ },
    { status: 404, errorCode: 'NOT_FOUND', retryable: false, pattern: /not found/ },
    { status: 429, errorCode: 'RATE_LIMITED', retryable: true, pattern: /rate limited/ },
    { status: 503, errorCode: 'SERVICE_UNAVAILABLE', retryable: true, pattern: /not running/ },
  ];

  for (const { status, errorCode, retryable, pattern } of cases) {
    const { fetch } = createMockFetch(() => jsonResponse({}, status, { 'retry-after': '2' }));
    await assert.rejects(
      executeTool(pixeltableSearch(options(fetch)), { query: 'q' }),
      (error: unknown) => {
        assert.ok(error instanceof PixeltableError);
        assert.equal(error.status, status);
        assert.equal(error.errorCode, errorCode);
        assert.equal(error.retryable, retryable);
        if (status === 429 || status === 503) assert.equal(error.retryAfter, 2);
        assert.match(error.message, pattern);
        return true;
      },
    );
  }
});

test('redacts API keys echoed by the service from error messages', async () => {
  const { fetch } = createMockFetch(() =>
    jsonResponse(
      {
        detail: {
          error_code: 'UNAUTHORIZED',
          message: `invalid key ${TEST_API_KEY}`,
          retryable: false,
        },
      },
      401,
    ),
  );

  await assert.rejects(
    executeTool(pixeltableSearch(options(fetch, { apiKey: TEST_API_KEY })), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.doesNotMatch(error.message, new RegExp(TEST_API_KEY));
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(TEST_API_KEY));
      return true;
    },
  );
});

test('non-JSON error bodies still become PixeltableError without leaking the key', async () => {
  const { fetch } = createMockFetch(() => textResponse(`denied ${TEST_API_KEY}`, 401));
  await assert.rejects(
    executeTool(pixeltableSearch(options(fetch, { apiKey: TEST_API_KEY })), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, new RegExp(TEST_API_KEY));
      return true;
    },
  );
});
