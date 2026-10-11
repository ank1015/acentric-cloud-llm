import type { TextContent } from './content.ts';
import type { RequestMessage } from './messages.ts';
import type { Credentials, ModelId, Provider, ProviderOptions } from './providers.ts';
import type { ToolDefinition } from './tools.ts';

/**
 * Body of `POST /v1/complete`. Distributes over providers, so credentials,
 * options, model IDs and replayed messages all belong to `provider`.
 */
export type CompletionRequest<P extends Provider = Provider> = P extends Provider
  ? {
      readonly provider: P;
      /** The caller's own credentials. Forwarded to the provider only; never stored or logged. */
      readonly credentials: Credentials<P>;
      readonly model: ModelId<P>;
      /** The provider's top-level system instructions. */
      readonly instructions?: string | readonly TextContent[];
      readonly messages: readonly RequestMessage<P>[];
      /** Tools the caller executes. Hosted tools go in `providerOptions.tools`. */
      readonly tools?: readonly ToolDefinition[];
      /** The provider's own request fields, passed through. */
      readonly providerOptions?: ProviderOptions<P>;
      /** Upper bound for the provider call in milliseconds; the gateway may lower it. */
      readonly timeoutMs?: number;
    }
  : never;
