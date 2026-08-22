// Cost is derived, never guessed. A model we have no published price for gets
// `undefined` rather than a made-up number — an invented cost in a portfolio
// artifact is worse than a blank one.
// USD per 1M tokens.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export function estimateCostUsd(
  modelId: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const price = PRICES[modelId];
  if (!price || inputTokens === undefined || outputTokens === undefined) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
