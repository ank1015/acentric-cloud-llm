import type {
  CompletionRequest,
  CompletionResponse,
  Credentials,
  Message,
  ModelInfo,
  Provider,
} from '@acentric-llm/contracts';

/** Credentials saved on a client, for the providers in `K`. */
export type SavedCredentials<K extends Provider = Provider> = { readonly [P in K]: Credentials<P> };

/**
 * A request for one provider. `credentials` may be left out for providers whose
 * credentials the client holds, and `messages` may include the application's own
 * `custom` messages, which are removed before sending.
 */
export type CompleteInput<
  K extends Provider = never,
  P extends Provider = Provider,
> = P extends Provider
  ? Omit<CompletionRequest<P>, 'credentials' | 'messages'> & {
      readonly messages: readonly Message<P>[];
    } & ([P] extends [K]
        ? { readonly credentials?: Credentials<P> }
        : { readonly credentials: Credentials<P> })
  : never;

export interface CallOptions {
  readonly signal?: AbortSignal;
  /** Limit for this call, covering the whole exchange. */
  readonly timeoutMs?: number;
}

/** The same client whether it calls the gateway or the providers directly. */
export interface LlmClient<K extends Provider = never> {
  /** One completion; the response's types follow `input.provider`. Never retries. */
  complete<const I extends CompleteInput<K>>(
    input: I,
    options?: CallOptions,
  ): Promise<CompletionResponse<I['provider']>>;
  /** The model catalog. */
  models(options?: CallOptions): Promise<readonly ModelInfo[]>;
}
