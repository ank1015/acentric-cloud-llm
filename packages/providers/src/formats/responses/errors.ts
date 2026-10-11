import { LlmError, type LlmErrorKind, type Usage } from '@acentric-llm/contracts';
import { isRecord } from '../../shared.ts';
import { parseRetryAfter, type HttpAnswer } from '../../transport.ts';
import type { ResponsesProfile, ResponsesProvider } from './profile.ts';

const POLICY_CODES = new Set([
  'bio_policy',
  'cyber_policy',
  'misalignment_policy_violation',
  'image_content_policy_violation',
]);

const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

/** Error codes shared by HTTP errors and failed responses. */
function kindForCode(code: string | undefined, type: string | undefined): LlmErrorKind | undefined {
  if (code === undefined && type === undefined) return undefined;
  if (code && POLICY_CODES.has(code)) return 'policy_violation';
  if ((code && QUOTA_CODES.has(code)) || type === 'insufficient_quota') return 'quota_exceeded';
  switch (code) {
    case 'context_length_exceeded':
      return 'context_overflow';
    case 'previous_response_not_found':
      return 'not_found';
    case 'rate_limit_exceeded':
    case 'slow_down':
      return 'rate_limited';
    case 'server_is_overloaded':
      return 'overloaded';
    case 'server_error':
      return 'provider_error';
    case 'vector_store_timeout':
      return 'timeout';
    default:
      return undefined;
  }
}

function kindForStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 500) return 'provider_error';
  return 'invalid_request';
}

interface ErrorFields {
  readonly message?: string;
  readonly code?: string;
  readonly type?: string;
  readonly param?: string;
}

/**
 * The error object of an answer. Besides the format's `{ error: {...} }`, some
 * providers answer FastAPI's `{ detail }`: a message, an error object, or a
 * list of validation errors.
 */
function readError(body: unknown): { fields: ErrorFields; detail: unknown } {
  if (isRecord(body) && body.error === undefined && body.detail !== undefined) {
    const detail = body.detail;
    if (typeof detail === 'string') return { fields: { message: detail }, detail };
    if (Array.isArray(detail)) return { fields: validationErrors(detail), detail };
    return { fields: errorFields(detail), detail };
  }
  const detail = isRecord(body) && body.error !== undefined ? body.error : body;
  return { fields: errorFields(detail), detail };
}

function errorFields(detail: unknown): ErrorFields {
  if (!isRecord(detail)) return {};
  const code = detail.code;
  return {
    ...(typeof detail.message === 'string' ? { message: detail.message } : {}),
    ...(typeof code === 'string' || typeof code === 'number' ? { code: String(code) } : {}),
    ...(typeof detail.type === 'string' ? { type: detail.type } : {}),
    ...(typeof detail.param === 'string' ? { param: detail.param } : {}),
  };
}

/** FastAPI validation errors: `[{ loc: ["body", "temperature"], msg }]`. */
function validationErrors(list: readonly unknown[]): ErrorFields {
  const entries = list.filter(isRecord).map((entry) => {
    const loc = Array.isArray(entry.loc) ? entry.loc.filter((part) => part !== 'body') : [];
    return { param: loc.join('.'), message: typeof entry.msg === 'string' ? entry.msg : '' };
  });
  const message = entries
    .map(({ param, message }) => (param ? `${param}: ${message}` : message))
    .filter(Boolean)
    .join('; ');
  const only = entries.length === 1 ? entries[0]?.param : undefined;
  return { ...(message ? { message } : {}), ...(only ? { param: only } : {}) };
}

/** A non-2xx answer as an `LlmError`. */
export function httpError<P extends ResponsesProvider>(
  profile: ResponsesProfile<P>,
  answer: HttpAnswer,
): LlmError {
  const { fields, detail } = readError(answer.body);
  const formatKind = kindForCode(fields.code, fields.type);
  const reading =
    formatKind === undefined
      ? profile.classifyError?.({ status: answer.status, ...fields })
      : undefined;
  const kind = formatKind ?? reading?.kind ?? kindForStatus(answer.status);
  const param = fields.param ?? reading?.param;
  return new LlmError(
    fields.message ??
      (typeof answer.body === 'string' && answer.body ? answer.body : undefined) ??
      `${profile.label} request failed with HTTP ${answer.status}.`,
    {
      kind,
      provider: profile.provider,
      httpStatus: answer.status,
      providerCode: fields.code,
      providerType: fields.type,
      providerParam: param,
      providerError: detail,
      retryAfterMs: parseRetryAfter(answer.headers.get('retry-after')),
      nativeError: answer.body,
    },
  );
}

/** A response whose status is `failed`, which can arrive with HTTP 200. */
export function failedResponseError<P extends ResponsesProvider>(
  profile: ResponsesProfile<P>,
  error: unknown,
  responseId: string | undefined,
  usage: Usage | undefined,
): LlmError {
  const { fields, detail } = readError({ error });
  const formatKind = kindForCode(fields.code, fields.type);
  const reading = formatKind === undefined ? profile.classifyError?.({ ...fields }) : undefined;
  const kind =
    formatKind ??
    reading?.kind ??
    (fields.code === undefined ? 'provider_error' : 'invalid_request');
  return new LlmError(fields.message ?? `${profile.label} response failed.`, {
    kind,
    provider: profile.provider,
    providerCode: fields.code,
    providerParam: fields.param ?? reading?.param,
    providerError: detail,
    responseId,
    usage,
  });
}
