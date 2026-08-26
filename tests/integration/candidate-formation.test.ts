import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { MAX_ADJUDICATED_CLUSTER_SIZE, MAX_ADJUDICATED_PAIRS } from "../../convex/ai/contracts";
import type { GenerateFn } from "../../convex/ai/provider";
import { candidateFingerprint, clusterIdentityKeys } from "../../convex/candidates/fingerprint";
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

/**
 * A fake model for the formation path. Since Task 5 nothing asks a model to
 * cluster, so this only answers `classifyEvidence` — echoing back whichever
 * source the candidate was formed from, so the classifier's known-source-id
 * validation passes for every cluster.
 */
function classifyOnlyModel(): GenerateFn {
  return async ({ prompt }) => {
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
}

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

  it("builds identity from the sources that survived the re-read, not the ids the model proposed", async () => {
    const t = setup();
    const { scanId, officialId, foreignId } = await seed(t);

    // `foreignId` belongs to another scan, so it is dropped at form.ts:41 and can
    // never become evidence. Letting it into the fingerprint would mean two
    // clusters with different unusable padding read as two different stories.
    const first = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, foreignId], []), beat: "housing", workingTitle: "T",
    });

    const candidates = await t.run(async (ctx) => await ctx.db.query("candidates").collect());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].fingerprint).toBe(candidateFingerprint(clusterIdentityKeys([], [officialId]), "housing"));

    // Same story, this time proposed without the dead id: same identity, so the
    // existing candidate is reused rather than a near-duplicate created.
    const second = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId], []), beat: "housing", workingTitle: "T",
    });
    expect("candidateId" in first && "candidateId" in second && second.candidateId === first.candidateId).toBe(true);
    expect("created" in second && second.created).toBe(false);
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
   * calls. Since Task 5 the grouping is deterministic — `convex/editorial/blocking.ts`
   * decides it, and the injected model is never asked to cluster at all. These two
   * sources share one token ("rezoning"), which scores below `REJECT_THRESHOLD`,
   * so they stay two candidates.
   */
  it("forms one candidate per cluster through runCandidateFormation", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    const model = classifyOnlyModel();

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: [officialId, newsId] }, model));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    expect(formed.candidates).toHaveLength(2);
    expect(new Set(formed.candidates.map((c) => c.candidateId)).size).toBe(2);
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(2);
  });
});

/**
 * The trapdoor Task 4's review named. `clusterIdentityKeys` gives an entity-less
 * cluster a distinct identity built from its own source ids — which is scan-local,
 * so such a candidate can never match a prior scan's. Every one of Task 4's seven
 * tests passes either way, because they assert distinctness and the fallback
 * provides it. So the degradation needs a tell, and the tell needs a test.
 */
describe("the source-id identity fallback is not silent", () => {
  it("names the fallback in failures when a cluster carries no entity key", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    // `seed` inserts sources with no `analysis`, which is what an unanalysed row
    // looks like — exactly the state that makes every cluster take the fallback.
    const { scanId, officialId, newsId } = await seed(t);

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: [officialId, newsId] }, classifyOnlyModel()));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    expect(formed.candidates).toHaveLength(2);
    for (const candidate of formed.candidates) {
      expect(candidate.failures.some((f) => f.startsWith("identity: no entity keys"))).toBe(true);
    }
  });

  it("stays quiet, and uses the persisted entity keys, once analyzeResults has run", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);

    const modelRunId = await t.run(async (ctx) => {
      const scan = (await ctx.db.get(scanId))!;
      const runId = await ctx.db.insert("modelRuns", {
        scanId, ownerId: scan.ownerId, operation: "analyzeResults" as const,
        idempotencyKey: "analyze-1", provider: "anthropic", modelId: "claude-sonnet-5",
        promptVersion: "1", schemaVersion: "1", inputSnapshotHash: "h",
        status: "succeeded" as const, attempt: 1, startedAt: Date.now(),
      });
      // Distinct keys, so the two sources still form two candidates and the only
      // thing under test is whether the persisted keys reach cluster identity.
      await ctx.db.patch(officialId, {
        analysis: { entityKeys: ["Common Council"], claimSummary: "An agenda item.", claims: [], dates: [], modelRunId: runId },
      });
      await ctx.db.patch(newsId, {
        analysis: { entityKeys: ["Harambee"], claimSummary: "Neighbours object.", claims: [], dates: [], modelRunId: runId },
      });
      return runId;
    });
    expect(modelRunId).toBeTruthy();

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: [officialId, newsId] }, classifyOnlyModel()));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    for (const candidate of formed.candidates) {
      expect(candidate.failures.some((f) => f.startsWith("identity: no entity keys"))).toBe(false);
    }

    // The fingerprints are the entity-key ones, not the source-id fallback. This
    // is what cross-scan continuity rests on, and it is the assertion that fails
    // if the grouper ever stops reading `sourceResults.analysis.entityKeys`.
    const fingerprints = await t.run(async (ctx) =>
      (await ctx.db.query("candidates").collect()).map((c) => c.fingerprint).sort());
    expect(fingerprints).toEqual([
      candidateFingerprint(["Common Council"], "housing"),
      candidateFingerprint(["Harambee"], "housing"),
    ].sort());
  });
});

/**
 * The ambiguous band, on the production path.
 *
 * `runCandidateFormation` asks a model exactly one question about grouping — one
 * yes/no per pair the deterministic score left in `[REJECT_THRESHOLD,
 * LINK_THRESHOLD)` — and the answer is a suggestion `groupSignals` re-checks
 * against its own score. These tests pin the two things that must hold when that
 * call goes wrong: the scan still produces clusters, and the scan says so.
 */
describe("adjudicating the ambiguous band from formation", () => {
  /**
   * Nine sources, so `cutoffsFor` runs its production branch. The first two share
   * exactly two full-weight tokens and score 2 — the floor of the band, so the
   * code deliberately declines to decide. The other seven share nothing.
   */
  async function seedBandScan(t: ReturnType<typeof setup>) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
      const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
      const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
      const source = (title: string, key: string) => ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: key, canonicalUrl: `https://example.com/${key}`, originalUrl: `https://example.com/${key}`,
        engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
        title, snippet: "", originalLanguage: "en", discoveredAt: now, isAccessible: true, contentHash: key,
      });
      const a = await source("Harambee rezoning delayed", "k-a");
      const b = await source("Harambee rezoning proceeds", "k-b");
      const rest: Id<"sourceResults">[] = [];
      for (let i = 0; i < 7; i++) rest.push(await source(`Ward ${i} budget hearing`, `k-r${i}`));
      return { scanId, ids: [a, b, ...rest] };
    });
  }

  const failures = async (t: ReturnType<typeof setup>, scanId: Id<"scans">) =>
    ((await t.run(async (ctx) => await ctx.db.get(scanId))) as Doc<"scans">).failureSummaries;

  it("still produces clusters from the auto-links when adjudication fails", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, ids } = await seedBandScan(t);
    const classify = classifyOnlyModel();
    // Only the adjudication call fails. Everything downstream is untouched.
    const model: GenerateFn = async (args) => {
      if (/do these two describe the SAME underlying story/.test(args.system)) {
        throw Object.assign(new Error("upstream is down"), { statusCode: 503 });
      }
      return classify(args);
    };

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    // The deterministic layer's answer stands: nine singletons, nothing lost.
    expect(formed.candidates).toHaveLength(9);
    // And the scan says the band went unadjudicated rather than swallowing it.
    const summaries = await failures(t, scanId);
    expect(summaries.map((f) => f.code)).toContain("adjudicate_failed");
    expect(summaries.find((f) => f.code === "adjudicate_failed")?.message).toContain("1 ambiguous pairs");
  });

  it("merges the pair when the adjudicator says same story", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, ids } = await seedBandScan(t);
    const classify = classifyOnlyModel();
    const model: GenerateFn = async (args) => {
      if (/do these two describe the SAME underlying story/.test(args.system)) {
        const pairIds = [...args.prompt.matchAll(/"pairId": "([^"]+)"/g)].map((m) => m[1]);
        return {
          object: { verdicts: pairIds.map((pairId) => ({ pairId, sameStory: true, reason: "One rezoning decision, reported twice." })) },
          usage: {},
        };
      }
      return classify(args);
    };

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    // Eight, not nine: the adjudicated pair is one candidate carrying two sources.
    expect(formed.candidates).toHaveLength(8);
    expect(formed.candidates.filter((c) => c.sourceResultIds.length === 2)).toHaveLength(1);
    expect(await failures(t, scanId)).toHaveLength(0);
  });

  /**
   * The ceiling, end to end. 402 sources in 201 disjoint two-token pairs, so the
   * band is 201 and exactly one pair is past `MAX_ADJUDICATED_PAIRS`. What must
   * NOT happen is the thing this project keeps getting caught by: the extra pair
   * disappearing without a word.
   *
   * `shouldContinue` returns true for the adjudication check and false at the top
   * of the cluster loop, so the test stops after the call it is about rather than
   * forming 401 candidates.
   */
  it("stops at the ceiling and says how many pairs it could not send", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const word = (n: number, suffix: string) => `zq${n.toString(36)}${suffix}`;
    const { scanId, ids } = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
      const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
      const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
      const ids: Id<"sourceResults">[] = [];
      for (let n = 0; n < MAX_ADJUDICATED_PAIRS + 1; n++) {
        const title = `${word(n, "aa")} ${word(n, "bb")}`;
        for (const half of ["x", "y"]) {
          ids.push(await ctx.db.insert("sourceResults", {
            scanId, searchRunId, ownerId,
            canonicalKey: `k${n}${half}`, canonicalUrl: `https://example.com/${n}${half}`, originalUrl: `https://example.com/${n}${half}`,
            engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
            title, snippet: "", originalLanguage: "en", discoveredAt: now, isAccessible: true, contentHash: `${n}${half}`,
          }));
        }
      }
      return { scanId, ids };
    });

    let sentPairs = 0;
    const model: GenerateFn = async ({ system, prompt }) => {
      expect(system).toMatch(/do these two describe the SAME underlying story/);
      const pairIds = [...prompt.matchAll(/"pairId": "([^"]+)"/g)].map((m) => m[1]);
      sentPairs = pairIds.length;
      return { object: { verdicts: pairIds.map((pairId) => ({ pairId, sameStory: false, reason: "Different stories." })) }, usage: {} };
    };
    let calls = 0;
    const shouldContinue = async () => { calls++; return calls === 1; };

    await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model, shouldContinue));

    expect(sentPairs).toBe(MAX_ADJUDICATED_PAIRS);
    const summaries = await failures(t, scanId);
    expect(summaries.map((f) => f.code)).toContain("adjudicate_capped");
    expect(summaries.find((f) => f.code === "adjudicate_capped")?.message)
      .toBe(`1 ambiguous pairs were past the per-call ceiling of ${MAX_ADJUDICATED_PAIRS} and stay unlinked`);
  });

  /**
   * A workflow retry, reproduced. `buildEvidence` is a `step.runAction`, so a
   * step that fails after adjudication succeeded re-enters the WHOLE action:
   * same signals, same band, same `inputSnapshotHash`. `modelRuns.create` finds
   * the succeeded row, `reopen` refuses it, and `runAiOperation` returns
   * `already_generated` — with no way to get the 39 verdicts back, because a
   * `modelRuns` row stores the ledger and never the answer.
   *
   * The thing this test exists to prevent is the second pass quietly grouping
   * from the auto-links alone and calling the result a success.
   */
  it("does not produce a different candidate set when the same formation runs twice", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, ids } = await seedBandScan(t);
    const classify = classifyOnlyModel();
    const model: GenerateFn = async (args) => {
      if (/do these two describe the SAME underlying story/.test(args.system)) {
        const pairIds = [...args.prompt.matchAll(/"pairId": "([^"]+)"/g)].map((m) => m[1]);
        return {
          object: { verdicts: pairIds.map((pairId) => ({ pairId, sameStory: true, reason: "One rezoning decision, reported twice." })) },
          usage: {},
        };
      }
      return classify(args);
    };

    const first = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.candidates).toHaveLength(8);

    const second = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model));

    // The second pass cannot recover the verdicts, so it must NOT pretend it
    // grouped the same way. It stops and says why — what it may never do is
    // hand back nine and call the difference a routine adjudication failure.
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("adjudicate_unrecoverable: already_generated");
    expect(second.errors[0]).toContain("cannot be read back");
    // And it did not quietly record the coarser run as an ordinary failure.
    expect((await failures(t, scanId)).map((f) => f.code)).not.toContain("adjudicate_failed");
  });

  /**
   * The over-merge tell.
   *
   * Nine sources in a CHAIN, not a clique: source i shares two invented tokens
   * with i-1 and two different ones with i+1, and shares nothing with anyone
   * else. Each shared token therefore has df 2 — full weight — so each of the
   * eight consecutive pairs scores exactly 2.0, the floor of the ambiguous band.
   * (A clique would not work: nine sources sharing one token puts its df at 9,
   * past `BLOCK_MAX_DF`, and blocking drops it before any pair is proposed.)
   *
   * A model answering yes to all eight chains them into one nine-source cluster
   * having never been shown a pair further apart than one link. That is exactly
   * the mechanism `task-6-review.md` §2 measured on the real 294 — an all-yes
   * answer over the 89 band pairs yields a largest cluster of 18 — and until
   * this guard existed nothing at runtime looked at the number.
   */
  it("says so on the scan when adjudication chains one cluster past the ceiling", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
    const t = setup();
    const { scanId, ids } = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
      const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
      const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
      const ids: Id<"sourceResults">[] = [];
      // The two tokens shared by source i and source i+1, and nobody else.
      const link = (i: number) => `zq${String.fromCharCode(97 + i)}p zq${String.fromCharCode(97 + i)}q`;
      const size = MAX_ADJUDICATED_CLUSTER_SIZE + 1;
      for (let i = 0; i < size; i++) {
        const title = [i > 0 ? link(i - 1) : "", i < size - 1 ? link(i) : ""].filter(Boolean).join(" ");
        ids.push(await ctx.db.insert("sourceResults", {
          scanId, searchRunId, ownerId,
          canonicalKey: `k${i}`, canonicalUrl: `https://example.com/${i}`, originalUrl: `https://example.com/${i}`,
          engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
          title, snippet: "", originalLanguage: "en",
          discoveredAt: now, isAccessible: true, contentHash: `c${i}`,
        }));
      }
      return { scanId, ids };
    });

    const classify = classifyOnlyModel();
    const model: GenerateFn = async (args) => {
      if (/do these two describe the SAME underlying story/.test(args.system)) {
        const pairIds = [...args.prompt.matchAll(/"pairId": "([^"]+)"/g)].map((m) => m[1]);
        return {
          object: { verdicts: pairIds.map((pairId) => ({ pairId, sameStory: true, reason: "Same rezoning decision." })) },
          usage: {},
        };
      }
      return classify(args);
    };

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    // One candidate carrying all nine sources — the over-merge itself.
    expect(formed.candidates).toHaveLength(1);
    expect(formed.candidates[0].sourceResultIds).toHaveLength(MAX_ADJUDICATED_CLUSTER_SIZE + 1);

    const summaries = await failures(t, scanId);
    expect(summaries.map((f) => f.code)).toContain("over_merged");
    expect(summaries.find((f) => f.code === "over_merged")?.message)
      .toContain(`largest cluster is ${MAX_ADJUDICATED_CLUSTER_SIZE + 1} sources`);
  });

  it("does not pay for the call when the editor has already cancelled", async () => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    const t = setup();
    const { scanId, ids } = await seedBandScan(t);
    let calls = 0;
    const model: GenerateFn = async () => { calls++; return { object: {}, usage: {} }; };

    await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: ids }, model, async () => false));

    expect(calls).toBe(0);
    expect(await t.run(async (ctx) => await ctx.db.query("modelRuns").collect())).toHaveLength(0);
  });
});
