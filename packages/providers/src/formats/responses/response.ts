import {
  LlmError,
  type CompletionRequest,
  type CompletionResponse,
  type Usage,
} from '@acentric-llm/contracts';
import { estimateCost } from '../../cost.ts';
import { invalidResponse, isRecord, tokenCount, type JsonRecord } from '../../shared.ts';
import type { JsonAnswer } from '../../transport.ts';
import { failedResponseError } from './errors.ts';
import type { ResponsesProfile, ResponsesProvider } from './profile.ts';
import { deriveStopReason } from './stop.ts';

/** Response fields every Responses provider echoes or that the envelope already holds. */
export const FORMAT_ECHO_FIELDS = [
  'id',
  'object',
  'model',
  'output',
  'output_text',
  'usage',
  'error',
  'instructions',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'max_output_tokens',
  'max_tool_calls',
  'temperature',
  'top_p',
  'top_logprobs',
  'frequency_penalty',
  'presence_penalty',
  'text',
  'truncation',
  'store',
  'background',
  'previous_response_id',
  'conversation',
  'prompt_cache_key',
  'safety_identifier',
  'user',
  'metadata',
  'include',
] as const;

/** Reads a create-response answer into a `CompletionResponse`. */
export function parseResponse<P extends ResponsesProvider>(
  request: CompletionRequest<P>,
  answer: JsonAnswer,
  profile: ResponsesProfile<P>,
): CompletionResponse<P> {
  const { provider, label } = profile;
  const body = answer.body;
  if (!isRecord(body) || body.object !== 'response' || !Array.isArray(body.output)) {
    throw invalidResponse(provider, `${label} did not answer with a response object.`, body);
  }
  const id = typeof body.id === 'string' && body.id ? body.id : undefined;
  const usage = isRecord(body.usage) ? readUsage(body.usage) : undefined;

  if (body.status === 'failed' || (body.error !== null && body.error !== undefined)) {
    throw failedResponseError(profile, body.error, id, usage);
  }
  if (body.status === 'cancelled') {
    throw new LlmError(`${label} cancelled the response.`, {
      provider,
      kind: 'cancelled',
      responseId: id,
    });
  }
  if (body.status !== 'completed' && body.status !== 'incomplete') {
    throw invalidResponse(
      provider,
      `${label} answered with a ${String(body.status)} response; complete expects a finished one.`,
      body,
    );
  }

  const incompleteReason =
    isRecord(body.incomplete_details) && typeof body.incomplete_details.reason === 'string'
      ? body.incomplete_details.reason
      : undefined;
  const native = omit(body, [...FORMAT_ECHO_FIELDS, ...profile.echoFields]);
  const model = profile.catalog.find((info) => info.id === request.model || info.id === body.model);
  const cost =
    usage && estimateCost(usage, model?.pricing, profile.priceMultiplier(native as never, request));

  return {
    ...(id !== undefined ? { id } : {}),
    provider,
    model: request.model,
    ...(typeof body.model === 'string' && body.model !== request.model
      ? { responseModel: body.model }
      : {}),
    message: {
      role: 'assistant',
      provider,
      api: 'openai-responses',
      model: request.model,
      ...(id !== undefined ? { id } : {}),
      timestamp: answer.timestamp,
      content: body.output,
    },
    stopReason: deriveStopReason(body.status, incompleteReason, body.output),
    ...(incompleteReason !== undefined ? { providerStopReason: incompleteReason } : {}),
    ...(usage !== undefined ? { usage: cost ? { ...usage, cost } : usage } : {}),
    native,
    durationMs: answer.durationMs,
    timestamp: answer.timestamp,
  } as unknown as CompletionResponse<P>;
}

/** Format usage: `input_tokens` is the total; cache reads and writes are parts of it. */
export function readUsage(raw: JsonRecord): Usage {
  const details = isRecord(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const outputDetails = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : {};
  const totalInput = tokenCount(raw.input_tokens);
  const cacheRead = tokenCount(details.cached_tokens);
  const cacheWrite = tokenCount(details.cache_write_tokens);
  const output = tokenCount(raw.output_tokens);
  const reasoning = tokenCount(outputDetails.reasoning_tokens);
  // A model without cache writes reports none; the uncached rest is still known.
  const cached = (cacheRead ?? 0) + (cacheWrite ?? 0);
  const input =
    totalInput !== undefined && cacheRead !== undefined && cached <= totalInput
      ? totalInput - cached
      : undefined;
  return {
    ...(totalInput !== undefined ? { totalInput } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

/** `record` without `keys` and without null fields, which say nothing. */
function omit(record: JsonRecord, keys: readonly string[]): JsonRecord {
  const skip = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !skip.has(key) && value !== null),
  );
}
