/** Token counts. An unavailable count is omitted; zero is a known zero. */
export interface Usage {
  /** Every prompt token, cached or not. */
  readonly totalInput?: number;
  /** Prompt tokens that were neither read from nor written to a cache. */
  readonly input?: number;
  /** Output tokens, including reasoning where the provider counts it as output. */
  readonly output?: number;
  /** Reasoning tokens; part of `output` unless the provider bills them apart. */
  readonly reasoning?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  /** Estimated from the catalog when the model and every needed count are known. */
  readonly cost?: UsageCost;
}

/** Estimated cost in US dollars. An unavailable bucket is omitted. */
export interface UsageCost {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly total: number;
}
