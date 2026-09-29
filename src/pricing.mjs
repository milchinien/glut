export const PRICE_UPDATED_AT = "2026-09-29";

// USD per million tokens. These are API-equivalent estimates, not subscription charges.
const prices = [
  { provider:'claude',pattern:/^claude-(?:fable|mythos)-5-1(?:$|-\d{8}$)/, input:10,cached:0.25,cacheWrite:12.5,cacheWriteOneHour:20,output:50 },
  {
    provider: "codex",
    pattern: /^gpt-6-astra(?:-|$)/,
    input: 10,
    cached: 1,
    cacheWrite: 12.5,
    output: 50,
    long: { input: 20, cached: 2, cacheWrite: 25, output: 75 },
  },
  {
    provider: "codex",
    pattern: /^gpt-6-sol(?:-|$)/,
    input: 2,
    cached: 0.2,
    cacheWrite: 2.5,
    output: 10,
    long: { input: 4, cached: 0.4, cacheWrite: 5, output: 15 },
  },
  {
    provider: "codex",
    pattern: /^gpt-6-luna(?:-|$)/,
    input: 0.1,
    cached: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    long: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
  {
    provider: "codex",
    pattern: /^gpt-5\.6-sol(?:-|$)/,
    input: 4,
    cached: 0.4,
    cacheWrite: 5,
    output: 20,
    long: { input: 8, cached: 0.8, cacheWrite: 10, output: 30 },
  },
  {
    provider: "codex",
    pattern: /^gpt-5\.6-terra(?:-|$)/,
    input: 2,
    cached: 0.2,
    cacheWrite: 2.5,
    output: 12,
    long: { input: 4, cached: 0.4, cacheWrite: 5, output: 18 },
  },
  {
    provider: "codex",
    pattern: /^gpt-5\.6-luna(?:-|$)/,
    input: 0.2,
    cached: 0.02,
    cacheWrite: 0.25,
    output: 1.2,
    long: { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  {
    provider: "claude",
    pattern: /^claude-(?:fable|mythos)-5(?:-|$)/,
    input: 10,
    cached: 1,
    cacheWrite: 12.5,
    cacheWriteOneHour: 20,
    output: 50,
  },
  {
    provider: "claude",
    pattern: /^claude-opus-5-5(?:-|$)/,
    input: 4,
    cached: 0.2,
    cacheWrite: 5,
    cacheWriteOneHour: 8,
    output: 20,
  },
  {
    provider: "claude",
    pattern: /^claude-opus-(?:5|4-8|4-7|4-6|4-5)(?:-|$)/,
    input: 5,
    cached: 0.5,
    cacheWrite: 6.25,
    cacheWriteOneHour: 10,
    output: 25,
  },
  {
    provider: "claude",
    pattern: /^claude-sonnet-5(?:-|$)/,
    input: 2,
    cached: 0.2,
    cacheWrite: 2.5,
    cacheWriteOneHour: 4,
    output: 10,
  },
  {
    provider: "claude",
    pattern: /^claude-haiku-4-5(?:-|$)/,
    input: 1,
    cached: 0.1,
    cacheWrite: 1.25,
    cacheWriteOneHour: 2,
    output: 5,
  },
];

export function findPrice(provider, model, longContext = false) {
  const match = prices.find(
    (price) => price.provider === provider && price.pattern.test(model || ""),
  );
  if (!match) return null;
  return longContext && match.long ? { ...match, ...match.long } : match;
}

export function estimateCost(provider, model, usage) {
  const longContext = provider === "codex" && Number(usage.input || 0) > 272_000;
  const price = findPrice(provider, model, longContext);
  if (!price) return { cost: 0, savings: 0, priced: false };

  const input = Number(usage.input || 0);
  const cached = Number(usage.cached || 0);
  const cacheWrite = Number(usage.cacheWrite || 0);
  const cacheWriteOneHour = Number(usage.cacheWriteOneHour || 0);
  const output = Number(usage.output || 0);
  const uncached =
    provider === "codex"
      ? Math.max(0, input - cached - cacheWrite)
      : Math.max(0, input);

  const cost =
    (uncached * price.input +
      cached * price.cached +
      cacheWrite * price.cacheWrite +
      cacheWriteOneHour * (price.cacheWriteOneHour ?? price.cacheWrite) +
      output * price.output) /
    1_000_000;
  const savings = Math.max(
    0,
    (cached * price.input - cached * price.cached) / 1_000_000,
  );
  return { cost, savings, priced: true };
}
