import type { ApiOf, Credentials, ModelInfo, Provider } from '@acentric-llm/contracts';

/** Providers served through the Anthropic Messages format. */
export type MessagesProvider = {
  [P in Provider]: ApiOf<P> extends 'anthropic-messages' ? P : never;
}[Provider];

/** What one provider changes about the Messages format: where to send it and how to sign it. */
export interface MessagesProfile<P extends MessagesProvider> {
  readonly provider: P;
  /** Used in error messages, e.g. "Anthropic". */
  readonly label: string;
  /** The create-message URL. */
  readonly url: string;
  credentials(value: unknown): Credentials<P>;
  /** Authentication and account headers; the format adds the version and beta headers. */
  headers(credentials: Credentials<P>): Record<string, string>;
  readonly catalog: readonly ModelInfo<P>[];
  /** `max_tokens` when the request leaves it out and the model is not in the catalog. */
  readonly defaultMaxTokens: number;
}
