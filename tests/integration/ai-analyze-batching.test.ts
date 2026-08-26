import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ANALYZE_BATCH_SIZE, ANALYZE_CONCURRENCY, runAnalyzeResults } from "../../convex/ai/analyzeResults";
import type { GenerateFn } from "../../convex/ai/provider";
import { runEvidenceStage } from "../../convex/stages/evidence";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/**
 * Task 3c. `convex/stages/evidence.ts` used to hand every discovery source to ONE
 * analyzeResults call — measured at 5.6–7.8 s per source, so 294 sources was
 * 27–38 minutes against a 120 s timeout. These tests pin the batched shape:
 * every source still gets analysed, in order; a failed batch does not take the
 * others down; a cancelled scan stops paying; and the ledger has one row per
 * call, never one row claiming to cover the whole scan.
 */

/** Seeds `n` sources whose titles carry their index, so order is checkable. */
async function seedSources(t: ReturnType<typeof setup>, n: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const ids: Id<"sourceResults">[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`, canonicalUrl: `https://example.com/${i}`, originalUrl: `https://example.com/${i}`,
        engine: "google_news" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
        title: `Story ${i}`, snippet: `Snippet ${i}.`,
        originalLanguage: "en", discoveredAt: now, isAccessible: true, contentHash: `h${i}`,
      }));
    }
    return { ownerId, scanId, ids };
  });
}

type BatchSeen = { sourceResultIds: string[] };

/**
 * A fake model that answers whatever batch it is shown, echoing one item per
 * source. `failBatchesContaining` makes the batch holding that title answer with
 * a shape the schema rejects, which is how a single mid-run batch failure is
 * simulated without touching the others. `answerFirst` makes it answer about
 * only the first N sources of every batch — a model that quietly ignores half
 * of what it was shown, which the schema's `.min(1)` happily accepts.
 */
function echoModel(opts: { failTitle?: string; answerFirst?: number; onCall?: () => void } = {}) {
  const seen: BatchSeen[] = [];
  const fn: GenerateFn = async ({ prompt }) => {
    const input = JSON.parse(prompt.slice("Input:\n".length)) as {
      sources: Array<{ sourceResultId: string; title: string }>;
    };
    seen.push({ sourceResultIds: input.sources.map((s) => s.sourceResultId) });
    opts.onCall?.();
    if (opts.failTitle && input.sources.some((s) => s.title === opts.failTitle)) {
      return { object: { items: [{ sourceResultId: "nope", detectedLanguage: 42 }] }, usage: {} };
    }
    const answered = opts.answerFirst === undefined ? input.sources : input.sources.slice(0, opts.answerFirst);
    return {
      object: {
        items: answered.map((s) => ({
          sourceResultId: s.sourceResultId,
          detectedLanguage: "en",
          originalTitle: null, translatedTitle: null, originalSnippet: null, translatedSnippet: null,
          sourceTypeSuggestion: "secondary",
          entities: { people: [], organizations: [s.title], streets: [], neighborhoods: [], agencies: [] },
          dates: [], claims: [], potentialHumanSources: [],
          reason: `Analysed ${s.title}.`,
        })),
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  };
  return { fn, seen, get calls() { return seen.length; } };
}

const allRuns = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())) as Doc<"modelRuns">[];

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("analyzeResults batching", () => {
  it("splits into batches of ANALYZE_BATCH_SIZE and returns one item per source, in order", async () => {
    const t = setup();
    const n = ANALYZE_BATCH_SIZE * 2 + 4;
    const { scanId, ids } = await seedSources(t, n);
    const model = echoModel();

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn));

    expect(outcome.ok).toBe(true);
    expect(outcome.batches).toBe(3);
    expect(model.calls).toBe(3);
    expect(model.seen.map((b) => b.sourceResultIds.length)).toEqual([ANALYZE_BATCH_SIZE, ANALYZE_BATCH_SIZE, 4]);
    // N sources in, N items out, in the order the sources were supplied.
    expect(outcome.items).toHaveLength(n);
    expect(outcome.items.map((i) => i.sourceResultId)).toEqual(ids);
  });

  it("writes one modelRuns row per batch, each with its own idempotency key", async () => {
    const t = setup();
    const n = ANALYZE_BATCH_SIZE * 2 + 4;
    const { scanId, ids } = await seedSources(t, n);
    const model = echoModel();

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn));

    const runs = await allRuns(t);
    expect(runs).toHaveLength(3);
    expect(outcome.modelRunIds).toHaveLength(3);
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);
    expect(new Set(runs.map((r) => r.idempotencyKey)).size).toBe(3);
    // The ledger must equal what ran: three calls, three rows, three input hashes.
    expect(new Set(runs.map((r) => r.inputSnapshotHash)).size).toBe(3);
  });

  it("persists the batches that succeeded when one batch fails, and names the failure", async () => {
    const t = setup();
    const n = ANALYZE_BATCH_SIZE * 3;
    const { scanId, ids } = await seedSources(t, n);
    // "Story N" for the first source of the SECOND batch.
    const model = echoModel({ failTitle: `Story ${ANALYZE_BATCH_SIZE}` });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn));

    expect(outcome.ok).toBe(false);
    expect(outcome.batches).toBe(3);
    expect(outcome.failures.map((f) => f.batchIndex)).toEqual([1]);
    expect(outcome.failures[0].reason).toBe("invalid_output");

    // The other two batches were persisted, not rolled back with the failure.
    const rows = (await t.run(async (ctx) => await Promise.all(ids.map((id) => ctx.db.get(id))))) as Doc<"sourceResults">[];
    const analysed = rows.filter((r) => r.analysis !== undefined);
    expect(analysed).toHaveLength(ANALYZE_BATCH_SIZE * 2);
    expect(rows.slice(ANALYZE_BATCH_SIZE, ANALYZE_BATCH_SIZE * 2).every((r) => r.analysis === undefined)).toBe(true);
    expect(outcome.items).toHaveLength(ANALYZE_BATCH_SIZE * 2);

    // Two succeeded rows and one invalid row. The failed batch is still evidence.
    const runs = await allRuns(t);
    expect(runs.filter((r) => r.status === "succeeded")).toHaveLength(2);
    expect(runs.filter((r) => r.status === "invalid")).toHaveLength(1);
  });

  it("refuses a batch that answers about fewer sources than it was shown", async () => {
    const t = setup();
    const n = ANALYZE_BATCH_SIZE * 2;
    const { scanId, ids } = await seedSources(t, n);
    // Answers about the first half of every batch and stays silent about the rest.
    // `analyzeResultsOutput` is `.min(1)`, and `validateAgainstSources` only checks
    // that every id CITED is known — neither notices the sources left out.
    const half = ANALYZE_BATCH_SIZE / 2;
    const model = echoModel({ answerFirst: half });

    const outcome = await t.action(async (ctx) => await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn));

    // Twenty sources in, ten items out, must NOT be a clean success.
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.map((f) => f.batchIndex)).toEqual([0, 1]);
    expect(outcome.failures.every((f) => f.reason === "incomplete_coverage")).toBe(true);
    // Actionable: how many, and which ones went unanswered.
    expect(outcome.failures[0].errors[0]).toContain(`answered about ${half} of ${ANALYZE_BATCH_SIZE} sources`);
    expect(outcome.failures[0].errors[0]).toContain(ids[half]);

    // The half it DID answer is still persisted — we already paid for it, and the
    // run is `succeeded`, so `reopen` would refuse to ask again.
    expect(outcome.items).toHaveLength(half * 2);
    const rows = (await t.run(async (ctx) => await Promise.all(ids.map((id) => ctx.db.get(id))))) as Doc<"sourceResults">[];
    expect(rows.filter((r) => r.analysis !== undefined)).toHaveLength(half * 2);
    // The rule that matters: no row the model ignored claims to have been analysed.
    expect(rows.slice(half, ANALYZE_BATCH_SIZE).every((r) => r.analysis === undefined)).toBe(true);
  });

  it("stops the remaining batches when the scan is cancelled mid-run", async () => {
    const t = setup();
    const batches = ANALYZE_CONCURRENCY * 2;
    const n = ANALYZE_BATCH_SIZE * batches;
    const { scanId, ids } = await seedSources(t, n);
    const model = echoModel();
    // Cancelled as soon as the first call has been made.
    const shouldContinue = async () => model.calls === 0;

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn, shouldContinue));

    expect(outcome.canceled).toBe(true);
    expect(model.calls).toBeGreaterThan(0);
    expect(model.calls).toBeLessThanOrEqual(ANALYZE_CONCURRENCY);
    expect(model.calls).toBeLessThan(batches);

    // Nothing was paid for beyond what ran, and the ledger says so.
    const runs = await allRuns(t);
    expect(runs).toHaveLength(model.calls);
    const rows = (await t.run(async (ctx) => await Promise.all(ids.map((id) => ctx.db.get(id))))) as Doc<"sourceResults">[];
    expect(rows.filter((r) => r.analysis !== undefined)).toHaveLength(model.calls * ANALYZE_BATCH_SIZE);
  });

  it("pays for NOTHING when the scan was already cancelled before analyze started", async () => {
    const t = setup();
    const { scanId, ids } = await seedSources(t, ANALYZE_BATCH_SIZE * ANALYZE_CONCURRENCY * 2);
    const model = echoModel();

    const outcome = await t.action(async (ctx) =>
      await runAnalyzeResults(ctx, { scanId, sourceResultIds: ids }, model.fn, async () => false));

    // This is what pins the PLACEMENT of the cancel check. Move it after
    // `runBatch` and a scan cancelled before the stage began still pays for
    // ANALYZE_CONCURRENCY batches; the mid-run test cannot tell the difference,
    // because there all four workers evaluate the check before any call settles.
    expect(model.calls).toBe(0);
    expect(outcome.canceled).toBe(true);
    expect(await allRuns(t)).toHaveLength(0);
  });
});

describe("the evidence stage over batched analysis", () => {
  it("records ONE failure naming every batch that failed, because recordFailure dedupes by code", async () => {
    const t = setup();
    const { scanId, ids } = await seedSources(t, ANALYZE_BATCH_SIZE * 3);
    const model = echoModel({ failTitle: `Story ${ANALYZE_BATCH_SIZE}` });

    await t.action(async (ctx) => await runEvidenceStage(ctx, { scanId, sourceResultIds: ids }, model.fn));

    const scan = (await t.run(async (ctx) => await ctx.db.get(scanId))) as Doc<"scans">;
    const failures = scan.failureSummaries.filter((f) => f.code === "analyze_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("1 of 3");
    expect(failures[0].message).toContain("batch 1");
  });
});
