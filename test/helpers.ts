import type { PixeltableToolsOptions } from '../src/index';

export const SERVICE_URL = 'https://example.svc.pxt.run';
export const TEST_API_KEY = 'test-pixeltable-key';

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(body: string, status: number, contentType = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

export function createMockFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = toUrl(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    }
    const call: FetchCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchFn, calls };
}

export function options(
  fetchImpl: typeof globalThis.fetch,
  extra: PixeltableToolsOptions = {},
): PixeltableToolsOptions {
  return { baseUrl: SERVICE_URL, fetch: fetchImpl, ...extra };
}

export async function executeTool<T>(
  toolInstance: { execute?: unknown },
  input: unknown,
): Promise<T> {
  const execute = toolInstance.execute as
    ((input: unknown, options: unknown) => Promise<T>) | undefined;
  if (!execute) throw new Error('tool has no execute function');
  return execute(input, { toolCallId: 'test', messages: [] });
}

export function sampleOpenApi() {
  return {
    openapi: '3.1.0',
    info: { title: 'rag', version: '0.1.0' },
    paths: {
      '/search': {
        post: {
          operationId: 'query_search',
          summary: 'Similarity search over document chunks',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SearchRequest',
                },
              },
            },
          },
        },
      },
      '/lookup': {
        get: {
          operationId: 'query_lookup',
          summary: 'Look up a row by id',
          parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'integer' } }],
        },
      },
      '/docs': {
        post: {
          operationId: 'insert_docs',
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { document: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: { operationId: 'health' },
      },
      '/jobs/{job_id}': {
        get: { operationId: 'pxt_serve_job_status' },
      },
    },
    components: {
      schemas: {
        SearchRequest: {
          type: 'object',
          properties: {
            query_text: { type: 'string', title: 'Query Text' },
            limit: { type: 'integer', default: 10 },
          },
          required: ['query_text'],
        },
      },
    },
  };
}

function toUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
