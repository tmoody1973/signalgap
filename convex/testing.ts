import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MARKET_KEY, QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { EMPTY_SECTION_NOTES } from "./ai/generateBrief";
import { MILWAUKEE_LOCATION } from "./integrations/serpapi/contracts";
import * as V from "./lib/validators";

// Deleting a scan must take everything the scan produced with it: its searches,
// its results, their archived raw JSON, and — since item 7 — the candidates the
// scan formed and everything hanging off them. Orphans left behind make the e2e
// first-run assertions read a dirty deployment as a clean one.
async function purgeScan(ctx: MutationCtx, scanId: Id<"scans">) {
  const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
  for (const run of runs) {
    if (run.rawStorageId) await ctx.storage.delete(run.rawStorageId);
    await ctx.db.delete(run._id);
  }
  const results = await ctx.db.query("sourceResults").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
  for (const result of results) await ctx.db.delete(result._id);

  // Candidates are reached through this scan's appearances. A candidate that
  // appeared in another scan too keeps that appearance and survives; one whose
  // only appearance was here goes with it, along with its evidence and briefs.
  const scan = await ctx.db.get(scanId);
  const appearances = scan
    ? await ctx.db
        .query("candidateAppearances")
        .withIndex("by_owner_scan", (q) => q.eq("ownerId", scan.ownerId).eq("scanId", scanId))
        .collect()
    : [];

  for (const appearance of appearances) {
    const candidateId = appearance.candidateId;
    await ctx.db.delete(appearance._id);

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();
    for (const membership of memberships) await ctx.db.delete(membership._id);

    const stillAppears = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId))
      .first();
    if (stillAppears) continue;

    const evidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    for (const item of evidence) await ctx.db.delete(item._id);

    const briefs = await ctx.db
      .query("briefVersions")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    for (const brief of briefs) await ctx.db.delete(brief._id);

    await ctx.db.delete(candidateId);
  }

  const modelRuns = await ctx.db
    .query("modelRuns")
    .withIndex("by_scan_operation", (q) => q.eq("scanId", scanId))
    .collect();
  for (const run of modelRuns) await ctx.db.delete(run._id);

  await ctx.db.delete(scanId);
}

// ponytail: CLI-only reset for e2e; internal so browsers cannot call it.
export const deleteScansForClerkUser = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.number(),
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) return 0;
    const scans = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect();
    for (const s of scans) await purgeScan(ctx, s._id);
    return scans.length;
  },
});

// --- Test-only helpers for the real-deployment concurrency proof (Ruling 7) ---
// convex-test serialises every top-level transaction behind a mutex, so its
// 20-way reserve test proves ordering, not the 120 cap. These run the same
// mutation against a real deployment, where the transactions genuinely race.
// All internal: no browser can reach them.

export const seedScanAtReservation = internalMutation({
  args: { reserved: v.number() },
  returns: v.object({ scanId: v.id("scans"), userId: v.id("users") }),
  handler: async (ctx, { reserved }) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkUserId: `race-harness-${now}-${Math.random().toString(36).slice(2)}`,
      createdAt: now, updatedAt: now,
    });
    const scanId = await ctx.db.insert("scans", {
      ownerId: userId, marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "running", stage: "discovery", startedAt: now,
      searchBudgetLimit: SEARCH_BUDGET.hardCap, searchesReserved: reserved,
      searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });
    return { scanId, userId };
  },
});

/**
 * One scan parked in a named state, for rendering tests.
 *
 * Deliberately NOT a second copy of `seedSliceFixture`. That one builds a real
 * lead from captured payloads and is demo material; this one exists only to put
 * the progress panel into a state, and creates no candidates at all.
 */
export const seedScanInState = internalMutation({
  args: {
    clerkUserId: v.string(),
    stage: V.vStage,
    status: V.vScanStatus,
    withFailure: v.optional(v.boolean()),
  },
  returns: v.object({ scanId: v.id("scans") }),
  handler: async (ctx, { clerkUserId, stage, status, withFailure = false }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) throw new Error("Seed the Clerk user first");

    for (const existing of await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect()) {
      await ctx.db.delete(existing._id);
    }

    const now = Date.now();
    const scanId = await ctx.db.insert("scans", {
      ownerId: user._id,
      marketKey: MARKET_KEY, rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status, stage, startedAt: now - 60_000,
      completedAt: status === "running" || status === "queued" ? undefined : now,
      cancelRequestedAt: status === "canceled" ? now - 1_000 : undefined,
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 27, searchesSucceeded: 25, searchesFailed: 2,
      eligibleCount: 3, excludedCount: 5, processingCount: status === "running" ? 2 : 0,
      failureSummaries: withFailure
        ? [{ purpose: "coverage" as const, code: "coverage_partition_failed", message: "the community coverage partition failed; no coverage gap can be claimed" }]
        : [],
      isSavedDemo: false,
    });
    return { scanId };
  },
});

export const readScanCounters = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), v.object({
    searchesReserved: v.number(), searchesSucceeded: v.number(), searchesFailed: v.number(),
    searchBudgetLimit: v.number(), runCount: v.number(),
  })),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).collect();
    return {
      searchesReserved: scan.searchesReserved, searchesSucceeded: scan.searchesSucceeded,
      searchesFailed: scan.searchesFailed, searchBudgetLimit: scan.searchBudgetLimit,
      runCount: runs.length,
    };
  },
});

export const deleteScanById = internalMutation({
  args: { scanId: v.id("scans"), userId: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, { scanId, userId }) => {
    if (await ctx.db.get(scanId)) await purgeScan(ctx, scanId);
    if (userId && (await ctx.db.get(userId))) await ctx.db.delete(userId);
    return null;
  },
});

type RaceOutcome = {
  granted: number; rejected: number;
  searchesReserved: number; runCount: number; searchBudgetLimit: number;
};

// Each ctx.runMutation from an action is its own transaction on the real
// backend, so Promise.all here is a genuine race against one scan row —
// which is exactly what the 120 cap has to survive.
export const raceReserve = internalAction({
  args: { reserved: v.number(), callers: v.number() },
  returns: v.object({
    granted: v.number(), rejected: v.number(),
    searchesReserved: v.number(), runCount: v.number(), searchBudgetLimit: v.number(),
  }),
  handler: async (ctx, { reserved, callers }): Promise<RaceOutcome> => {
    const { scanId, userId }: { scanId: Id<"scans">; userId: Id<"users"> } = await ctx.runMutation(internal.testing.seedScanAtReservation, { reserved });
    try {
      const outcomes: Array<{ runId: Id<"searchRuns">; reused: boolean } | { rejected: string }> = await Promise.all(
        Array.from({ length: callers }, (_, i) =>
          ctx.runMutation(internal.searchRuns.reserve, {
            scanId,
            spec: {
              templateId: "corroborate-entity-01", engine: "google" as const, purpose: "corroboration" as const,
              query: `race ${i}`, location: MILWAUKEE_LOCATION,
              language: "en" as const, timeWindow: "7d" as const,
            },
          }),
        ),
      );
      const counters: { searchesReserved: number; runCount: number; searchBudgetLimit: number } | null = await ctx.runQuery(internal.testing.readScanCounters, { scanId });
      if (!counters) throw new Error("seeded scan disappeared mid-race");
      return {
        granted: outcomes.filter((o) => "runId" in o).length,
        rejected: outcomes.filter((o) => "rejected" in o).length,
        searchesReserved: counters.searchesReserved,
        runCount: counters.runCount,
        searchBudgetLimit: counters.searchBudgetLimit,
      };
    } finally {
      await ctx.runMutation(internal.testing.deleteScanById, { scanId, userId });
    }
  },
});

// --- One finished lead, for the e2e run and for looking at the page ----------
// The same four Milwaukee sources the integration fixture uses, already
// clustered, classified, snapshotted and briefed. It makes NO model call: the
// e2e suite must not depend on a paid service, and what it tests is the
// rendering, not the model.

/**
 * A REAL Milwaukee lead, taken from the captured SerpApi payloads in
 * tests/fixtures/serpapi. Nothing here is invented: the titles, publishers,
 * links and the Reddit excerpt are exactly as SerpApi returned them, and each
 * `query` is the query that actually captured that payload (read from its own
 * `search_parameters`).
 *
 * The story is the Metcalfe Park Liberation Hub clearing the City Plan
 * Commission in August 2026. Three independent local outlets covered it and one
 * r/milwaukee thread discussed it.
 *
 * No official record is included, because the captured official-domain payload
 * contains none that names this project. Attaching a Legistar calendar entry
 * that does not mention Metcalfe Park would be exactly the fabrication this
 * product exists to refuse — and it is why the rules refuse this lead: three
 * outlets are three groups but only ONE category, and the gate needs two.
 */
const SLICE_SOURCES = [
  {
    family: "news" as const, engine: "google_news" as const, language: "en",
    url: "https://www.jsonline.com/story/news/local/milwaukee/neighborhoods/2026/08/17/metcalfe-park-neighborhood-improvement-district-moves-ahead-to-common-council-vote/91340621007/",
    title: "City Plan Commission approves Metcalfe Park improvement district",
    snippet: "",
    publisher: "Milwaukee Journal Sentinel" as string | undefined,
    accessible: true,
    templateId: "news-housing-en-01",
    query: "Milwaukee (housing OR zoning OR development OR displacement OR neighborhood) when:7d",
    claim: "The City Plan Commission approved the Metcalfe Park improvement district, which now moves to a Common Council vote.",
    publishedAt: Date.UTC(2026, 7, 17, 21, 49),
  },
  {
    family: "news" as const, engine: "google_news" as const, language: "en",
    url: "https://urbanmilwaukee.com/2026/08/18/city-commission-approves-metcalfe-park-development/",
    title: "City Commission Approves Metcalfe Park Development",
    snippet: "",
    publisher: "Urban Milwaukee",
    accessible: true,
    templateId: "news-housing-en-01",
    query: "Milwaukee (housing OR zoning OR development OR displacement OR neighborhood) when:7d",
    claim: "A city commission approved the Metcalfe Park development.",
    publishedAt: Date.UTC(2026, 7, 18, 16, 57),
  },
  {
    family: "news" as const, engine: "google_news" as const, language: "en",
    url: "https://www.bizjournals.com/milwaukee/news/2026/08/18/metcalfe-park-hub-first-approval.html",
    title: "Metcalfe Park project with cafe, laundromat and affordable units wins plan commission vote",
    snippet: "",
    publisher: "The Business Journals",
    accessible: true,
    templateId: "news-housing-en-01",
    query: "Milwaukee (housing OR zoning OR development OR displacement OR neighborhood) when:7d",
    claim: "The project is described as including a cafe, a laundromat and affordable units.",
    publishedAt: Date.UTC(2026, 7, 18, 11, 31),
  },
  {
    family: "community_discussion" as const, engine: "google" as const, language: "en",
    url: "https://www.reddit.com/r/milwaukee/comments/1vtame2/city_commission_approves_metcalfe_park/",
    title: "City Commission Approves Metcalfe Park Development ...",
    snippet: "Known as the Metcalfe Park Liberation Hub, the two-phase development would become a community hub with a wide range of functions.",
    publisher: undefined,
    accessible: true,
    templateId: "reddit-housing-01",
    query: 'site:reddit.com/r/milwaukee/comments/ (development OR zoning OR apartment OR demolished OR opening OR closing OR "what happened") after:2026-08-15',
    claim: "Residents discussed the Metcalfe Park Liberation Hub as a two-phase community hub.",
    // The captured Reddit result carried no date, so none is shown. An invented
    // one would move the freshness score.
    publishedAt: undefined as number | undefined,
  },
];

const SLICE_FINGERPRINT = "fixture-metcalfe-park-hub";

export const seedSliceFixture = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.object({ scanId: v.id("scans"), candidateId: v.id("candidates") }),
  handler: async (ctx, { clerkUserId }): Promise<{ scanId: Id<"scans">; candidateId: Id<"candidates"> }> => {
    const now = Date.now();

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    const ownerId = existingUser?._id
      ?? (await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now }));

    // Re-seeding is idempotent: drop the previous fixture lead and its rows so a
    // repeated e2e run reads a clean deployment, not a doubled one.
    const prior = await ctx.db
      .query("candidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", ownerId).eq("fingerprint", SLICE_FINGERPRINT))
      .unique();
    if (prior) {
      for (const table of ["candidateSources", "candidateAppearances", "evidenceItems", "briefVersions"] as const) {
        const rows = await ctx.db.query(table).collect();
        for (const row of rows) if (row.candidateId === prior._id) await ctx.db.delete(row._id);
      }
      await ctx.db.delete(prior._id);
    }

    const scanId = await ctx.db.insert("scans", {
      ownerId, marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "completed", stage: "briefs", startedAt: now - 60_000, completedAt: now,
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 2, searchesSucceeded: 2, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 1, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });

    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: SLICE_FINGERPRINT,
      currentTitle: "Metcalfe Park Liberation Hub clears the plan commission",
      reportingQuestion: "Who is behind the Metcalfe Park Liberation Hub, and what did the city promise it?",
      beat: "housing", status: "processing", primaryLabel: "Worth a look", disposition: "new",
      latestEvidenceVersion: 0, independentCategoryCount: 0, coverageOriginalCount: 0,
      // The coverage check has not run for this fixture, so a coverage gap can
      // never be claimed here. Item 8's workflow is what runs it.
      coveragePassStatus: "pending",
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
      judgment: {
        // No official Milwaukee domain is cited, so the deterministic path does
        // not fire and the model's own suggestion stands — with its basis on it.
        localityBand: { value: "direct_city", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        relevanceBand: { value: "policy_service_change", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        beat: { value: "housing", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        isSpeculative: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isRoutineCrime: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isDuplicateOfCandidate: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        hasMaterialConflict: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
      },
    });

    // One search run per DISTINCT query, which is what actually happened: a
    // single google_news search returned all three news results, and a single
    // r/milwaukee search returned the thread. Splitting them per source would
    // overstate how many paid calls the scan made.
    const runByQuery = new Map<string, Id<"searchRuns">>();
    const sourceIds: Id<"sourceResults">[] = [];

    for (const [i, source] of SLICE_SOURCES.entries()) {
      let searchRunId = runByQuery.get(source.query);
      if (!searchRunId) {
        searchRunId = await ctx.db.insert("searchRuns", {
          scanId, ownerId,
          idempotencyKey: `${scanId}:discovery:${source.templateId}:fixture`,
          templateId: source.templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
          purpose: "discovery", engine: source.engine,
          query: source.query,
          parameters: { gl: "us", hl: source.language },
          language: "en",
          status: "succeeded", attemptCount: 1, resultCount: 10, durationMs: 640 + i * 90,
          reservedAt: now - 50_000 + i * 500, completedAt: now - 49_000 + i * 500,
        });
        runByQuery.set(source.query, searchRunId);
      }

      const sourceResultId = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `${source.engine}:${source.url}`, canonicalUrl: source.url, originalUrl: source.url,
        engine: source.engine, sourceFamily: source.family,
        sourceType: source.family === "community_discussion" ? "discussion" : "unknown",
        title: source.title, snippet: source.snippet, publisher: source.publisher,
        originalLanguage: source.language,
        translatedTitle: undefined,
        translatedSnippet: undefined,
        publishedAt: source.publishedAt, discoveredAt: now, position: i + 1,
        isAccessible: source.accessible, contentHash: `fixture-${i}`,
      });
      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId,
        // Community discussion enters as enrichment, never corroboration
        // (spec.md:541), which is why an unreachable Reddit link shows
        // "Needs a recheck" without excluding the lead.
        role: source.family === "community_discussion" ? "enrichment" : i === 0 ? "initiating" : "corroborating",
        independenceGroup: `host:${new URL(source.url).hostname.replace(/^www\./, "")}`,
        signalCategory: source.family === "news" ? "original_news" : "community_discussion",
        addedBy: "ai_suggestion",
      });
      sourceIds.push(sourceResultId);
    }

    const modelRunId = await ctx.db.insert("modelRuns", {
      scanId, candidateId, ownerId, operation: "classifyEvidence",
      idempotencyKey: `${scanId}:${candidateId}:classifyEvidence:fixture:1:2:claude-sonnet-5`,
      provider: "anthropic", modelId: "claude-sonnet-5",
      promptVersion: "2", schemaVersion: "1", inputSnapshotHash: "fixture",
      status: "succeeded", attempt: 1, durationMs: 14_200,
      inputTokens: 2_100, outputTokens: 900, startedAt: now - 30_000, completedAt: now - 16_000,
    });

    // Claim text closely tracks each real headline; nothing is added to it. Only
    // the Reddit source has a stored snippet, so it is the only exact excerpt.
    const evidence = SLICE_SOURCES.map((source, i) => ({
      kind: source.family === "community_discussion" ? "potential_source" : "unverified_signal",
      claimText: source.claim,
      ids: [sourceIds[i]],
      excerpt: source.snippet.length > 0 ? source.snippet : undefined,
    }));

    for (const item of evidence) {
      await ctx.db.insert("evidenceItems", {
        candidateId, scanId, ownerId, evidenceVersion: 1,
        kind: item.kind as never, claimText: item.claimText, sourceResultIds: item.ids,
        exactExcerpt: item.excerpt,
        classificationBasis: "ai_suggested",
        requiresReverification: false,
        createdByModelRunId: modelRunId,
      });
    }
    await ctx.db.patch(candidateId, { latestEvidenceVersion: 1 });

    await ctx.db.insert("briefVersions", {
      candidateId, scanId, ownerId, version: 1, modelRunId,
      reportingQuestion: "Who is behind the Metcalfe Park Liberation Hub, and what did the city promise it?",
      whySurfaced: "Three local outlets reported the same plan commission approval within two days.",
      // Empty sections carry OUR fixed sentences with no citations, exactly as
      // runGenerateBrief writes them.
      confirmedFacts: [{ text: EMPTY_SECTION_NOTES.confirmedFacts, sourceResultIds: [] }],
      unverifiedClaims: [
        { text: "The City Plan Commission approved the Metcalfe Park improvement district, which now moves to a Common Council vote.", sourceResultIds: [sourceIds[0]] },
        { text: "The project is described as including a cafe, a laundromat and affordable units.", sourceResultIds: [sourceIds[2]] },
      ],
      conflicts: [{ text: EMPTY_SECTION_NOTES.conflicts, sourceResultIds: [] }],
      existingCoverage: [{ text: EMPTY_SECTION_NOTES.existingCoverageIncomplete, sourceResultIds: [] }],
      potentialHumanSources: [{ text: "Residents discussing the hub in r/milwaukee.", sourceResultIds: [sourceIds[3]] }],
      interviewQuestions: [
        "Who are the developers behind the Metcalfe Park Liberation Hub?",
        "What city money or land is attached to the improvement district?",
        "When does the Common Council take it up?",
      ],
      createdAt: now,
    });
    await ctx.db.patch(candidateId, { latestBriefVersion: 1 });

    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId, ownerId,
      statusAtScan: "processing", labelAtScan: "Worth a look", dispositionAtScan: "new", rank: 1,
    });

    // The verdict on screen is the rules engine's. Nothing above wrote status,
    // primaryLabel or scoreTotal.
    await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });

    return { scanId, candidateId };
  },
});
