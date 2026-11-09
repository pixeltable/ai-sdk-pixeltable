import { configurationError, errorFromResponse, PixeltableError } from './errors';
import { collectSecrets, isRecord } from './redact';
import {
  API_KEY_ENV,
  DEFAULT_TIMEOUT_MS,
  SERVICE_URL_ENV,
  type PixeltableCallResult,
  type PixeltableRequestOptions,
  type PixeltableToolsOptions,
} from './types';

export interface ResolvedPixeltableConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  headers: Record<string, string>;
  fetch: typeof fetch;
  secrets: string[];
}

export function resolveConfig(options: PixeltableToolsOptions = {}): ResolvedPixeltableConfig {
  const baseUrl = trimToUndefined(options.baseUrl) ?? trimToUndefined(process.env[SERVICE_URL_ENV]);
  if (!baseUrl) {
    throw configurationError(
      `Pixeltable service URL is not set. Pass baseUrl to pixeltableTools() or set ${SERVICE_URL_ENV}.`,
    );
  }

  const apiKey = trimToUndefined(options.apiKey) ?? trimToUndefined(process.env[API_KEY_ENV]);
  const secrets = collectSecrets(apiKey);

  return {
    baseUrl: stripTrailingSlash(baseUrl),
    apiKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    headers: options.headers ?? {},
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    secrets,
  };
}

export async function callPixeltable(
  options: PixeltableToolsOptions,
  request: PixeltableRequestOptions,
): Promise<PixeltableCallResult> {
  const config = resolveConfig(options);
  const url = buildUrl(
    config.baseUrl,
    request.path,
    request.method === 'GET' ? request.query : undefined,
  );
  const headers = new Headers(config.headers);
  headers.set('Accept', 'application/json');
  if (config.apiKey) {
    headers.set('X-api-key', config.apiKey);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    signal: mergeAbort(request.signal, config.timeoutMs),
  };

  if (request.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(request.body ?? {});
  }

  let response: Response;
  try {
    response = await config.fetch(url, init);
  } catch (error) {
    if (error instanceof PixeltableError) throw error;
    const message = error instanceof Error ? error.message : 'Pixeltable request failed';
    throw new PixeltableError(
      message,
      { errorCode: 'NETWORK_ERROR', retryable: true },
      config.secrets,
    );
  }

  if (!response.ok) {
    throw errorFromResponse(
      response.status,
      await readBody(response),
      response.headers,
      config.secrets,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!isJsonContentType(contentType)) {
    throw new PixeltableError(
      `Pixeltable route ${request.method} ${request.path} returned ${contentType || 'a non-JSON body'}; this tool only supports JSON query routes, not FileResponse media.`,
      { status: response.status, errorCode: 'UNSUPPORTED_RESPONSE', retryable: false },
      config.secrets,
    );
  }

  return {
    path: request.path,
    method: request.method,
    result: await readBody(response),
  };
}

export async function getOpenApiDocument(options: PixeltableToolsOptions): Promise<unknown> {
  const { result } = await callPixeltable(options, { method: 'GET', path: '/openapi.json' });
  if (!isRecord(result)) {
    throw new PixeltableError('Pixeltable /openapi.json did not return an object', {
      errorCode: 'INVALID_OPENAPI',
      retryable: false,
      detail: result,
    });
  }
  return result;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${stripTrailingSlash(baseUrl)}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, stringifyQueryValue(value));
    }
  }
  return url.href;
}

function stringifyQueryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('application/json');
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mergeAbort(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  signal.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
