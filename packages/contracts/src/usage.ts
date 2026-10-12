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
  /** Every token written to a cache, whatever its time to live. */
  readonly cacheWrite?: number;
  /**
   * The cost: reported by the provider where it says what it charged
   * (OpenRouter), otherwise estimated from the catalog when the model and
   * every needed count are known.
   */
  readonly cost?: UsageCost;
}

/** Cost in US dollars. An unavailable bucket is omitted. */
export interface UsageCost {
  /**
   * `reported`: what the provider says it charged, often with only a total.
   * `estimated`: tokens at the catalog's rates.
   */
  readonly source: 'reported' | 'estimated';
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  /** Every cache write, whatever its time to live. */
  readonly cacheWrite?: number;
  readonly total: number;
}
