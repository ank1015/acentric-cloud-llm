import type { ModelInfo, Provider } from '@acentric-llm/contracts';
import { complete, MODELS } from '@acentric-llm/providers';
import { callSignal, checkTimeout, prepare } from './prepare.ts';
import type { LlmClient, SavedCredentials } from './types.ts';

export * from './index.ts';

export interface DirectClientOptions<K extends Provider = never> {
  /** Credentials per provider. */
  readonly credentials?: SavedCredentials<K>;
  /** A `fetch` to use instead of the global one. */
  readonly fetch?: typeof fetch;
  /** Limit for each call. */
  readonly timeoutMs?: number;
}

/**
 * Calls providers directly, with the same adapters the gateway runs: no extra
 * hop, and keys never leave the process. Bundles every adapter.
 */
export function createDirectClient<K extends Provider = never>(
  options: DirectClientOptions<K> = {},
): LlmClient<K> {
  const saved: Partial<SavedCredentials> = options.credentials ?? {};
  checkTimeout(options.timeoutMs);
  return {
    async complete(input, call = {}) {
      const request = prepare(input, saved);
      const timeoutMs = call.timeoutMs ?? options.timeoutMs;
      checkTimeout(timeoutMs);
      const { signal, done } = callSignal(call.signal, timeoutMs);
      try {
        return (await complete(request, { signal, fetch: options.fetch })) as never;
      } catch (error) {
        throw signal.aborted ? signal.reason : error;
      } finally {
        done();
      }
    },
    async models() {
      return Object.values(MODELS).flat() as readonly ModelInfo[];
    },
  };
}
