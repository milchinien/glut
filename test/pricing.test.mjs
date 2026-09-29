import test from "node:test";
import assert from "node:assert/strict";
import { estimateCost, findPrice } from "../src/pricing.mjs";

test("Codex cached input is not counted as uncached input", () => {
  const result = estimateCost("codex", "gpt-6-astra", {
    input: 200_000,
    cached: 160_000,
    cacheWrite: 0,
    output: 20_000,
  });
  assert.equal(result.cost, 1.56);
  assert.equal(result.savings, 1.44);
});

test("Claude input categories are additive", () => {
  const result = estimateCost("claude", "claude-opus-5", {
    input: 100_000,
    cached: 800_000,
    cacheWrite: 50_000,
    output: 50_000,
  });
  assert.equal(result.cost, 2.4625);
});

test("unknown model remains explicitly unpriced", () => {
  assert.equal(findPrice("codex", "future-model"), null);
  assert.deepEqual(
    estimateCost("codex", "future-model", { input: 100, output: 100 }),
    { cost: 0, savings: 0, priced: false },
  );
});

test("GPT-5.6 Terra current standard pricing is available", () => {
  const price = findPrice("codex", "gpt-5.6-terra");
  assert.equal(price.input, 2);
  assert.equal(price.cached, 0.2);
  assert.equal(price.output, 12);
});
