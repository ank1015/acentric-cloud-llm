import type { ModelCost, ModelInfo } from '@acentric-llm/contracts';

// Claude 5 models, with standard rates in USD per million tokens from
// https://platform.claude.com/docs/en/about-claude/pricing and the model pages,
// verified 2026-10-12. Cache writes cost 1.25x input for five minutes and 2x for
// an hour; reads are priced per model. Only Haiku 5.5 has a long-context rate:
// the whole request, output included, once the prompt is over 100,000 tokens.

const LIMITS = { contextWindow: 1_000_000, maxOutputTokens: 128_000 } as const;
const INPUT = ['text', 'image', 'file'] as const;

function rates(
  input: number,
  output: number,
  cacheWrite: number,
  cacheWrite1h: number,
  cacheRead: number,
): ModelCost {
  return { input, output, cacheWrite, cacheWrite1h, cacheRead };
}

export const ANTHROPIC_MODELS = [
  {
    provider: 'anthropic',
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(10, 50, 12.5, 20, 0.25) },
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(4, 20, 5, 8, 0.2) },
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(2, 10, 2.5, 4, 0.1) },
  },
  {
    provider: 'anthropic',
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    ...LIMITS,
    input: INPUT,
    pricing: {
      base: rates(0.1, 0.5, 0.125, 0.2, 0.01),
      tiers: [{ aboveInputTokens: 100_000, cost: rates(0.5, 2.5, 0.625, 1, 0.05) }],
    },
  },
  {
    provider: 'anthropic',
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(10, 50, 12.5, 20, 1) },
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(5, 25, 6.25, 10, 0.5) },
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    ...LIMITS,
    input: INPUT,
    pricing: { base: rates(2, 10, 2.5, 4, 0.2) },
  },
] as const satisfies readonly ModelInfo<'anthropic'>[];

/** `max_tokens` for a model outside the catalog: the Claude 5 maximum. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 128_000;
