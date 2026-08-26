import { beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { runAdjudicatePairs } from "../../convex/ai/adjudicatePairs";
import type { GenerateFn } from "../../convex/ai/provider";
import { type ClusterSignal, type ScoredPair, pairLinkKey } from "../../convex/editorial/blocking";
import { scanDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/**
 * The ambiguous-band adjudicator on its real path — through `runAiOperation`,
 * so the retry rule, the source-binding guard and the `modelRuns` ledger are the
 * production ones and not a copy.
 *
 * No test here reaches a model: `GenerateFn` is injected, as it is everywhere.
 */

const signals: ClusterSignal[] = [
  { sourceResultId: "s1", title: "Council delays Harambee rezoning", snippet: "The vote was pushed to September.", entityKeys: ["Harambee"], claimSummary: "The council delayed a rezoning vote.", dates: [] },
  { sourceResultId: "s2", title: "Harambee rezoning vote postponed", snippet: "Aldermen put off a decision.", entityKeys: ["Harambee"], claimSummary: "Aldermen postponed the rezoning decision.", dates: [] },
  { sourceResultId: "s3", title: "Harambee block party draws a crowd", snippet: "Hundreds attended Saturday.", entityKeys: ["Harambee"], claimSummary: "A block party drew hundreds.", dates: [] },
];

const ambiguous = (a: string, b: string, score = 3): ScoredPair => {
  const [x, y] = [a, b].sort();
  return { a: x, b: y, score, verdict: "ambiguous", sharedTokens: ["harambee"], sharedEntityKeys: [], sharedDates: [], adjudicatedSameStory: false };
};

const PAIRS = [ambiguous("s1", "s2"), ambiguous("s1", "s3")];

const model = (object: unknown): GenerateFn => async () => ({ object, usage: { inputTokens: 900, outputTokens: 60 } });

async function seedScan(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    return await ctx.db.insert("scans", scanDoc(ownerId) as never);
  });
}

const runs = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())) as Doc<"modelRuns">[];

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("adjudicating the ambiguous band", () => {
  it("turns a yes into a link and a no into nothing", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    const generate = model({ verdicts: [
      { pairId: "p0", sameStory: true, reason: "Both report the same postponed rezoning vote." },
      { pairId: "p1", sameStory: false, reason: "One is a rezoning vote, one is a block party." },
    ] });

    const outcome = await t.action(async (ctx) => await runAdjudicatePairs(ctx, { scanId, signals, pairs: PAIRS }, generate));

    expect(outcome.failure).toBeNull();
    expect(outcome.sent).toBe(2);
    expect(outcome.links).toEqual([pairLinkKey("s1", "s2")]);
    expect(outcome.sameStoryCount).toBe(1);
  });

  it("rejects a verdict about a pair it was never shown, and the ledger says invalid", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    const generate = model({ verdicts: [
      { pairId: "p0", sameStory: true, reason: "Same vote." },
      { pairId: "p1", sameStory: false, reason: "Different." },
      { pairId: "p7", sameStory: true, reason: "A pair nobody asked about." },
    ] });

    const outcome = await t.action(async (ctx) => await runAdjudicatePairs(ctx, { scanId, signals, pairs: PAIRS }, generate));

    expect(outcome.links).toHaveLength(0);
    expect(outcome.failure).toContain("invalid_output");
    const ledger = await runs(t);
    expect(ledger.map((r) => r.status)).toContain("invalid");
    expect(ledger.at(-1)?.validationErrors?.join(" ")).toContain("p7");
  });

  it("catches a short answer instead of accepting it as a success", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    const generate = model({ verdicts: [{ pairId: "p0", sameStory: true, reason: "Same vote." }] });

    const outcome = await t.action(async (ctx) => await runAdjudicatePairs(ctx, { scanId, signals, pairs: PAIRS }, generate));

    expect(outcome.links).toHaveLength(0);
    const ledger = await runs(t);
    expect(ledger.at(-1)?.status).toBe("invalid");
    expect(ledger.at(-1)?.validationErrors?.join(" ")).toContain("2 pairs were sent and 1 answered");
  });

  it("survives a provider failure with no links and a named reason", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    const generate: GenerateFn = async () => { throw Object.assign(new Error("nope"), { statusCode: 400 }); };

    const outcome = await t.action(async (ctx) => await runAdjudicatePairs(ctx, { scanId, signals, pairs: PAIRS }, generate));

    expect(outcome.links).toHaveLength(0);
    expect(outcome.failure).toContain("provider_error");
  });

  it("costs nothing when the band is empty", async () => {
    const t = setup();
    const scanId = await seedScan(t);
    let called = 0;
    const generate: GenerateFn = async () => { called++; return { object: {}, usage: {} }; };

    const outcome = await t.action(async (ctx) => await runAdjudicatePairs(ctx, { scanId, signals, pairs: [] }, generate));

    expect(called).toBe(0);
    expect(outcome.sent).toBe(0);
    expect(outcome.failure).toBeNull();
    expect(await runs(t)).toHaveLength(0);
  });
});
