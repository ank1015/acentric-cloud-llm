import {
  type CompletionRequest,
  type CompletionResponse,
  type ModelInfo,
  type Provider,
} from '@acentric-llm/contracts';
import { FIREWORKS_MODELS } from './catalog/fireworks.ts';
import { OPENAI_MODELS } from './catalog/openai.ts';
import type { ProviderDefinition } from './definition.ts';
import { fireworks } from './providers/fireworks.ts';
import { openai } from './providers/openai.ts';
import { invalidRequest, isRecord } from './shared.ts';
import { MAX_TIMEOUT_MS, type CallOptions } from './transport.ts';

/** Every provider. Adding one to the contracts fails to compile until it is here. */
export const PROVIDERS: { readonly [P in Provider]: ProviderDefinition<P> } = {
  openai,
  fireworks,
};

/** Every catalog model, by provider. */
export const MODELS: { readonly [P in Provider]: readonly ModelInfo<P>[] } = {
  openai: OPENAI_MODELS,
  fireworks: FIREWORKS_MODELS,
};

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && Object.hasOwn(PROVIDERS, value);
}

/** One completion with the request's own provider. Never retries. */
export function complete<P extends Provider>(
  request: CompletionRequest<P>,
  options?: CallOptions,
): Promise<CompletionResponse<P>> {
  // Indexing by `request.provider` selects the matching definition; the widened
  // type only hides that correlation from the compiler.
  const definition = PROVIDERS[request.provider as Provider] as unknown as ProviderDefinition<P>;
  return definition.complete(request, options);
}

const ROLES: ReadonlySet<unknown> = new Set([
  'user',
  'system',
  'assistant',
  'tool_result',
  'native',
  'custom',
]);

/**
 * Checks the envelope of an untrusted request, such as a gateway's body. Message,
 * tool and option contents are checked by the provider's adapter as it maps them.
 */
export function parseCompletionRequest(value: unknown): CompletionRequest {
  if (!isRecord(value)) throw invalidRequest(undefined, 'The request must be a JSON object.');
  const { provider, credentials, model, messages, tools, providerOptions, timeoutMs } = value;
  if (!isProvider(provider)) {
    throw invalidRequest(
      undefined,
      `provider must be one of: ${Object.keys(PROVIDERS).join(', ')}.`,
    );
  }
  if (credentials === undefined) {
    throw invalidRequest(provider, 'credentials are required: send your own provider credentials.');
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw invalidRequest(provider, 'model must be a nonempty string.');
  }
  if (
    !Array.isArray(messages) ||
    !messages.every((message) => isRecord(message) && ROLES.has(message.role))
  ) {
    throw invalidRequest(provider, 'messages must be an array of messages with a known role.');
  }
  if (tools !== undefined && !(Array.isArray(tools) && tools.every(isRecord))) {
    throw invalidRequest(provider, 'tools must be an array of tool definitions.');
  }
  if (providerOptions !== undefined && !isRecord(providerOptions)) {
    throw invalidRequest(provider, 'providerOptions must be an object.');
  }
  if (timeoutMs !== undefined && !(Number.isSafeInteger(timeoutMs) && (timeoutMs as number) > 0)) {
    throw invalidRequest(provider, 'timeoutMs must be a positive integer.');
  }
  return {
    ...value,
    ...(timeoutMs !== undefined
      ? { timeoutMs: Math.min(timeoutMs as number, MAX_TIMEOUT_MS) }
      : {}),
  } as unknown as CompletionRequest;
}
