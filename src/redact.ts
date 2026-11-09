const SECRET_HEADER_NAMES = new Set(['x-api-key', 'authorization', 'cookie', 'set-cookie']);

export function collectSecrets(apiKey?: string): string[] {
  const secrets = new Set<string>();
  addSecret(secrets, apiKey);
  addSecret(secrets, process.env.PIXELTABLE_API_KEY);
  return [...secrets];
}

function addSecret(secrets: Set<string>, value: string | undefined): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length > 0) secrets.add(trimmed);
}

export function redact(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function redactDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_HEADER_NAMES.has(key.toLowerCase())) {
        out[key] = '[redacted]';
      } else {
        out[key] = redactDeep(item, secrets);
      }
    }
    return out;
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
