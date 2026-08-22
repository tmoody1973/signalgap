import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const baseArgs = {
  operation: "analyzeResults" as const,
  provider: "anthropic",
  modelId: "claude-sonnet-5",
  promptVersion: "1",
  schemaVersion: "1",
  inputSnapshotHash: "snap",
  attempt: 1,
};

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    return { ownerId, scanId };
  });
}

describe("modelRuns", () => {
  it("is idempotent on the spec's key and records provenance", async () => {
    const t = setup();
    const { scanId } = await seed(t);

    const first = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs });
    const second = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs });
    expect("runId" in first && first.reused).toBe(false);
    expect("runId" in second && second.reused).toBe(true);
    if (!("runId" in first) || !("runId" in second)) return;
    expect(second.runId).toBe(first.runId);

    // A fallback attempt is a different model, so it is a different run — never a reuse.
    const fallback = await t.mutation(internal.modelRuns.create, {
      scanId, ...baseArgs, provider: "openai", modelId: "gpt-5.6-terra",
      attempt: 3, fallbackFromRunId: first.runId, fallbackReason: "two invalid outputs on the primary",
    });
    expect("runId" in fallback && fallback.reused).toBe(false);
  });

  it("derives estimatedCostUsd from token counts for a priced model", async () => {
    const t = setup();
    const { scanId } = await seed(t);
    const created = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs });
    if (!("runId" in created)) throw new Error("create rejected");

    await t.mutation(internal.modelRuns.complete, {
      runId: created.runId, durationMs: 1_200, inputTokens: 1_000_000, outputTokens: 1_000_000,
    });

    const run = await t.run(async (ctx) => await ctx.db.get(created.runId));
    expect(run?.status).toBe("succeeded");
    expect(run?.estimatedCostUsd).toBeCloseTo(18, 6); // 3 in + 15 out per 1M
  });

  it("leaves cost undefined for a model with no published price", async () => {
    const t = setup();
    const { scanId } = await seed(t);
    const created = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs, modelId: "some-new-model" });
    if (!("runId" in created)) throw new Error("create rejected");

    await t.mutation(internal.modelRuns.complete, {
      runId: created.runId, durationMs: 10, inputTokens: 100, outputTokens: 100,
    });
    const run = await t.run(async (ctx) => await ctx.db.get(created.runId));
    expect(run?.estimatedCostUsd).toBeUndefined();
  });

  it("stores an invalid output as a failed run and will not overwrite a terminal state", async () => {
    const t = setup();
    const { scanId } = await seed(t);
    const created = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs });
    if (!("runId" in created)) throw new Error("create rejected");

    await t.mutation(internal.modelRuns.invalidate, {
      runId: created.runId, status: "invalid", validationErrors: ["headline: expected string"], durationMs: 300,
    });
    await t.mutation(internal.modelRuns.complete, { runId: created.runId, durationMs: 999 });

    const run = await t.run(async (ctx) => await ctx.db.get(created.runId));
    expect(run?.status).toBe("invalid");
    expect(run?.validationErrors).toEqual(["headline: expected string"]);
    expect(run?.durationMs).toBe(300);
  });

  it("never returns prompt text, and returns nothing to a non-owner", async () => {
    const t = setup();
    const { scanId } = await seed(t);
    const created = await t.mutation(internal.modelRuns.create, { scanId, ...baseArgs });
    if (!("runId" in created)) throw new Error("create rejected");

    const mine = await asUser(t, "owner").query(api.modelRuns.listForScan, { scanId });
    expect(mine).toHaveLength(1);
    // Every returned key must be on the allow list. Convex drops undefined fields,
    // so this is a subset check — but a NEW leaking field still fails it, which is
    // the property that matters. promptVersion is a version label, not prompt text.
    const ALLOWED = new Set([
      "_id", "attempt", "completedAt", "durationMs", "estimatedCostUsd", "fallbackReason",
      "inputTokens", "modelId", "operation", "outputTokens", "promptVersion", "provider",
      "schemaVersion", "startedAt", "status", "usedFallback", "validationErrors",
    ]);
    expect(Object.keys(mine[0]).filter((k) => !ALLOWED.has(k))).toEqual([]);

    // A real, signed-in second newsroom user — not an anonymous caller. Scoping is
    // what is under test here, not authentication.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", { clerkUserId: "stranger", createdAt: now, updatedAt: now });
    });
    const theirs = await asUser(t, "stranger").query(api.modelRuns.listForScan, { scanId });
    expect(theirs).toEqual([]);
  });
});
