import type {
  CompletionRequest,
  CompletionResponse,
  StopReason,
  Usage,
  UsageCost,
} from '@acentric-llm/contracts';
import { estimateCost } from '../../cost.ts';
import { invalidResponse, isRecord, tokenCount, type JsonRecord } from '../../shared.ts';
import type { JsonAnswer } from '../../transport.ts';
import type { MessagesProfile, MessagesProvider } from './profile.ts';

/** Response fields the envelope already holds. */
const ENVELOPE_FIELDS = ['id', 'type', 'role', 'content', 'model', 'stop_reason', 'usage'];

/** Usage fields mapped to `Usage`; the rest of `usage` stays in `native`. */
const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'output_tokens_details',
];

const STOP_REASONS: Readonly<Record<string, StopReason>> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  model_context_window_exceeded: 'length',
  tool_use: 'tool_use',
  pause_turn: 'pause_turn',
  // Beta compaction paused after summarizing; sending the message back continues.
  compaction: 'pause_turn',
  refusal: 'refusal',
};

/** Refusals before any output are billed only in these categories (2026-09-24). */
const BILLED_REFUSALS: ReadonlySet<unknown> = new Set([
  'bio',
  'frontier_llm',
  'reasoning_extraction',
]);

/** Reads a create-message answer into a `CompletionResponse`. */
export function parseResponse<P extends MessagesProvider>(
  request: CompletionRequest<P>,
  answer: JsonAnswer,
  profile: MessagesProfile<P>,
): CompletionResponse<P> {
  const { provider, label } = profile;
  const body = answer.body;
  if (!isRecord(body) || body.type !== 'message' || !Array.isArray(body.content)) {
    throw invalidResponse(provider, `${label} did not answer with a message.`, body);
  }
  const id = typeof body.id === 'string' && body.id ? body.id : undefined;
  const stop = typeof body.stop_reason === 'string' ? body.stop_reason : undefined;
  const stopReason = (stop !== undefined ? STOP_REASONS[stop] : undefined) ?? 'stop';
  const servedBy = typeof body.model === 'string' ? body.model : request.model;
  const rawUsage = isRecord(body.usage) ? body.usage : undefined;
  const usage = rawUsage && readUsage(rawUsage);
  const cost =
    rawUsage && usage && !freeRefusal(body)
      ? estimate(rawUsage, servedBy, request, profile)
      : undefined;

  const native = omit(body, ENVELOPE_FIELDS);
  // The split of cache writes by time to live says nothing when nothing was written.
  const usageExtras =
    rawUsage &&
    omit(rawUsage, usage?.cacheWrite === 0 ? [...USAGE_FIELDS, 'cache_creation'] : USAGE_FIELDS);
  if (usageExtras && Object.keys(usageExtras).length) native.usage = usageExtras;

  return {
    ...(id !== undefined ? { id } : {}),
    provider,
    model: request.model,
    ...(servedBy !== request.model ? { responseModel: servedBy } : {}),
    message: {
      role: 'assistant',
      provider,
      api: 'anthropic-messages',
      model: request.model,
      ...(id !== undefined ? { id } : {}),
      timestamp: answer.timestamp,
      content: body.content,
    },
    stopReason,
    ...(stop !== undefined && stop !== stopReason ? { providerStopReason: stop } : {}),
    ...(usage !== undefined ? { usage: cost ? { ...usage, cost } : usage } : {}),
    native,
    durationMs: answer.durationMs,
    timestamp: answer.timestamp,
  } as unknown as CompletionResponse<P>;
}

/**
 * Format usage: `input_tokens` is only the uncached part. With beta features
 * that add sampling iterations (compaction, advisor, fallback), the top-level
 * counts leave some out; the iterations hold the whole bill.
 */
export function readUsage(raw: JsonRecord): Usage {
  const iterations = readIterations(raw);
  const tokens = iterations ? sum(iterations.map(({ usage }) => usage)) : readTokens(raw);
  const details = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : {};
  const reasoning = tokenCount(details.thinking_tokens);
  return { ...tokens, ...(reasoning !== undefined ? { reasoning } : {}) };
}

/** One sampling's tokens. */
function readTokens(raw: JsonRecord): Usage {
  const input = tokenCount(raw.input_tokens);
  const output = tokenCount(raw.output_tokens);
  // Absent cache fields are zero: Anthropic leaves them out when nothing is cached.
  const cacheRead =
    raw.cache_read_input_tokens == null ? 0 : tokenCount(raw.cache_read_input_tokens);
  const cacheWrite =
    raw.cache_creation_input_tokens == null ? 0 : tokenCount(raw.cache_creation_input_tokens);
  const totalInput =
    input !== undefined && cacheRead !== undefined && cacheWrite !== undefined
      ? input + cacheRead + cacheWrite
      : undefined;
  return {
    ...(totalInput !== undefined ? { totalInput } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

interface Sampling {
  readonly model: string | undefined;
  readonly usage: Usage;
  readonly cacheWrite1h: number | undefined;
}

function readIterations(raw: JsonRecord): readonly Sampling[] | undefined {
  if (!Array.isArray(raw.iterations) || !raw.iterations.length) return undefined;
  return raw.iterations.filter(isRecord).map((iteration) => ({
    model: typeof iteration.model === 'string' ? iteration.model : undefined,
    usage: readTokens(iteration),
    cacheWrite1h: hourWrites(iteration),
  }));
}

/** Tokens written to the cache for an hour; undefined when writes are not split. */
function hourWrites(raw: JsonRecord): number | undefined {
  if (!raw.cache_creation_input_tokens) return 0;
  return isRecord(raw.cache_creation)
    ? tokenCount(raw.cache_creation.ephemeral_1h_input_tokens ?? 0)
    : undefined;
}

function sum(usages: readonly Usage[]): Usage {
  const keys = ['totalInput', 'input', 'output', 'cacheRead', 'cacheWrite'] as const;
  return Object.fromEntries(
    keys.flatMap((key) =>
      usages.every((usage) => usage[key] !== undefined)
        ? [[key, usages.reduce((total, usage) => total + (usage[key] ?? 0), 0)]]
        : [],
    ),
  );
}

/**
 * Cost at the catalog's standard rates, each sampling at its own model's rates
 * and long-context tier, times the multiplier for where and how it ran.
 * Undefined when any part cannot be priced.
 */
function estimate<P extends MessagesProvider>(
  raw: JsonRecord,
  servedBy: string,
  request: CompletionRequest<P>,
  profile: MessagesProfile<P>,
): UsageCost | undefined {
  const multiplier = priceMultiplier(raw, request);
  const samplings = readIterations(raw) ?? [
    { model: servedBy, usage: readTokens(raw), cacheWrite1h: hourWrites(raw) },
  ];
  const costs: UsageCost[] = [];
  for (const { model, usage, cacheWrite1h } of samplings) {
    const id = model ?? servedBy;
    const pricing = profile.catalog.find((info) => info.id === id)?.pricing;
    if (cacheWrite1h === undefined) return undefined;
    const cost = estimateCost(usage, pricing, multiplier, { cacheWrite1h });
    if (cost === undefined) return undefined;
    costs.push(cost);
  }
  if (costs.length === 1) return costs[0];
  const total: Record<string, number> = {};
  for (const cost of costs) {
    for (const [key, value] of Object.entries(cost)) {
      if (typeof value === 'number') total[key] = (total[key] ?? 0) + value;
    }
  }
  return { source: 'estimated', ...total } as unknown as UsageCost;
}

/**
 * Standard rates hold unless the response says otherwise: US inference costs
 * 1.1x, fast mode 2x, batch half. Priority Tier has no public rate.
 */
function priceMultiplier<P extends MessagesProvider>(
  raw: JsonRecord,
  request: CompletionRequest<P>,
): number | undefined {
  let multiplier = 1;
  const tier = raw.service_tier;
  if (tier === 'batch') multiplier *= 0.5;
  else if (tier !== undefined && tier !== null && tier !== 'standard') return undefined;
  if (raw.inference_geo === 'us') multiplier *= 1.1;
  if (raw.speed === 'fast') multiplier *= 2;
  else if (raw.speed == null && request.providerOptions?.speed === 'fast') return undefined;
  return multiplier;
}

/** A refusal before any output, in a category Anthropic does not bill. */
function freeRefusal(body: JsonRecord): boolean {
  if (body.stop_reason !== 'refusal' || (body.content as unknown[]).length) return false;
  const category = isRecord(body.stop_details) ? body.stop_details.category : undefined;
  return !BILLED_REFUSALS.has(category);
}

/** `record` without `keys` and without null fields, which say nothing. */
function omit(record: JsonRecord, keys: readonly string[]): JsonRecord {
  const skip = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !skip.has(key) && value !== null),
  );
}
