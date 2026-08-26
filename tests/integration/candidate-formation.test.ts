import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import { runCandidateFormation } from "../../convex/slice";
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

    const candidateId = "candidateId" in result ? result.candidateId : undefined;
    if (!candidateId) throw new Error("formFromCluster rejected the cluster");
    expect("created" in result && result.created).toBe(true);
    expect("sourceCount" in result && result.sourceCount).toBe(2);

    const { candidate, memberships, appearances } = await t.run(async (ctx) => ({
      candidate: (await ctx.db.get(candidateId)) as Doc<"candidates">,
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

/**
 * Defect 3 of the evidence-pipeline repair (MOO-736). `candidateFingerprint` is
 * `hash(sortedEntityKeys):beat`. Production sends `entityKeys: []`
 * (`convex/slice.ts:77`) and a hardcoded `beat: "housing"` (`convex/slice.ts:93`),
 * which makes that expression a CONSTANT — so `by_owner_fingerprint` finds the
 * candidate the first cluster made and every later cluster patches it instead of
 * creating its own. The live 294-source scan died in clustering and never reached
 * formation, so this had never been observed; nothing in 461 tests asserted that a
 * scan of N clusters yields more than one candidate.
 */
describe("a scan of N clusters", () => {
  const standaloneCluster = (id: Id<"sourceResults">, n: number) => ({
    sourceResultIds: [id] as string[],
    // The exact similarityBasis the real 294 clusters carried.
    similarityBasis: `No claim text or entity data supplied; standalone signal ${n}`,
    entityKeys: [] as string[],
    suggestedExistingCandidateId: null,
  });

  it("does not collapse three unrelated clusters into one candidate", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    const thirdId = await t.run(async (ctx) => {
      const scan = (await ctx.db.get(scanId))!;
      const run = (await ctx.db.query("searchRuns").first())!;
      return ctx.db.insert("sourceResults", {
        scanId, searchRunId: run._id, ownerId: scan.ownerId,
        canonicalKey: "k-third", canonicalUrl: "https://urbanmilwaukee.com/bus", originalUrl: "https://urbanmilwaukee.com/bus",
        engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
        title: "Bus route cut", snippet: "The 15 loses weekend service.", originalLanguage: "en",
        discoveredAt: Date.now(), isAccessible: true, contentHash: "h-third",
      });
    });

    for (const [n, id] of [officialId, newsId, thirdId].entries()) {
      await t.mutation(internal.candidates.form.formFromCluster, {
        scanId, cluster: standaloneCluster(id, n), beat: "housing", workingTitle: `Story ${n}`,
      });
    }

    const { candidates, memberships } = await t.run(async (ctx) => ({
      candidates: await ctx.db.query("candidates").collect(),
      memberships: await ctx.db.query("candidateSources").collect(),
    }));

    expect(candidates).toHaveLength(3);
    // The dangerous half: one row carrying every source in the scan is the
    // fabricated mega-lead, and its independentCategoryCount would treat the
    // whole scan as evidence for a single story.
    for (const c of candidates) {
      expect(memberships.filter((m) => m.candidateId === c._id)).toHaveLength(1);
    }
    expect(new Set(candidates.map((c) => c.fingerprint)).size).toBe(3);
  });

  /**
   * The plan's acceptance line, driven through the PRODUCTION path rather than
   * the mutation directly: `runCandidateFormation` is what `stages/evidence.ts`
   * calls, and `convex/slice.ts:77` sends `entityKeys: []` for every signal with
   * `beat: "housing"` hardcoded at line 93. Both stay true until Task 5.
   */
  it("forms one candidate per cluster through runCandidateFormation", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);

    const model: GenerateFn = async ({ system, prompt }) => {
      if (/Group the supplied signals/.test(system)) {
        return {
          object: { clusters: [officialId, newsId].map((id, n) => standaloneCluster(id, n)) },
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      // Echo back whichever source this candidate was formed from, so the
      // classifier's known-source-id validation passes for both clusters.
      const sourceResultId = prompt.match(/"sourceResultId": "([^"]+)"/)?.[1] ?? "";
      return {
        object: {
          beatSuggestion: "housing",
          localityBandSuggestion: "area_city_consequence",
          relevanceBandSuggestion: "policy_service_change",
          flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
          items: [{
            sourceResultIds: [sourceResultId], kind: "unverified_signal",
            claimText: "A claim.", exactExcerpt: null, originalLanguageText: null, translatedText: null,
            sourceTypeSuggestion: "secondary", independenceGroupSuggestion: null, relationship: "supports",
            milwaukeeConnection: "A Milwaukee parcel.", accessibilityConcern: false, repeatsPressRelease: false,
            reason: "One outlet reported it.",
          }],
        },
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    };

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: [officialId, newsId] }, model));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    expect(formed.candidates).toHaveLength(2);
    expect(new Set(formed.candidates.map((c) => c.candidateId)).size).toBe(2);
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(2);
  });
});
