import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { PixeltableError, pixeltableQuery, pixeltableSearch } from '../src/index';
import {
  createMockFetch,
  executeTool,
  jsonResponse,
  options,
  SERVICE_URL,
  TEST_API_KEY,
  textResponse,
} from './helpers';

const originalServiceUrl = process.env.PIXELTABLE_SERVICE_URL;
const originalApiKey = process.env.PIXELTABLE_API_KEY;

afterEach(() => {
  if (originalServiceUrl === undefined) delete process.env.PIXELTABLE_SERVICE_URL;
  else process.env.PIXELTABLE_SERVICE_URL = originalServiceUrl;
  if (originalApiKey === undefined) delete process.env.PIXELTABLE_API_KEY;
  else process.env.PIXELTABLE_API_KEY = originalApiKey;
});

test('sends X-api-key when an API key is provided and never sends Authorization', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { apiKey: TEST_API_KEY })), {
    query: 'refund policy',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers['x-api-key'], TEST_API_KEY);
  assert.equal(calls[0]?.headers.authorization, undefined);
  assert.equal(calls[0]?.url, `${SERVICE_URL}/search`);
  assert.equal(calls[0]?.method, 'POST');
});

test('omits X-api-key and Authorization when no API key is set', async () => {
  delete process.env.PIXELTABLE_API_KEY;
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch)), { query: 'refund policy' });

  assert.equal(calls[0]?.headers['x-api-key'], undefined);
  assert.equal(calls[0]?.headers.authorization, undefined);
});

test('reads PIXELTABLE_API_KEY from the environment when apiKey is omitted', async () => {
  process.env.PIXELTABLE_API_KEY = TEST_API_KEY;
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch)), { query: 'refund policy' });
  assert.equal(calls[0]?.headers['x-api-key'], TEST_API_KEY);
});

test('treats a blank API key as absent', async () => {
  process.env.PIXELTABLE_API_KEY = '   ';
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { apiKey: '' })), { query: 'q' });
  assert.equal(calls[0]?.headers['x-api-key'], undefined);
});

test('prefers the apiKey option over PIXELTABLE_API_KEY', async () => {
  process.env.PIXELTABLE_API_KEY = 'env-key';
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { apiKey: TEST_API_KEY })), { query: 'q' });
  assert.equal(calls[0]?.headers['x-api-key'], TEST_API_KEY);
});

test('strips a trailing slash from baseUrl', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { baseUrl: `${SERVICE_URL}/` })), {
    query: 'q',
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/search`);
});

test('reads PIXELTABLE_SERVICE_URL when baseUrl is omitted', async () => {
  process.env.PIXELTABLE_SERVICE_URL = 'https://env.example/svc';
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch({ fetch }), { query: 'q' });
  assert.equal(calls[0]?.url, 'https://env.example/svc/search');
});

test('throws a configuration error when the service URL is missing', async () => {
  delete process.env.PIXELTABLE_SERVICE_URL;
  const { fetch } = createMockFetch(() => jsonResponse({ rows: [] }));
  await assert.rejects(
    executeTool(pixeltableSearch({ fetch }), { query: 'q' }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.errorCode, 'CONFIGURATION_ERROR');
      assert.match(error.message, /PIXELTABLE_SERVICE_URL/);
      return true;
    },
  );
});

test('rejects binary FileResponse bodies', async () => {
  const { fetch } = createMockFetch(() => textResponse('not-json', 200, 'image/jpeg'));
  await assert.rejects(
    executeTool(pixeltableQuery(options(fetch)), { path: '/thumbnail', arguments: { id: 1 } }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.errorCode, 'UNSUPPORTED_RESPONSE');
      return true;
    },
  );
});
