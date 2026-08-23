import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { EMPTY_SECTION_NOTES, runGenerateBrief } from "../../convex/ai/generateBrief";
import type { GenerateFn } from "../../convex/ai/provider";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const fixedModel = (object: unknown): GenerateFn => async () =>
  ({ object, usage: { inputTokens: 200, outputTokens: 90 } });

const OFFICIAL_SNIPPET = "The rezoning of the 3000 block is item 250412.";
const NEWS_SNIPPET = "Neighbors say they were not notified.";

type SeedOptions = { confirmed: boolean; coverage: boolean; coveragePassStatus?: "pending" | "complete" | "failed" };

async function seed(t: ReturnType<typeof setup>, opts: SeedOptions) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "Harambee rezoning heads to a council vote",
      reportingQuestion: "?", beat: "housing" as const, status: "eligible" as const,
      primaryLabel: "Worth a look" as const, disposition: "new" as const,
      latestEvidenceVersion: 1, independentCategoryCount: 2, coverageOriginalCount: 0,
      coveragePassStatus: opts.coveragePassStatus ?? "complete",
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });

    const source = (over: Record<string, unknown>) => ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: `k${Math.random()}`, canonicalUrl: "https://example.com/a", originalUrl: "https://example.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h", ...over,
    });

    const officialId = await source({
      sourceFamily: "official" as const, sourceType: "primary" as const,
      title: "Common Council agenda 250412", snippet: OFFICIAL_SNIPPET,
      canonicalUrl: "https://city.milwaukee.gov/agenda",
    });
    const newsId = await source({ title: "Neighbors question rezoning", snippet: NEWS_SNIPPET });

    const evidence = (kind: string, claimText: string, ids: Id<"sourceResults">[]) =>
      ctx.db.insert("evidenceItems", {
        candidateId, scanId, ownerId, evidenceVersion: 1, kind: kind as never,
        claimText, sourceResultIds: ids, classificationBasis: "deterministic",
        requiresReverification: false,
      });

    if (opts.confirmed) await evidence("confirmed_fact", "The item is on the council agenda.", [officialId]);
    await evidence("unverified_signal", "Neighbors say they were not notified.", [newsId]);
    if (opts.coverage) await evidence("existing_coverage", "One outlet covered it.", [newsId]);

    return { ownerId, scanId, candidateId, officialId, newsId };
  });
}

const block = (text: string, ids: string[], exactExcerpt: string | null = null) => ({ text, sourceResultIds: ids, exactExcerpt });

const briefOutput = (over: Record<string, unknown> = {}) => ({
  reportingQuestion: "Who was notified before the council took up the rezoning?",
  whySurfaced: "An official agenda item and a local report describe the same rezoning.",
  confirmedFacts: [], unverifiedClaims: [], conflicts: [], existingCoverage: [], potentialHumanSources: [],
  interviewQuestions: ["Who received notice, and when?"],
  ...over,
});

const allRuns = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())) as Doc<"modelRuns">[];

const allBriefs = async (t: ReturnType<typeof setup>) =>
  (await t.run(async (ctx) => await ctx.db.query("briefVersions").collect())) as Doc<"briefVersions">[];

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("generateBrief", () => {
  it("writes a brief version and links it to the model run that produced it", async () => {
    const t = setup();
    const { scanId, candidateId, officialId, newsId } = await seed(t, { confirmed: true, coverage: true });

    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("The item is on the council agenda.", [officialId], OFFICIAL_SNIPPET)],
      unverifiedClaims: [block("Neighbors say they were not notified.", [newsId])],
      existingCoverage: [block("One outlet has covered it.", [newsId])],
    }))));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.version).toBe(1);

    const briefs = await allBriefs(t);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].modelRunId).toBe(outcome.modelRunId);
    expect(briefs[0].confirmedFacts[0].sourceResultIds).toEqual([officialId]);

    const candidate = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(candidate.latestBriefVersion).toBe(1);
  });

  it("rejects the WHOLE brief when a citation names a source that was never supplied", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { confirmed: true, coverage: false });

    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      unverifiedClaims: [block("Something else happened.", ["src_the_model_made_up"])],
    }))));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toContain("src_the_model_made_up");
    expect(await allBriefs(t)).toHaveLength(0);
    expect((await allRuns(t))[0].status).toBe("invalid");
  });

  it("rejects a brief that promotes an unconfirmed claim into the confirmed section", async () => {
    const t = setup();
    const { scanId, candidateId, newsId } = await seed(t, { confirmed: true, coverage: false });

    // newsId is real and supplied, but the deterministic layer classified only the
    // official source as confirming.
    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("Neighbors were not notified.", [newsId])],
    }))));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toMatch(/did not classify as confirming/);
    expect(await allBriefs(t)).toHaveLength(0);
  });

  it("rejects any confirmed fact at all when nothing was deterministically confirmed", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: false, coverage: false });

    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("The item is on the agenda.", [officialId])],
    }))));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(await allBriefs(t)).toHaveLength(0);
  });

  it("rejects a quotation that is not character-for-character in the stored source", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: true, coverage: false });

    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("On the agenda.", [officialId], "The rezoning of the 3000 block is item 250413.")],
    }))));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.join(" ")).toMatch(/word-for-word/);
  });

  it("writes OUR cautious sentence for an empty section rather than letting the model fill it", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: true, coverage: false });

    const outcome = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("The item is on the council agenda.", [officialId])],
    }))));

    expect(outcome.ok).toBe(true);
    const brief = (await allBriefs(t))[0];
    expect(brief.existingCoverage).toEqual([
      { text: EMPTY_SECTION_NOTES.existingCoverageComplete, sourceResultIds: [] },
    ]);
    expect(brief.conflicts[0].text).toBe(EMPTY_SECTION_NOTES.conflicts);
    expect(brief.potentialHumanSources[0].text).toBe(EMPTY_SECTION_NOTES.potentialHumanSources);
  });

  it("says coverage is UNKNOWN, not absent, when the coverage check did not complete", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: true, coverage: false, coveragePassStatus: "failed" });

    await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      confirmedFacts: [block("The item is on the council agenda.", [officialId])],
    }))));

    const brief = (await allBriefs(t))[0];
    expect(brief.existingCoverage[0].text).toBe(EMPTY_SECTION_NOTES.existingCoverageIncomplete);
  });

  it("says nothing is confirmed, in our words, when the confirmed section is empty", async () => {
    const t = setup();
    const { scanId, candidateId, newsId } = await seed(t, { confirmed: false, coverage: false });

    await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, fixedModel(briefOutput({
      unverifiedClaims: [block("Neighbors say they were not notified.", [newsId])],
    }))));

    const brief = (await allBriefs(t))[0];
    expect(brief.confirmedFacts).toEqual([{ text: EMPTY_SECTION_NOTES.confirmedFacts, sourceResultIds: [] }]);
  });

  it("refuses to pay for the same brief twice, and writes no duplicate version", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: true, coverage: false });
    let calls = 0;
    const model: GenerateFn = async () => {
      calls++;
      return {
        object: briefOutput({ confirmedFacts: [block("The item is on the council agenda.", [officialId])] }),
        usage: { inputTokens: 200, outputTokens: 90 },
      };
    };

    const first = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, model));
    expect(first.ok).toBe(true);

    // Same candidate, same evidence: the spec's idempotency key is identical, so
    // the model must NOT be asked again.
    const second = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId }, model));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_generated");
    expect(calls).toBe(1);
    expect(await allBriefs(t)).toHaveLength(1);
  });

  it("retries after a failed run instead of refusing it as already generated", async () => {
    const t = setup();
    const { scanId, candidateId, officialId } = await seed(t, { confirmed: true, coverage: false });

    const bad = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId },
      fixedModel(briefOutput({ confirmedFacts: [block("x", ["src_invented"])] }))));
    expect(bad.ok).toBe(false);

    const good = await t.action(async (ctx) => await runGenerateBrief(ctx, { scanId, candidateId },
      fixedModel(briefOutput({ confirmedFacts: [block("The item is on the council agenda.", [officialId])] }))));
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.version).toBe(1);

    const runs = await allRuns(t);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].attempt).toBe(2);
  });
});
