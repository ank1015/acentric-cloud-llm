import { LlmError, type LlmErrorKind } from '@acentric-llm/contracts';
import { isRecord } from '../../shared.ts';
import { parseRetryAfter, type HttpAnswer } from '../../transport.ts';
import type { MessagesProfile, MessagesProvider } from './profile.ts';

const KIND_BY_TYPE: Readonly<Record<string, LlmErrorKind>> = {
  authentication_error: 'auth',
  permission_error: 'auth',
  billing_error: 'quota_exceeded',
  not_found_error: 'not_found',
  rate_limit_error: 'rate_limited',
  request_too_large: 'invalid_request',
  overloaded_error: 'overloaded',
  timeout_error: 'timeout',
  api_error: 'provider_error',
};

/** Validation messages start with the field at fault: `messages.1.content.0: …`, `model: …`. */
const FIELD_PREFIX = /^([A-Za-z_][\w-]*(?:\.[\w-]+)*): /;

/**
 * A non-2xx answer as an `LlmError`. Anthropic answers
 * `{ type: "error", error: { type, message, details? }, request_id }`; a 413
 * and errors from its edge have other shapes or a text body.
 */
export function httpError<P extends MessagesProvider>(
  profile: MessagesProfile<P>,
  answer: HttpAnswer,
): LlmError {
  const { body, status, headers } = answer;
  const detail = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const type = typeof detail?.type === 'string' ? detail.type : undefined;
  const message = typeof detail?.message === 'string' ? detail.message : undefined;
  const details = isRecord(detail?.details) ? detail.details : undefined;
  const code = typeof details?.error_code === 'string' ? details.error_code : undefined;
  const shouldRetry = headers.get('x-should-retry');
  return new LlmError(
    message ??
      (typeof body === 'string' && body ? body : undefined) ??
      `${profile.label} request failed with HTTP ${status}.`,
    {
      kind: classify(status, type, message, code),
      provider: profile.provider,
      httpStatus: status,
      providerCode: code,
      providerType: type,
      providerParam: message?.match(FIELD_PREFIX)?.[1],
      providerError: detail ?? body,
      retryAfterMs: parseRetryAfter(headers.get('retry-after')),
      retryable: shouldRetry === 'true' ? true : shouldRetry === 'false' ? false : undefined,
      nativeError: body,
    },
  );
}

function classify(
  status: number,
  type: string | undefined,
  message: string | undefined,
  code: string | undefined,
): LlmErrorKind {
  // The monthly spend cap of a usage tier: a rate limit that lasts until next month.
  if (code === 'enforced_spend_limit_reached') return 'quota_exceeded';
  if (message !== undefined && type === 'invalid_request_error') {
    // "prompt is too long: 205024 tokens > 200000 maximum"; there is no code.
    if (/^prompt is too long/i.test(message)) return 'context_overflow';
    // A spend limit the organization or workspace set, or no credit left.
    if (
      /reached your specified (workspace )?API usage limits|credit balance is too low/i.test(
        message,
      )
    ) {
      return 'quota_exceeded';
    }
  }
  const byType = type !== undefined ? KIND_BY_TYPE[type] : undefined;
  if (byType !== undefined) return byType;
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota_exceeded';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503 || status === 529) return 'overloaded';
  if (status === 504) return 'timeout';
  if (status >= 500) return 'provider_error';
  return 'invalid_request';
}
