import type { AnthropicSpec } from './providers/anthropic.ts';
import type { FireworksSpec } from './providers/fireworks.ts';
import type { OpenAiSpec } from './providers/openai.ts';
import type { OpenRouterSpec } from './providers/openrouter.ts';

/**
 * An API format: one request and response shape that several providers may
 * serve. Adapters implement formats; providers are profiles on a format.
 */
export type ApiFormat = 'openai-responses' | 'anthropic-messages' | 'google-gemini';

/** What a provider contributes to the types. Every entry in `Providers` satisfies it. */
export interface ProviderSpec {
  /** The API format this provider is called through. */
  readonly api: ApiFormat;
  /** The caller's credentials for this provider. */
  readonly credentials: object;
  /** The provider's own request fields, minus the fields the request owns. */
  readonly options: object;
  /** A provider-specific input item, carried by a `native` message. */
  readonly inputItem: object;
  /** One item of the provider's output, kept verbatim in an assistant message. */
  readonly outputItem: object;
  /** The provider's response fields other than its output. */
  readonly response: object;
  /** Model IDs in the catalog, for autocomplete. Any other ID is accepted too. */
  readonly modelId: string;
}

/**
 * Every provider, keyed by ID. Each provider adds its entry here when it is
 * implemented, with types written from the provider's API reference.
 */
export interface Providers {
  readonly openai: OpenAiSpec;
  readonly fireworks: FireworksSpec;
  readonly anthropic: AnthropicSpec;
  readonly openrouter: OpenRouterSpec;
}

/** Fails to compile when a registered provider does not satisfy `ProviderSpec`. */
type CheckProviders<T extends { readonly [P in keyof Providers]: ProviderSpec }> = T;
export type RegisteredProviders = CheckProviders<Providers>;

export type Provider = keyof Providers & string;

type Spec<P extends Provider> = Providers[P] extends ProviderSpec ? Providers[P] : never;

export type ApiOf<P extends Provider> = Spec<P>['api'];
export type Credentials<P extends Provider> = Spec<P>['credentials'];
export type ProviderOptions<P extends Provider> = Spec<P>['options'];
export type NativeInputItem<P extends Provider> = Spec<P>['inputItem'];
export type NativeOutputItem<P extends Provider> = Spec<P>['outputItem'];
export type NativeResponse<P extends Provider> = Spec<P>['response'];
export type KnownModelId<P extends Provider> = Spec<P>['modelId'];

/** A catalog model ID, which autocompletes, or any other ID the provider serves. */
export type ModelId<P extends Provider> = KnownModelId<P> | (string & {});
