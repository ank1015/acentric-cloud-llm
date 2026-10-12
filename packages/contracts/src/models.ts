import type { KnownModelId, Provider } from './providers.ts';

export type Modality = 'text' | 'image' | 'file';

/** US dollars per million tokens. */
export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  /** Writing to the cache, at the provider's default time to live. */
  readonly cacheWrite?: number;
  /** Writing to the cache for an hour, where the provider prices it apart (Anthropic). */
  readonly cacheWrite1h?: number;
}

export interface ModelPricing {
  readonly base: ModelCost;
  /** Rates for the whole request once its prompt is above a token count, in ascending order. */
  readonly tiers?: readonly { readonly aboveInputTokens: number; readonly cost: ModelCost }[];
}

/** Catalog metadata for one model. A model need not be in the catalog to be used. */
export type ModelInfo<P extends Provider = Provider> = P extends Provider
  ? {
      readonly provider: P;
      readonly id: KnownModelId<P>;
      readonly name: string;
      readonly contextWindow?: number;
      readonly maxOutputTokens?: number;
      readonly input?: readonly Modality[];
      readonly pricing?: ModelPricing;
    }
  : never;
