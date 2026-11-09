import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asSchema } from 'ai';
import {
  PixeltableError,
  pixeltableListRoutes,
  pixeltableQuery,
  pixeltableSearch,
  pixeltableTools,
} from '../src/index';
import {
  createMockFetch,
  executeTool,
  jsonResponse,
  options,
  sampleOpenApi,
  SERVICE_URL,
} from './helpers';

test('pixeltableTools exposes search, query, and listRoutes', () => {
  assert.deepEqual(Object.keys(pixeltableTools()).sort(), ['listRoutes', 'query', 'search']);
});

test('search POSTs query_text to /search by default', async () => {
  const { fetch, calls } = createMockFetch(() =>
    jsonResponse({
      rows: [{ text: 'Refunds are issued within 30 days.', score: 0.91 }],
    }),
  );

  const result = await executeTool(pixeltableSearch(options(fetch)), {
    query: 'refund policy',
    limit: 5,
  });

  assert.deepEqual(result, {
    path: '/search',
    method: 'POST',
    result: { rows: [{ text: 'Refunds are issued within 30 days.', score: 0.91 }] },
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/search`);
  assert.deepEqual(calls[0]?.body, { query_text: 'refund policy', limit: 5 });
});

test('search uses searchPath from the factory when the tool input omits path', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { searchPath: '/kb/search' })), {
    query: 'refunds',
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/kb/search`);
});

test('search accepts a path override, extra arguments, and a custom query parameter', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse({ rows: [] }));
  await executeTool(pixeltableSearch(options(fetch, { searchQueryParameter: 'query' })), {
    query: 'handbook',
    path: '/chunks/search',
    arguments: { category: 'legal' },
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/chunks/search`);
  assert.deepEqual(calls[0]?.body, { query: 'handbook', category: 'legal' });
});

test('query POSTs arguments to the given path', async () => {
  const { fetch, calls } = createMockFetch(() =>
    jsonResponse({ id: 42, name: 'Alice', email: 'alice@example.com' }),
  );
  const result = await executeTool(pixeltableQuery(options(fetch)), {
    path: '/lookup',
    arguments: { id: 42 },
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/lookup`);
  assert.equal(calls[0]?.method, 'POST');
  assert.deepEqual(calls[0]?.body, { id: 42 });
  assert.deepEqual(result, {
    path: '/lookup',
    method: 'POST',
    result: { id: 42, name: 'Alice', email: 'alice@example.com' },
  });
});

test('query GET sends arguments as query-string parameters', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse({ id: 42, name: 'Alice' }));
  await executeTool(pixeltableQuery(options(fetch)), {
    path: '/lookup',
    method: 'GET',
    arguments: { id: 42 },
  });
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url, `${SERVICE_URL}/lookup?id=42`);
  assert.equal(calls[0]?.body, undefined);
});

test('query uses queryPath when the tool input omits path', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse(1234));
  await executeTool(pixeltableQuery(options(fetch, { queryPath: '/user-count' })), {
    arguments: { min_age: 21 },
  });
  assert.equal(calls[0]?.url, `${SERVICE_URL}/user-count`);
  assert.deepEqual(calls[0]?.body, { min_age: 21 });
});

test('query requires a path when queryPath is not configured', async () => {
  const { fetch } = createMockFetch(() => jsonResponse({}));
  await assert.rejects(
    executeTool(pixeltableQuery(options(fetch)), { arguments: { id: 1 } }),
    (error: unknown) => {
      assert.ok(error instanceof PixeltableError);
      assert.equal(error.errorCode, 'CONFIGURATION_ERROR');
      assert.match(error.message, /listRoutes/);
      return true;
    },
  );
});

test('listRoutes reads OpenAPI and returns query/search routes only', async () => {
  const { fetch, calls } = createMockFetch(() => jsonResponse(sampleOpenApi()));
  const result = await executeTool<{
    routes: Array<{ path: string; kind: string; parameters: string[] }>;
  }>(pixeltableListRoutes(options(fetch)), {});

  assert.equal(calls[0]?.url, `${SERVICE_URL}/openapi.json`);
  assert.equal(calls[0]?.method, 'GET');
  assert.deepEqual(
    result.routes.map((route) => ({
      path: route.path,
      kind: route.kind,
      parameters: route.parameters,
    })),
    [
      { path: '/search', kind: 'search', parameters: ['query_text', 'limit'] },
      { path: '/lookup', kind: 'query', parameters: ['id'] },
    ],
  );
});

test('search input schema requires query and accepts optional limit', async () => {
  const schema = asSchema(pixeltableSearch().inputSchema);
  assert.equal((await schema.validate!({ query: 'refunds' })).success, true);
  assert.equal((await schema.validate!({ query: 'refunds', limit: 3 })).success, true);
  assert.equal((await schema.validate!({})).success, false);
});

test('query input schema accepts path and JSON arguments', async () => {
  const schema = asSchema(pixeltableQuery().inputSchema);
  assert.equal((await schema.validate!({ path: '/lookup', arguments: { id: 1 } })).success, true);
  assert.equal((await schema.validate!({ path: '/lookup', method: 'PATCH' })).success, false);
});
