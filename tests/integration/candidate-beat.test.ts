import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

/**
 * Task 4b (MOO-736). Formation runs BEFORE classification — the classifier needs
 * a candidateId, so it cannot go first. Until this change `slice.ts` bridged that
 * gap by handing `formFromCluster` a hardcoded `beat: "housing"`, and the live
 * 2026-08-26 scan proves what that costs: four of its five most recent candidates
 * carry `beat: "housing"` with `judgment.beat === null` and `no_beat_relevance`
 * in their exclusion reasons. The card asserted a beat the product never
 * established, and the feed filed those leads under Housing.
 */

const judged = (value: string, basis: "deterministic" | "ai_suggested" | "editor" = "ai_suggested", reason = "r") =>
  ({ value, basis, reason });
const flag = (value: boolean) => ({ value, basis: "ai_suggested" as const, reason: "flagged by the model" });

const judgmentWith = (beat: ReturnType<typeof judged> | null) => ({
  localityBand: judged("direct_city", "deterministic"),
  relevanceBand: judged("policy_service_change"),
  beat,
  isSpeculative: flag(false),
  isRoutineCrime: flag(false),
  isDuplicateOfCandidate: flag(false),
  hasMaterialConflict: flag(false),
});

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const laterScanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const laterRunId = await ctx.db.insert("searchRuns", searchRunDoc(laterScanId, ownerId));

    const source = (sId: Id<"scans">, rId: Id<"searchRuns">, key: string) => ctx.db.insert("sourceResults", {
      scanId: sId, searchRunId: rId, ownerId,
      canonicalKey: key, canonicalUrl: "https://city.milwaukee.gov/agenda", originalUrl: "https://city.milwaukee.gov/agenda",
      engine: "google" as const, sourceFamily: "official" as const, sourceType: "unknown" as const,
      title: "Common Council agenda", snippet: "Rezoning of the 3000 block.", originalLanguage: "en",
      discoveredAt: now, isAccessible: true, contentHash: "h",
    });

    return {
      ownerId, scanId, laterScanId,
      sourceId: await source(scanId, searchRunId, "k-first"),
      laterSourceId: await source(laterScanId, laterRunId, "k-later"),
    };
  });
}

const cluster = (ids: Id<"sourceResults">[], entityKeys = ["Harambee", "rezoning"]) => ({
  sourceResultIds: ids as string[],
  similarityBasis: "Both describe the same Common Council agenda item.",
  entityKeys,
  suggestedExistingCandidateId: null,
});

const read = async (t: ReturnType<typeof setup>, id: Id<"candidates">) =>
  (await t.run(async (ctx) => await ctx.db.get(id))) as Doc<"candidates">;

async function form(t: ReturnType<typeof setup>, scanId: Id<"scans">, sourceId: Id<"sourceResults">) {
  const result = await t.mutation(internal.candidates.form.formFromCluster, {
    scanId, cluster: cluster([sourceId]), workingTitle: "Harambee rezoning",
  });
  const candidateId = "candidateId" in result ? result.candidateId : undefined;
  if (!candidateId) throw new Error("formFromCluster rejected the cluster");
  return { candidateId, created: "created" in result && result.created };
}

describe("a candidate whose beat was never established", () => {
  it("does not claim one at formation", async () => {
    const t = setup();
    const { scanId, sourceId } = await seed(t);

    const { candidateId } = await form(t, scanId, sourceId);

    // Not "housing". Not any beat. Formation cannot know, and the honest
    // encoding of "not known" is absence, not a default.
    expect((await read(t, candidateId)).beat).toBeUndefined();
  });

  it("still claims none when the classifier says the story is in no covered beat", async () => {
    const t = setup();
    const { scanId, sourceId } = await seed(t);
    const { candidateId } = await form(t, scanId, sourceId);

    // The live scan's dominant case: classification SUCCEEDS and returns null,
    // which is what `no_beat_relevance` is derived from.
    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: judgmentWith(null) });

    expect((await read(t, candidateId)).beat).toBeUndefined();
  });

  it("claims none when the model invents a fifth beat", async () => {
    const t = setup();
    const { scanId, sourceId } = await seed(t);
    const { candidateId } = await form(t, scanId, sourceId);

    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: judgmentWith(judged("weather")) });

    expect((await read(t, candidateId)).beat).toBeUndefined();
  });

  it("takes the beat the classifier does establish", async () => {
    const t = setup();
    const { scanId, sourceId } = await seed(t);
    const { candidateId } = await form(t, scanId, sourceId);

    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: judgmentWith(judged("transportation")),
    });

    expect((await read(t, candidateId)).beat).toBe("transportation");
  });
});

describe("the fingerprint outlives a beat correction", () => {
  it("does not change when the classifier moves the beat", async () => {
    const t = setup();
    const { scanId, sourceId } = await seed(t);
    const { candidateId } = await form(t, scanId, sourceId);
    const before = (await read(t, candidateId)).fingerprint;

    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: judgmentWith(judged("transportation")),
    });

    expect((await read(t, candidateId)).beat).toBe("transportation");
    expect((await read(t, candidateId)).fingerprint).toBe(before);
  });

  it("still matches the same story on a later scan after the beat moved", async () => {
    const t = setup();
    const { scanId, laterScanId, sourceId, laterSourceId } = await seed(t);
    const first = await form(t, scanId, sourceId);
    expect(first.created).toBe(true);

    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId: first.candidateId, judgment: judgmentWith(judged("transportation")),
    });

    // The same entity keys, a later scan. Cross-scan continuity is the whole
    // point of a fingerprint: this must find the candidate, not mint a second.
    const second = await form(t, laterScanId, laterSourceId);
    expect(second.created).toBe(false);
    expect(second.candidateId).toBe(first.candidateId);
  });

  it("still separates two clusters with different entity keys", async () => {
    const t = setup();
    const { scanId, sourceId, ownerId } = await seed(t);
    const otherSourceId = await t.run(async (ctx) => {
      const run = (await ctx.db.query("searchRuns").first())!;
      return ctx.db.insert("sourceResults", {
        scanId, searchRunId: run._id, ownerId,
        canonicalKey: "k-other", canonicalUrl: "https://urbanmilwaukee.com/bus", originalUrl: "https://urbanmilwaukee.com/bus",
        engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
        title: "Bus route cut", snippet: "The 15 loses weekend service.", originalLanguage: "en",
        discoveredAt: Date.now(), isAccessible: true, contentHash: "h-other",
      });
    });

    const a = await form(t, scanId, sourceId);
    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([otherSourceId], ["Bay View"]), workingTitle: "Bus route cut",
    });
    const bId = "candidateId" in result ? result.candidateId : undefined;
    if (!bId) throw new Error("formFromCluster rejected the cluster");

    expect(bId).not.toBe(a.candidateId);
    expect((await read(t, a.candidateId)).fingerprint).not.toBe((await read(t, bId)).fingerprint);
  });
});
