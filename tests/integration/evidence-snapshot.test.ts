import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

async function seed(t: ReturnType<typeof setup>, opts: { accessible?: boolean } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    const sourceResultId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k", canonicalUrl: "https://jsonline.com/a", originalUrl: "https://jsonline.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "Neighbors question rezoning", snippet: "They say they were not notified.",
      originalLanguage: "en", discoveredAt: now,
      isAccessible: opts.accessible ?? true, contentHash: "h",
    });
    const orphanId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k2", canonicalUrl: "https://other.com/a", originalUrl: "https://other.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h",
    });
    await ctx.db.insert("candidateSources", {
      candidateId, scanId, sourceResultId, role: "initiating" as const,
      independenceGroup: "host:jsonline.com", signalCategory: "original_news" as const, addedBy: "ai_suggestion" as const,
    });
    const modelRunId = await ctx.db.insert("modelRuns", {
      scanId, candidateId, ownerId, operation: "classifyEvidence" as const,
      idempotencyKey: "k", provider: "anthropic", modelId: "claude-sonnet-5",
      promptVersion: "2", schemaVersion: "1", inputSnapshotHash: "h",
      status: "succeeded" as const, attempt: 1, startedAt: now,
    });
    return { ownerId, scanId, candidateId, sourceResultId, orphanId, modelRunId };
  });
}

const item = (ids: string[], over: Record<string, unknown> = {}) => ({
  sourceResultIds: ids,
  kind: "unverified_signal",
  claimText: "Neighbors say they were not notified.",
  exactExcerpt: null,
  originalLanguageText: null,
  translatedText: null,
  ...over,
});

const rows = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];

describe("evidence snapshot", () => {
  it("writes version 1 and moves the candidate's latestEvidenceVersion", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });

    expect(result).toEqual({ evidenceVersion: 1, written: 1 });
    const candidate = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(candidate.latestEvidenceVersion).toBe(1);
  });

  it("appends version 2 without touching version 1", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    const args = { scanId, candidateId, modelRunId, items: [item([sourceResultId])] };

    await t.mutation(internal.candidates.snapshot.writeSnapshot, args);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      ...args, items: [item([sourceResultId], { claimText: "A second look at the same claim." })],
    });

    const all = await rows(t);
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.evidenceVersion).sort()).toEqual([1, 2]);
    expect(all.find((r) => r.evidenceVersion === 1)?.claimText).toBe("Neighbors say they were not notified.");
  });

  it("refuses the whole snapshot when any kind is confirmed_fact", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId]), item([sourceResultId], { kind: "confirmed_fact" })],
    });

    expect(result).toEqual({ rejected: "cannot_confirm" });
    expect(await rows(t)).toHaveLength(0);
  });

  it("refuses the whole snapshot when an item cites a source outside this candidate", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, orphanId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId]), item([orphanId])],
    });

    expect(result).toEqual({ rejected: "source_not_in_candidate" });
    expect(await rows(t)).toHaveLength(0);
  });

  it("marks an item as needing recheck when its source is not reachable", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t, { accessible: false });

    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });

    expect((await rows(t))[0].requiresReverification).toBe(true);
  });

  it("does not mark a reachable source as needing recheck", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });
    expect((await rows(t))[0].requiresReverification).toBe(false);
  });

  it("records which model run produced the item", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });
    const all = await rows(t);
    expect(all[0].createdByModelRunId).toBe(modelRunId);
    expect(all[0].classificationBasis).toBe("ai_suggested");
  });

  it("keeps a translation beside its original", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId], { originalLanguageText: "Se aprobó.", translatedText: "It was approved." })],
    });
    const all = await rows(t);
    expect(all[0].originalLanguageText).toBe("Se aprobó.");
    expect(all[0].translatedText).toBe("It was approved.");
  });
});
