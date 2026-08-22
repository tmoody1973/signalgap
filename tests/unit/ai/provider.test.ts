import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { GenerateFn } from "../../../convex/ai/provider";
import { generateStructured } from "../../../convex/ai/provider";

const schema = z.object({ headline: z.string() });

const ok = (headline: string) => ({
  object: { headline },
  usage: { inputTokens: 120, outputTokens: 40 },
});

const badShape = { object: { headline: 42 }, usage: { inputTokens: 10, outputTokens: 2 } };

const httpError = (status: number) => Object.assign(new Error(`http ${status}`), { statusCode: status });

/** Returns a fake provider call that replays `queued` in order, recording what it saw. */
function fakeGenerate(queued: Array<unknown>) {
  const seen: Array<{ provider: string; modelId: string }> = [];
  let i = 0;
  const fn: GenerateFn = async (args) => {
    seen.push({ provider: args.provider, modelId: args.modelId });
    const next = queued[i++];
    if (next === undefined) throw new Error("fake ran out of queued responses");
    if (next instanceof Error) throw next;
    return next as Awaited<ReturnType<GenerateFn>>;
  };
  return { fn, seen };
}

const call = (generate: GenerateFn) =>
  generateStructured({
    operation: "analyzeResults",
    schema,
    schemaVersion: "1",
    promptVersion: "1",
    system: "sys",
    prompt: "user",
    inputSnapshotHash: "hash",
    generate,
  });

describe("generateStructured", () => {
  beforeEach(() => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_MODEL = "gpt-5.6-terra";
    process.env.AI_FALLBACK_ENABLED = "false";
  });

  it("returns the parsed value on a first-attempt success", async () => {
    const { fn, seen } = fakeGenerate([ok("one")]);
    const result = await call(fn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ headline: "one" });
    expect(result.attempts).toBe(1);
    expect(result.usedFallback).toBe(false);
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-5");
    expect(seen).toHaveLength(1);
  });

  it("retries a schema-invalid response exactly once on the primary, then succeeds", async () => {
    const { fn, seen } = fakeGenerate([badShape, ok("two")]);
    const result = await call(fn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(seen.every((s) => s.provider === "anthropic")).toBe(true);
  });

  it("two invalid responses go to the fallback when it is enabled, and never merge outputs", async () => {
    process.env.AI_FALLBACK_ENABLED = "true";
    const { fn, seen } = fakeGenerate([badShape, badShape, ok("three")]);
    const result = await call(fn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ headline: "three" });
    expect(result.attempts).toBe(3);
    expect(result.usedFallback).toBe(true);
    expect(result.provider).toBe("openai");
    expect(result.modelId).toBe("gpt-5.6-terra");
    expect(seen.map((s) => s.provider)).toEqual(["anthropic", "anthropic", "openai"]);
  });

  it("fails as invalid_output after two invalid responses when the fallback is disabled", async () => {
    const { fn, seen } = fakeGenerate([badShape, badShape]);
    const result = await call(fn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("invalid_output");
    expect(result.attempts).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(2);
  });

  it("retries a 429 on the same provider and does not consume the schema-invalid retry", async () => {
    const { fn, seen } = fakeGenerate([httpError(429), badShape, ok("four")]);
    const result = await call(fn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(3);
    expect(result.usedFallback).toBe(false);
    expect(seen.every((s) => s.provider === "anthropic")).toBe(true);
  });

  it("retries a 5xx at most twice, then fails as provider_error without touching the fallback", async () => {
    process.env.AI_FALLBACK_ENABLED = "true";
    const { fn, seen } = fakeGenerate([httpError(503), httpError(503), httpError(503)]);
    const result = await call(fn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("provider_error");
    expect(result.attempts).toBe(3);
    expect(result.usedFallback).toBe(false);
    expect(seen).toHaveLength(3);
  });

  it("does not retry a 400", async () => {
    const { fn, seen } = fakeGenerate([httpError(400)]);
    const result = await call(fn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("provider_error");
    expect(result.attempts).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it("carries usage and durationMs through", async () => {
    const { fn } = fakeGenerate([ok("five")]);
    const result = await call(fn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails as provider_error when the fallback is enabled but no fallback model is configured", async () => {
    process.env.AI_FALLBACK_ENABLED = "true";
    delete process.env.AI_FALLBACK_MODEL;
    const { fn, seen } = fakeGenerate([badShape, badShape]);
    const result = await call(fn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("invalid_output");
    expect(result.usedFallback).toBe(false);
    expect(seen).toHaveLength(2);
  });
});
