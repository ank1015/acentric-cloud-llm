import type { ModelInfo } from '@acentric-llm/contracts';

// A curated list, not OpenRouter's whole catalog: models we use through
// OpenRouter that have no provider of their own here. Limits and list prices
// in USD per million tokens from GET https://openrouter.ai/api/v1/models,
// verified 2026-10-12. Prices are for reference: a response's cost is the one
// OpenRouter reports, since the endpoint that serves a request sets the price.

export const OPENROUTER_MODELS = [
  {
    provider: 'openrouter',
    id: 'meta/muse-spark-1.3-contributor',
    name: 'Meta: Muse Spark 1.3 Contributor',
    contextWindow: 1_048_576,
    maxOutputTokens: 943_718,
    // Video input too, which the shared content parts do not carry.
    input: ['text', 'image', 'file'],
    pricing: { base: { input: 0.1, output: 0.2, cacheRead: 0.002 } },
  },
] as const satisfies readonly ModelInfo<'openrouter'>[];
