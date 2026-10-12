import type { LlmErrorKind } from '@acentric-llm/contracts';
import { OPENROUTER_MODELS } from '../catalog/openrouter.ts';
import { kindForStatus } from '../formats/responses/errors.ts';
import type { ErrorInput, ErrorReading, ResponsesProfile } from '../formats/responses/profile.ts';
import { dataUrl } from '../formats/responses/request.ts';
import { createResponsesProvider } from '../formats/responses/provider.ts';
import {
  credentialFields,
  isRecord,
  optionalCredential,
  requiredCredential,
  type JsonRecord,
} from '../shared.ts';

/** OpenRouter's canonical `error_type` values, by kind. */
const KIND_BY_TYPE: Readonly<Record<string, LlmErrorKind>> = {
  context_length_exceeded: 'context_overflow',
  authentication: 'auth',
  payment_required: 'quota_exceeded',
  rate_limit_exceeded: 'rate_limited',
  provider_overloaded: 'overloaded',
  provider_unavailable: 'provider_error',
  server: 'provider_error',
  unmapped: 'provider_error',
  timeout: 'timeout',
  content_policy_violation: 'policy_violation',
  refusal: 'policy_violation',
  not_found: 'not_found',
  max_tokens_exceeded: 'invalid_request',
  token_limit_exceeded: 'invalid_request',
  string_too_long: 'invalid_request',
  invalid_request: 'invalid_request',
  invalid_prompt: 'invalid_request',
  precondition_failed: 'invalid_request',
  payload_too_large: 'invalid_request',
  unprocessable: 'invalid_request',
  invalid_image: 'invalid_request',
  image_too_large: 'invalid_request',
  image_too_small: 'invalid_request',
  unsupported_image_format: 'invalid_request',
  image_not_found: 'invalid_request',
  image_download_failed: 'invalid_request',
};

/** Statuses the format reads differently from OpenRouter. */
const KIND_BY_STATUS: Readonly<Record<number, LlmErrorKind>> = {
  402: 'quota_exceeded',
  504: 'timeout',
  524: 'timeout',
};

/** The error OpenRouter got from the upstream, carried as a JSON string in `metadata.raw`. */
function upstreamError(raw: unknown): { message?: string; param?: string } {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return raw ? { message: raw } : {};
    }
  }
  // OpenRouter's own validation issues: `[{ path: ["store"], message }]`.
  if (Array.isArray(value)) value = value[0];
  if (!isRecord(value)) return {};
  const error = isRecord(value.error) ? value.error : value;
  const param =
    typeof error.param === 'string'
      ? error.param
      : Array.isArray(error.path) && error.path.length
        ? error.path.join('.')
        : undefined;
  return {
    ...(typeof error.message === 'string' && error.message ? { message: error.message } : {}),
    ...(param ? { param } : {}),
  };
}

/**
 * OpenRouter's errors: a numeric `code` mirroring the status, a canonical
 * `error_type` where it has one, and `metadata` with the upstream's own error
 * (`raw`), routing filters, budgets and moderation results.
 */
function classifyError(input: ErrorInput): ErrorReading | undefined {
  const { metadata = {}, message = '' } = input;
  const status = input.status ?? (Number(input.code) || undefined);
  const upstream = upstreamError(metadata.raw);
  const provider = typeof metadata.provider_name === 'string' ? metadata.provider_name : undefined;
  const detail = {
    ...(upstream.param !== undefined ? { param: upstream.param } : {}),
    // "Provider returned error" says nothing; the upstream's message does.
    ...(upstream.message !== undefined && /^provider returned error$/i.test(message)
      ? { message: `${provider ?? 'The upstream provider'} returned an error: ${upstream.message}` }
      : {}),
  };

  // Budgets: a temporary in-flight reservation is a throttle; any other limit is quota.
  if (typeof metadata.limit_source === 'string') {
    const transient =
      metadata.limit_source === 'openrouter_in_flight_budget' ||
      metadata.reason === 'in_flight_budget_exhausted';
    return { ...detail, kind: transient ? 'rate_limited' : 'quota_exceeded' };
  }
  if (Array.isArray(metadata.reasons) || metadata.flagged_input !== undefined) {
    return { ...detail, kind: 'policy_violation' };
  }
  // No endpoint left after the request's routing filters (`provider.only`, `max_price`, ...).
  if (typeof metadata.failed_routing_step === 'string') {
    return { ...detail, kind: 'not_found', param: 'provider' };
  }
  const typed = input.errorType !== undefined ? KIND_BY_TYPE[input.errorType] : undefined;
  if (typed !== undefined) return { ...detail, kind: typed };
  if (/ is not a valid model ID/i.test(message)) return { kind: 'not_found', param: 'model' };
  if (/maximum context length|context length exceeded|context_length_exceeded/i.test(message)) {
    return { ...detail, kind: 'context_overflow' };
  }
  const byStatus = status !== undefined ? KIND_BY_STATUS[status] : undefined;
  if (byStatus !== undefined) return { ...detail, kind: byStatus };
  // The status, which a failure on HTTP 200 carries as its numeric code.
  if (status !== undefined) return { ...detail, kind: kindForStatus(status) };
  return detail.param !== undefined || detail.message !== undefined
    ? { ...detail, kind: 'provider_error' }
    : undefined;
}

/**
 * What OpenRouter charged, in USD. With the caller's own upstream key (BYOK)
 * `cost` is only OpenRouter's fee and the upstream bills the rest, reported
 * as `upstream_inference_cost`; the total is both.
 */
function reportedCost(usage: JsonRecord) {
  const { cost, is_byok: byok, cost_details: details } = usage;
  if (typeof cost !== 'number') return undefined;
  if (byok !== true) return { source: 'reported', total: cost } as const;
  const upstream = isRecord(details) ? details.upstream_inference_cost : undefined;
  return typeof upstream === 'number'
    ? ({ source: 'reported', total: cost + upstream } as const)
    : undefined;
}

export const openRouterProfile: ResponsesProfile<'openrouter'> = {
  provider: 'openrouter',
  label: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1/responses',
  // Both work; `system` is what every upstream format has.
  systemRole: 'system',
  catalog: OPENROUTER_MODELS,
  fileData: dataUrl,
  // OpenRouter's Files API and custom tools are not verified yet: refused until they are.
  fileIds: false,
  customTools: false,
  // Echoed request settings, beyond the format's.
  echoFields: ['reasoning', 'prompt_cache_options'],
  outputOnlyFields: [],
  // Aliases, variants and fallback lists can route to another model; its reasoning is that model's.
  messageModel: 'response',
  reportedCost,
  classifyError,

  credentials(value) {
    const fields = credentialFields('openrouter', 'OpenRouter', value);
    const appUrl = optionalCredential('openrouter', fields, 'appUrl');
    const appTitle = optionalCredential('openrouter', fields, 'appTitle');
    return {
      apiKey: requiredCredential('openrouter', fields, 'apiKey'),
      ...(appUrl !== undefined ? { appUrl } : {}),
      ...(appTitle !== undefined ? { appTitle } : {}),
    };
  },

  headers({ apiKey, appUrl, appTitle }) {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(appUrl !== undefined ? { 'http-referer': appUrl } : {}),
      ...(appTitle !== undefined ? { 'x-openrouter-title': appTitle } : {}),
    };
  },
};

export const openrouter = createResponsesProvider(openRouterProfile);
