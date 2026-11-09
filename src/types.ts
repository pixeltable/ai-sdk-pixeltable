/**
 * Options shared by `pixeltableTools()` and the individual tool factories.
 *
 * The tools call a Pixeltable HTTP service (`pxt service` locally, or Pixeltable Cloud)
 * using the query routes your `app.py` exposes.
 */
export interface PixeltableToolsOptions {
  /**
   * Full Pixeltable service endpoint, including scheme and any path prefix.
   * Defaults to `PIXELTABLE_SERVICE_URL`.
   */
  baseUrl?: string;
  /**
   * Pixeltable Cloud API key, sent as `X-api-key`.
   * Defaults to `PIXELTABLE_API_KEY`. Omit for local services, which typically need no key.
   */
  apiKey?: string;
  /**
   * Default search route. Pixeltable's documented RAG apps expose `POST /search`.
   * Default: `/search`.
   */
  searchPath?: string;
  /**
   * JSON body field that carries the search string on the search route.
   * Pixeltable's serving and RAG docs use `query_text`. Default: `query_text`.
   */
  searchQueryParameter?: string;
  /**
   * Default query route used when the query tool is called without `path`.
   * There is no universal Pixeltable `/query` route — set this to an `add_query_route` path from your app.
   */
  queryPath?: string;
  /**
   * HTTP method for the default search route. Pixeltable query routes default to POST. Default: `POST`.
   */
  searchMethod?: PixeltableHttpMethod;
  /** Request timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
  /** Extra headers merged into every request. Do not put secrets in logs of these. */
  headers?: Record<string, string>;
  /** Override `fetch`. Tests inject a mock; production uses global `fetch`. */
  fetch?: typeof fetch;
}

export type PixeltableHttpMethod = 'GET' | 'POST';

export interface PixeltableRequestOptions {
  method: PixeltableHttpMethod;
  path: string;
  /** JSON body for POST. Ignored for GET. */
  body?: Record<string, unknown>;
  /** Query-string parameters for GET (and optional extra params on POST). */
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface PixeltableCallResult {
  path: string;
  method: PixeltableHttpMethod;
  result: unknown;
}

export interface PixeltableRouteInfo {
  path: string;
  method: PixeltableHttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters: string[];
  kind: 'search' | 'query' | 'other';
}

export interface PixeltableErrorInit {
  status?: number;
  errorCode?: string;
  retryable?: boolean;
  retryAfter?: number;
  detail?: unknown;
}

export const DEFAULT_SEARCH_PATH = '/search';
export const DEFAULT_SEARCH_QUERY_PARAMETER = 'query_text';
export const DEFAULT_TIMEOUT_MS = 30_000;

export const SERVICE_URL_ENV = 'PIXELTABLE_SERVICE_URL';
export const API_KEY_ENV = 'PIXELTABLE_API_KEY';
