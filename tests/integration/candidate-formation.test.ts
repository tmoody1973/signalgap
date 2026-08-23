import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const otherScanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const source = (over: Record<string, unknown>) => ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: `k${Math.random()}`, canonicalUrl: "https://jsonline.com/a", originalUrl: "https://jsonline.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h", ...over,
    });

    const officialId = await source({
      sourceFamily: "official" as const, canonicalUrl: "https://city.milwaukee.gov/agenda",
      title: "Common Council agenda 250412", snippet: "Rezoning of the 3000 block.",
    });
    const newsId = await source({ title: "Neighbors question rezoning", snippet: "They say they were not notified." });
    const foreignId = await ctx.db.insert("sourceResults", {
      scanId: otherScanId, searchRunId, ownerId,
      canonicalKey: "k-foreign", canonicalUrl: "https://elsewhere.com/x", originalUrl: "https://elsewhere.com/x",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h",
    });

    return { ownerId, scanId, otherScanId, officialId, newsId, foreignId };
  });
}

const cluster = (ids: Id<"sourceResults">[], entityKeys = ["Harambee", "rezoning"]) => ({
  sourceResultIds: ids as string[],
  similarityBasis: "Both describe the same Common Council agenda item.",
  entityKeys,
  suggestedExistingCandidateId: null,
});

describe("formFromCluster", () => {
  it("creates one candidate, one membership row per source, and one appearance", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);

    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "Harambee rezoning",
    });

    expect("candidateId" in result).toBe(true);
    if (!("candidateId" in result)) return;
    expect(result.created).toBe(true);
    expect(result.sourceCount).toBe(2);

    const { candidate, memberships, appearances } = await t.run(async (ctx) => ({
      candidate: (await ctx.db.get(result.candidateId)) as Doc<"candidates">,
      memberships: await ctx.db.query("candidateSources").collect(),
      appearances: await ctx.db.query("candidateAppearances").collect(),
    }));

    expect(candidate.status).toBe("processing");
    expect(candidate.beat).toBe("housing");
    expect(candidate.currentTitle).toBe("Harambee rezoning");
    expect(memberships).toHaveLength(2);
    expect(appearances).toHaveLength(1);
    expect(appearances[0].scanId).toBe(scanId);
  });

  it("makes the first source initiating and the rest corroborating", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "T",
    });

    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships.find((m) => m.sourceResultId === officialId)?.role).toBe("initiating");
    expect(memberships.find((m) => m.sourceResultId === newsId)?.role).toBe("corroborating");
  });

  it("records that the AI proposed the membership", async () => {
    const t = setup();
    const { scanId, officialId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId]), beat: "housing", workingTitle: "T",
    });
    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships[0].addedBy).toBe("ai_suggestion");
  });

  it("derives the signal category from the source family, not from anything the model said", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "T",
    });
    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships.find((m) => m.sourceResultId === officialId)?.signalCategory).toBe("official_record");
    expect(memberships.find((m) => m.sourceResultId === newsId)?.signalCategory).toBe("original_news");
  });

  it("reuses the candidate on a second identical cluster and does not duplicate membership", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    const args = { scanId, cluster: cluster([officialId, newsId]), beat: "housing" as const, workingTitle: "T" };

    const first = await t.mutation(internal.candidates.form.formFromCluster, args);
    const second = await t.mutation(internal.candidates.form.formFromCluster, args);

    expect("candidateId" in first && "candidateId" in second).toBe(true);
    if (!("candidateId" in first) || !("candidateId" in second)) return;
    expect(second.candidateId).toBe(first.candidateId);
    expect(second.created).toBe(false);

    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships).toHaveLength(2);
  });

  it("ignores a source id belonging to a different scan", async () => {
    const t = setup();
    const { scanId, officialId, foreignId } = await seed(t);
    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, foreignId]), beat: "housing", workingTitle: "T",
    });
    expect("candidateId" in result && result.sourceCount).toBe(1);
  });

  it("refuses a cluster whose sources are all unusable rather than creating an empty candidate", async () => {
    const t = setup();
    const { scanId, foreignId } = await seed(t);
    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([foreignId]), beat: "housing", workingTitle: "T",
    });
    expect(result).toEqual({ rejected: "no_valid_sources" });
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(0);
  });

  it("keeps two clusters with different entities as two candidates", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId], ["Harambee"]), beat: "housing", workingTitle: "A",
    });
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([newsId], ["Bay View"]), beat: "housing", workingTitle: "B",
    });
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(2);
  });
});
