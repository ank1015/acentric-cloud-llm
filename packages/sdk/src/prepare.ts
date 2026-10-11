import { LlmError, type CompletionRequest, type Provider } from '@acentric-llm/contracts';
import { requestMessages } from '@acentric-llm/providers';
import type { CompleteInput, SavedCredentials } from './types.ts';

/** The wire request: saved credentials filled in, application messages removed. */
export function prepare(
  input: CompleteInput<Provider>,
  saved: Partial<SavedCredentials>,
): CompletionRequest {
  const credentials = input.credentials ?? saved[input.provider];
  if (credentials === undefined) {
    throw new LlmError(
      `No credentials for ${input.provider}: pass them on the request or the client.`,
      {
        kind: 'invalid_request',
        provider: input.provider,
      },
    );
  }
  return { ...input, credentials, messages: requestMessages(input.messages) } as CompletionRequest;
}

export function checkTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && !(Number.isSafeInteger(timeoutMs) && timeoutMs > 0)) {
    throw new LlmError('timeoutMs must be a positive integer.', { kind: 'invalid_request' });
  }
}

/** A signal that aborts on the caller's signal or after `timeoutMs`. */
export function callSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const onAbort = () =>
    controller.abort(new LlmError('The call was cancelled.', { kind: 'cancelled' }));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new LlmError(`The call timed out after ${timeoutMs} ms.`, { kind: 'timeout' }),
            ),
          timeoutMs,
        );
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
