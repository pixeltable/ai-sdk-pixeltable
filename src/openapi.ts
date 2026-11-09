import { getOpenApiDocument } from './client';
import { isRecord } from './redact';
import type { PixeltableHttpMethod, PixeltableRouteInfo, PixeltableToolsOptions } from './types';

const SKIP_PATHS = new Set(['/health', '/docs', '/redoc', '/openapi.json', '/favicon.ico']);
const WRITE_OPERATION_PREFIXES = ['insert_', 'update_', 'delete_', 'compute_'];

export async function listQueryRoutes(
  options: PixeltableToolsOptions,
): Promise<PixeltableRouteInfo[]> {
  const spec = await getOpenApiDocument(options);
  return discoverQueryRoutes(spec);
}

export function discoverQueryRoutes(spec: unknown): PixeltableRouteInfo[] {
  if (!isRecord(spec) || !isRecord(spec.paths)) return [];

  const routes: PixeltableRouteInfo[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!isRecord(pathItem) || shouldSkipPath(path)) continue;
    for (const method of ['get', 'post'] as const) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      if (isMultipart(operation) || isWriteOperation(operation)) continue;

      const operationId = optionalString(operation.operationId);
      const summary = optionalString(operation.summary);
      const description = optionalString(operation.description);
      const parameters = collectParameters(spec, operation);
      const kind = classifyRoute(path, operationId, summary, description, parameters);
      if (kind === 'other' && !isQueryOperation(operationId)) continue;

      routes.push({
        path,
        method: method.toUpperCase() as PixeltableHttpMethod,
        operationId,
        summary,
        description,
        parameters,
        kind,
      });
    }
  }
  return routes;
}

function shouldSkipPath(path: string): boolean {
  const bare = path.replace(/\/+$/, '') || '/';
  if (SKIP_PATHS.has(bare)) return true;
  if (bare.includes('/_pxt')) return true;
  if (/\/jobs\/\{/.test(bare) || /\{job_id\}/.test(bare)) return true;
  return false;
}

function isWriteOperation(operation: Record<string, unknown>): boolean {
  const operationId = optionalString(operation.operationId) ?? '';
  return WRITE_OPERATION_PREFIXES.some((prefix) => operationId.startsWith(prefix));
}

function isQueryOperation(operationId: string | undefined): boolean {
  return (operationId ?? '').startsWith('query_');
}

function classifyRoute(
  path: string,
  operationId: string | undefined,
  summary: string | undefined,
  description: string | undefined,
  parameters: string[],
): PixeltableRouteInfo['kind'] {
  const haystack =
    `${path} ${operationId ?? ''} ${summary ?? ''} ${description ?? ''}`.toLowerCase();
  const looksLikeSearch =
    haystack.includes('search') ||
    haystack.includes('similarity') ||
    haystack.includes('embedding') ||
    parameters.includes('query_text');
  if (looksLikeSearch) return 'search';
  if (isQueryOperation(operationId) || haystack.includes('query') || haystack.includes('lookup')) {
    return 'query';
  }
  return 'other';
}

function collectParameters(spec: unknown, operation: Record<string, unknown>): string[] {
  const names = new Set<string>();

  if (Array.isArray(operation.parameters)) {
    for (const parameter of operation.parameters) {
      if (isRecord(parameter) && parameter.in === 'query' && typeof parameter.name === 'string') {
        names.add(parameter.name);
      }
    }
  }

  const requestBody = isRecord(operation.requestBody) ? operation.requestBody : undefined;
  const content = isRecord(requestBody?.content) ? requestBody.content : undefined;
  const json = isRecord(content?.['application/json']) ? content['application/json'] : undefined;
  const schema = json?.schema;
  for (const name of schemaPropertyNames(spec, schema)) names.add(name);

  return [...names];
}

function schemaPropertyNames(spec: unknown, schema: unknown): string[] {
  const resolved = resolveRef(spec, schema);
  if (!resolved) return [];
  if (isRecord(resolved.properties)) return Object.keys(resolved.properties);
  if (Array.isArray(resolved.allOf)) {
    const names = new Set<string>();
    for (const item of resolved.allOf) {
      for (const name of schemaPropertyNames(spec, item)) names.add(name);
    }
    return [...names];
  }
  return [];
}

function resolveRef(spec: unknown, schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined;
  if (typeof schema.$ref !== 'string') return schema;

  const path = schema.$ref.replace(/^#\//, '').split('/');
  let current: unknown = spec;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return isRecord(current) ? current : undefined;
}

function isMultipart(operation: Record<string, unknown>): boolean {
  const requestBody = isRecord(operation.requestBody) ? operation.requestBody : undefined;
  const content = isRecord(requestBody?.content) ? requestBody.content : undefined;
  return (
    content != null &&
    ('multipart/form-data' in content || 'application/x-www-form-urlencoded' in content)
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
