import { isRecord, redact, redactDeep } from './redact';
import type { PixeltableErrorInit } from './types';

export class PixeltableError extends Error {
  readonly name = 'PixeltableError';
  readonly status?: number;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly detail?: unknown;

  constructor(message: string, init: PixeltableErrorInit = {}, secrets: string[] = []) {
    super(redact(message, secrets));
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.retryable = init.retryable;
    this.retryAfter = init.retryAfter;
    this.detail = redactDeep(init.detail, secrets);
  }
}

export function configurationError(message: string): PixeltableError {
  return new PixeltableError(message, { errorCode: 'CONFIGURATION_ERROR', retryable: false });
}

export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
  secrets: string[],
): PixeltableError {
  const retryAfterHeader = parseRetryAfter(headers.get('retry-after'));
  const detail = isRecord(body) ? body.detail : undefined;

  if (isPixeltableDetail(detail)) {
    const retryAfter =
      typeof detail.retry_after === 'number' ? detail.retry_after : retryAfterHeader;
    const message =
      typeof detail.message === 'string' && detail.message.trim().length > 0
        ? detail.message
        : fallbackMessage(status);
    return new PixeltableError(
      message,
      {
        status,
        errorCode: String(detail.error_code),
        retryable: Boolean(detail.retryable),
        retryAfter,
        detail,
      },
      secrets,
    );
  }

  if (typeof detail === 'string') {
    return new PixeltableError(
      detail,
      {
        status,
        errorCode: status === 404 ? 'NOT_FOUND' : undefined,
        retryable: false,
        retryAfter: retryAfterHeader,
        detail,
      },
      secrets,
    );
  }

  if (Array.isArray(detail)) {
    return new PixeltableError(
      formatValidationDetail(detail),
      {
        status,
        errorCode: 'VALIDATION_ERROR',
        retryable: false,
        retryAfter: retryAfterHeader,
        detail,
      },
      secrets,
    );
  }

  return new PixeltableError(
    fallbackMessage(status),
    {
      status,
      errorCode: gatewayErrorCode(status),
      retryable: status === 429 || status === 503,
      retryAfter: retryAfterHeader,
      detail: detail ?? body,
    },
    secrets,
  );
}

function isPixeltableDetail(
  detail: unknown,
): detail is { error_code: string; message?: string; retryable?: boolean; retry_after?: number } {
  return isRecord(detail) && typeof detail.error_code === 'string';
}

function formatValidationDetail(detail: unknown[]): string {
  const parts = detail.map((item) => {
    if (!isRecord(item)) return String(item);
    const loc = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
    const msg = typeof item.msg === 'string' ? item.msg : 'Invalid request';
    return loc ? `${loc}: ${msg}` : msg;
  });
  return parts.length > 0
    ? `Request validation failed: ${parts.join('; ')}`
    : 'Request validation failed';
}

function gatewayErrorCode(status: number): string | undefined {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return undefined;
  }
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Missing or invalid Pixeltable API key';
    case 403:
      return 'API key does not have access to this Pixeltable service';
    case 404:
      return 'Pixeltable service or route was not found';
    case 429:
      return 'Pixeltable API key is rate limited';
    case 503:
      return 'Pixeltable service is not running';
    default:
      return `Pixeltable service returned HTTP ${status}`;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : undefined;
}
