import { tool } from 'ai';
import { z } from 'zod';
import { callPixeltable } from './client';
import { configurationError } from './errors';
import { listQueryRoutes } from './openapi';
import { isRecord } from './redact';
import {
  DEFAULT_SEARCH_PATH,
  DEFAULT_SEARCH_QUERY_PARAMETER,
  type PixeltableCallResult,
  type PixeltableHttpMethod,
  type PixeltableToolsOptions,
} from './types';

const jsonObject = z.record(z.string(), z.unknown());

const searchInputSchema = z.object({
  query: z
    .string()
    .describe('Natural-language search string to embed and compare against the index'),
  path: z
    .string()
    .optional()
    .describe(
      'Query route path to call. Defaults to /search, or searchPath from pixeltableTools()',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum rows to return, sent as limit when the route declares that parameter'),
  arguments: jsonObject
    .optional()
    .describe('Additional JSON fields the @pxt.query function accepts, such as filters'),
});

const queryInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      'Query route path from app.py, for example /lookup. Call listRoutes if you do not know the path',
    ),
  arguments: jsonObject
    .optional()
    .describe('JSON body (POST) or query-string parameters (GET) matching the route schema'),
  method: z
    .enum(['GET', 'POST'])
    .optional()
    .describe('HTTP method. Pixeltable add_query_route defaults to POST'),
});

const listRoutesInputSchema = z.object({});

export function pixeltableSearch(options: PixeltableToolsOptions = {}) {
  return tool({
    description:
      'Search a Pixeltable embedding index over HTTP. POSTs JSON to a query route (default /search with query_text) that your Pixeltable app.py must expose via FastAPIRouter.add_query_route wrapping a @pxt.query that uses similarity(). Returns the JSON the service returned, typically { rows: [...] }.',
    inputSchema: searchInputSchema,
    execute: async ({ query, path, limit, arguments: extra }) => {
      const searchPath = path?.trim() || options.searchPath || DEFAULT_SEARCH_PATH;
      const queryParameter = options.searchQueryParameter ?? DEFAULT_SEARCH_QUERY_PARAMETER;
      const method: PixeltableHttpMethod = options.searchMethod ?? 'POST';
      const body: Record<string, unknown> = { ...(extra ?? {}) };
      body[queryParameter] = query;
      if (limit !== undefined) body.limit = limit;
      return callRoute(options, method, searchPath, body);
    },
  });
}

export function pixeltableQuery(options: PixeltableToolsOptions = {}) {
  return tool({
    description:
      'Call a Pixeltable query HTTP route exposed by FastAPIRouter.add_query_route in the user app.py. Use for structured lookups and table queries. Pass the route path and the JSON fields the @pxt.query function expects. Use listRoutes to discover paths from /openapi.json.',
    inputSchema: queryInputSchema,
    execute: async ({ path, arguments: extra, method }) => {
      const queryPath = path?.trim() || options.queryPath;
      if (!queryPath) {
        throw configurationError(
          'Query route path is not set. Pass path to the query tool, or queryPath to pixeltableTools(). Call listRoutes to discover query routes from the service OpenAPI.',
        );
      }
      const httpMethod: PixeltableHttpMethod = method ?? 'POST';
      return callRoute(options, httpMethod, queryPath, extra ?? {});
    },
  });
}

export function pixeltableListRoutes(options: PixeltableToolsOptions = {}) {
  return tool({
    description:
      'List query and search HTTP routes on the Pixeltable service by downloading /openapi.json. Use this when you do not know the search or query path. Pixeltable query routes usually have operationIds starting with query_. Insert, update, and delete routes are omitted.',
    inputSchema: listRoutesInputSchema,
    execute: async () => {
      const routes = await listQueryRoutes(options);
      return { routes };
    },
  });
}

/** All Pixeltable tools, keyed by name, ready to pass to `generateText` or `streamText`. */
export function pixeltableTools(options: PixeltableToolsOptions = {}) {
  return {
    search: pixeltableSearch(options),
    query: pixeltableQuery(options),
    listRoutes: pixeltableListRoutes(options),
  };
}

export type PixeltableTools = ReturnType<typeof pixeltableTools>;

async function callRoute(
  options: PixeltableToolsOptions,
  method: PixeltableHttpMethod,
  path: string,
  fields: Record<string, unknown>,
): Promise<PixeltableCallResult> {
  if (!isRecord(fields)) {
    throw configurationError('Route arguments must be a JSON object');
  }
  if (method === 'GET') {
    return callPixeltable(options, { method, path, query: fields });
  }
  return callPixeltable(options, { method, path, body: fields });
}
