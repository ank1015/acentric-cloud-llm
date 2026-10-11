import type { ModelCost, ModelPricing, Usage, UsageCost } from '@acentric-llm/contracts';

/**
 * Estimated token cost in US dollars, or undefined when it cannot be known: an
 * unknown count, or tokens in a bucket the pricing has no rate for. The tier
 * for the whole request is the highest one its input exceeds.
 */
export function estimateCost(
  usage: Usage,
  pricing: ModelPricing | undefined,
  multiplier: number | undefined,
): UsageCost | undefined {
  if (pricing === undefined || multiplier === undefined) return undefined;
  const { totalInput, input, output } = usage;
  if (totalInput === undefined || input === undefined || output === undefined) return undefined;

  let rates: ModelCost = pricing.base;
  for (const tier of pricing.tiers ?? []) if (totalInput > tier.aboveInputTokens) rates = tier.cost;

  const cacheRead = bucket(usage.cacheRead, rates.cacheRead);
  const cacheWrite = bucket(usage.cacheWrite, rates.cacheWrite);
  if (cacheRead === null || cacheWrite === null) return undefined;

  const cost = {
    input: price(input, rates.input),
    output: price(output, rates.output),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
  const scaled = Object.fromEntries(
    Object.entries(cost).map(([key, value]) => [key, value * multiplier]),
  ) as Omit<UsageCost, 'total'>;
  const total = Object.values(scaled).reduce((sum: number, value) => sum + (value ?? 0), 0);
  return { ...scaled, total };

  /** undefined: no tokens to price; null: tokens without a rate. */
  function bucket(tokens: number | undefined, rate: number | undefined): number | undefined | null {
    if (!tokens) return tokens === 0 && rate !== undefined ? 0 : undefined;
    return rate === undefined ? null : price(tokens, rate);
  }
}

function price(tokens: number, perMillion: number): number {
  return (tokens * perMillion) / 1_000_000;
}
