import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MARKET_KEY, QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { EMPTY_SECTION_NOTES } from "./ai/generateBrief";
import { MILWAUKEE_LOCATION } from "./integrations/serpapi/contracts";
import { getTemplate, renderQuery } from "./integrations/serpapi/queryCatalog";
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
    eligibleCount: v.optional(v.number()),
    excludedCount: v.optional(v.number()),
    processingCount: v.optional(v.number()),
  },
  returns: v.object({ scanId: v.id("scans") }),
  handler: async (ctx, { clerkUserId, stage, status, withFailure = false, eligibleCount = 3, excludedCount = 5, processingCount = status === "running" ? 2 : 0 }) => {
    const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId)).unique();
    if (!user) throw new Error("Seed the Clerk user first");

    for (const existing of await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).collect()) {
      await purgeScan(ctx, existing._id);
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
      eligibleCount, excludedCount, processingCount,
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
    // The captured articles are real and dated 17-18 August 2026 — that stays
    // fixed, it is the whole point of this fixture. `now` anchors to the
    // moment a real scan would have found them, not to wall-clock time: with
    // Date.now() the gap to those dates widened every day until the lead aged
    // out of the 7-day discovery window and the reviewed verdict silently
    // changed underneath this fixture.
    const now = Date.UTC(2026, 7, 20);

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
      reportingQuestion: "Who is behind the Metcalfe Park Liberation Hub, and what did the plan commission approve?",
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
      reportingQuestion: "Who is behind the Metcalfe Park Liberation Hub, and what did the plan commission approve?",
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

// --- A whole feed, from the same captured payloads ---------------------------

/**
 * Thirty Milwaukee leads across all three beats, so the ranked feed can be seen
 * doing its job: two views, a beat filter that changes the list, a page
 * boundary, and a did-not-qualify list whose reasons are not one sentence
 * repeated thirty times.
 *
 * Same rule as `seedSliceFixture`, and it is the whole point: NOTHING HERE IS
 * INVENTED. Every title, publisher, URL, date and excerpt is a row from
 * tests/fixtures/serpapi/{google_news,google_official,google_reddit}.json exactly
 * as SerpApi returned it, and each `query` is the query that actually captured
 * that payload, read from its own `search_parameters`. The Metcalfe Park lead
 * reuses `SLICE_SOURCES` above rather than restating those four rows.
 *
 * What IS written here is the product's own output — the reporting question and
 * the beat — and each question's premise is in the sources under it.
 *
 * Three captured files are deliberately absent. google_events.json is
 * HAND-WRITTEN (its own `_handwritten` key says so) and its events are invented,
 * so it may not reach a screen a human reads. youtube.json is real, but no
 * template in the query catalog produces a YouTube search, so seeding one would
 * claim a search this product cannot run. google_maps.json and
 * google_trends_trending_now.json carry only non-confirming categories.
 *
 * THE FEED HAS NO ELIGIBLE LEAD, and that is a finding, not an omission.
 * Eligibility needs two DISTINCT confirming signal categories on one
 * development (MIN_INDEPENDENT_CATEGORIES). The usable payloads offer only
 * original_news and official_record, and no news row in the capture names any
 * subject an official row names — the single shared proper noun in the whole set
 * is WHEDA, across a city event page and an unrelated grant announcement.
 * Pairing those would be exactly the invented link `seedSliceFixture` refuses
 * above. A live capture is what fixes this, not a cleverer fixture.
 */

// The captured articles are dated 16-22 August 2026. `now` is fixed two days
// past the newest of them, for the same reason `seedSliceFixture` fixes its
// own: with Date.now() the seven-day discovery window would walk forward every
// day until leads aged out and the verdicts changed underneath the fixture.
const FEED_NOW = Date.UTC(2026, 7, 24);

// Every candidate this seeder writes carries this prefix, so a re-run can find
// its own rows by prefix even when the scan they belonged to is already gone.
const FEED_PREFIX = "fixture-feed-";

// One entry per DISTINCT captured search. The query strings are verbatim from
// each payload's `search_parameters.q`. Note the reddit query's own
// `after:2026-08-15`: that is the date the capture ran with, not one derived
// from FEED_NOW. Using the captured text exactly outranks making it agree.
const FEED_SEARCHES = {
  news: {
    engine: "google_news" as const,
    templateId: "news-housing-en-01",
    query: "Milwaukee (housing OR zoning OR development OR displacement OR neighborhood) when:7d",
  },
  official: {
    engine: "google" as const,
    templateId: "official-housing-01",
    query: "(site:city.milwaukee.gov OR site:milwaukee.legistar.com OR site:county.milwaukee.gov OR site:milwaukee.granicus.com OR site:mps.milwaukee.k12.wi.us OR site:wisconsinpublicnotices.org OR site:ridemcts.com) (housing OR zoning OR development OR displacement OR neighborhood)",
  },
  community_discussion: {
    engine: "google" as const,
    templateId: "reddit-housing-01",
    query: 'site:reddit.com/r/milwaukee/comments/ (development OR zoning OR apartment OR demolished OR opening OR closing OR "what happened") after:2026-08-15',
  },
} as const;

type FeedFamily = keyof typeof FEED_SEARCHES;
type FeedRow = {
  family: FeedFamily;
  title: string;
  url: string;
  snippet: string;
  publisher?: string;
  publishedAt?: number;
  position: number;
};

// The Metcalfe Park rows, re-keyed rather than re-typed. Their families map onto
// the same two captured searches, and their `query`/`templateId` already match
// FEED_SEARCHES, which is why this re-key is lossless.
const sliceRow = (i: number): FeedRow => ({
  family: SLICE_SOURCES[i].family,
  title: SLICE_SOURCES[i].title,
  url: SLICE_SOURCES[i].url,
  snippet: SLICE_SOURCES[i].snippet,
  publisher: SLICE_SOURCES[i].publisher,
  publishedAt: SLICE_SOURCES[i].publishedAt,
  position: i + 1,
});

const FEED_ROWS = {
  "slice-0": sliceRow(0),
  "slice-1": sliceRow(1),
  "slice-2": sliceRow(2),
  "slice-3": sliceRow(3),

  "news-0": {
    family: "news", title: "Milwaukee Neighborhood News Service publishes in-depth retrospective on Sherman Park uprising",
    url: "https://today.marquette.edu/2026/08/milwaukee-neighborhood-news-service-publishes-in-depth-retrospective-on-sherman-park-uprising/",
    snippet: "", publisher: "Marquette Today",
    publishedAt: Date.parse("2026-08-20T16:42:03Z"), position: 1,
  },
  "news-2": {
    family: "news", title: "Milwaukee neighborhood conducts food audit walk to address grocery deserts",
    url: "https://spectrumnews1.com/wi/milwaukee/news/2026/08/19/milwaukee-audit-walk-food-deserts-grocery-stores",
    snippet: "", publisher: "Spectrum News",
    publishedAt: Date.parse("2026-08-19T17:45:00Z"), position: 3,
  },
  "news-3": {
    family: "news", title: "10 years after uprising, stubborn challenges persist in Milwaukee’s Sherman Park neighborhood",
    url: "https://wisconsinwatch.org/2026/08/milwaukee-sherman-park-neighborhood-10-years-after-uprising-challenges-poverty-housing/",
    snippet: "", publisher: "Wisconsin Watch",
    publishedAt: Date.parse("2026-08-21T11:00:00Z"), position: 4,
  },
  "news-4": {
    family: "news", title: "Pope Leo Village brings affordable housing to Milwaukee's Harambee neighborhood",
    url: "https://www.wisn.com/article/pope-leo-village-brings-affordable-housing-to-milwaukees-harambee-neighborhood/73496330",
    snippet: "", publisher: "WISN",
    publishedAt: Date.parse("2026-08-21T23:46:00Z"), position: 5,
  },
  "news-6": {
    family: "news", title: "After Milwaukee veto, affordable housing bonds advance through different conduit",
    url: "https://www.bondbuyer.com/news/conduit-change-advances-milwaukee-affordable-housing-bonds",
    snippet: "", publisher: "Bond Buyer",
    publishedAt: Date.parse("2026-08-19T12:00:00Z"), position: 7,
  },
  "news-8": {
    family: "news", title: "FHLBank Chicago and WHEDA Recognize Housing Counseling Grants Supporting Milwaukee-Area Homebuyers",
    url: "https://uk.finance.yahoo.com/news/fhlbank-chicago-wheda-recognize-housing-181600023.html",
    snippet: "", publisher: "Yahoo Finance UK",
    publishedAt: Date.parse("2026-08-20T18:16:00Z"), position: 9,
  },
  "news-9": {
    family: "news", title: "The uprising in Sherman Park: 10 years later",
    url: "https://milwaukeenns.org/the-uprising-in-sherman-park-10-years-later/",
    snippet: "", publisher: "Milwaukee Neighborhood News Service",
    publishedAt: Date.parse("2026-08-18T12:32:42Z"), position: 10,
  },
  "news-11": {
    family: "news", title: "Op Ed: Lessons From Milwaukee’s Flooding",
    url: "https://urbanmilwaukee.com/2026/08/20/op-ed-lessons-from-milwaukees-flooding/",
    snippet: "", publisher: "Urban Milwaukee",
    publishedAt: Date.parse("2026-08-20T14:13:00Z"), position: 12,
  },
  "news-12": {
    family: "news", title: "Travis Landry builds communities by building people",
    url: "https://milwaukeenns.org/2026/08/19/travis-landry-builds-communities-by-building-people/",
    snippet: "", publisher: "Milwaukee Neighborhood News Service",
    publishedAt: Date.parse("2026-08-19T22:15:00Z"), position: 13,
  },
  "news-13": {
    family: "news", title: "Investments changed Milwaukee’s Sherman Park after 2016 uprising, but who benefited remains unclear",
    url: "https://wisconsinwatch.org/2026/08/milwaukee-sherman-park-investments-uprising-change-improvements-residents-benefit/",
    snippet: "", publisher: "Wisconsin Watch",
    publishedAt: Date.parse("2026-08-21T14:00:00Z"), position: 14,
  },
  "news-17": {
    family: "news", title: "5 things to know and do the week of Aug. 17",
    url: "https://milwaukeenns.org/2026/08/16/5-things-to-know-and-do-the-week-of-aug-17/",
    snippet: "", publisher: "Milwaukee Neighborhood News Service",
    publishedAt: Date.parse("2026-08-16T21:00:00Z"), position: 18,
  },
  "news-20": {
    family: "news", title: "Kenosha moves to turn former McKinley school site into 28-home neighborhood",
    url: "https://www.bizjournals.com/milwaukee/news/2026/08/18/kenosha-mckinley-school-redevelopment.html",
    snippet: "", publisher: "The Business Journals",
    publishedAt: Date.parse("2026-08-18T20:00:00Z"), position: 21,
  },
  "news-21": {
    family: "news", title: "Post From Community: Sixteenth Street Ranks Among Top 10% of Health Centers Nationwide",
    url: "https://milwaukeenns.org/2026/08/20/post-from-community-sixteenth-street-ranks-among-top-10-of-health-centers-nationwide/",
    snippet: "", publisher: "Milwaukee Neighborhood News Service",
    publishedAt: Date.parse("2026-08-21T02:23:25Z"), position: 22,
  },
  "news-23": {
    family: "news", title: "First-time homebuilders Tim and Mandy Vandeville want to disrupt the market",
    url: "https://www.bizjournals.com/milwaukee/news/2026/08/18/whitewater-stonehaven-development-vandeville.html",
    snippet: "", publisher: "The Business Journals",
    publishedAt: Date.parse("2026-08-18T11:27:00Z"), position: 24,
  },
  "news-24": {
    family: "news", title: "Milwaukee art therapists find new ways to help residents deal with emotions",
    url: "https://onmilwaukee.com/articles/art-therapy-mental-health-milwaukee-nns",
    snippet: "", publisher: "OnMilwaukee",
    publishedAt: Date.parse("2026-08-16T12:01:00Z"), position: 25,
  },
  "news-29": {
    family: "news", title: "Three nonprofits receive $350,000 in grant funding to support homeowner education",
    url: "https://www.jsonline.com/story/news/local/milwaukee/neighborhoods/2026/08/20/local-homebuyer-education-agencies-receive-350000-in-grant-funding/91372992007/",
    snippet: "", publisher: "Milwaukee Journal Sentinel",
    publishedAt: Date.parse("2026-08-20T10:07:00Z"), position: 30,
  },
  "news-30": {
    family: "news", title: "Wisconsin Homelessness Rises Again in 2026",
    url: "https://urbanmilwaukee.com/2026/08/19/wisconsin-homelessness-rises-again-in-2026/",
    snippet: "", publisher: "Urban Milwaukee",
    publishedAt: Date.parse("2026-08-19T16:53:00Z"), position: 31,
  },
  "news-33": {
    family: "news", title: "One goal for every Milwaukee Bucks player: Kasparas Jakucionis’s development",
    url: "https://dairylandexpress.com/one-goal-for-every-milwaukee-bucks-player-kasparas-jakucionis-s-development-01m0800ndrm5",
    snippet: "", publisher: "Dairyland Express",
    publishedAt: Date.parse("2026-08-18T13:00:02Z"), position: 34,
  },
  "news-36": {
    family: "news", title: "A scar, not a wound: Faith leaders reflect on the next 10 years for Sherman Park",
    url: "https://milwaukeenns.org/2026/08/16/faith-leaders-reflect-on-10-year-anniversary-of-sherman-park-uprising/",
    snippet: "", publisher: "Milwaukee Neighborhood News Service",
    publishedAt: Date.parse("2026-08-16T22:00:00Z"), position: 37,
  },
  "news-41": {
    family: "news", title: "Abandoned motorcycles will now help facilitate youth STEM/STEAM development",
    url: "https://communityjournal.net/abandoned-motorcycles-will-now-help-facilitate-youth-stem-steam-development/",
    snippet: "", publisher: "Milwaukee Community Journal -",
    publishedAt: Date.parse("2026-08-18T23:20:39Z"), position: 42,
  },
  "news-42": {
    family: "news", title: "In the works since 2022, 310W conversion unlocked by city incentives",
    url: "https://www.bizjournals.com/milwaukee/news/2026/08/21/310w-conversion-incentives.html",
    snippet: "", publisher: "The Business Journals",
    publishedAt: Date.parse("2026-08-21T11:47:00Z"), position: 43,
  },
  "news-47": {
    family: "news", title: "Passenger train upgrades heading to Wisconsin, neighboring states",
    url: "https://milwaukeecourier.com/news/2026/08/20/passenger-train-upgrades-heading-to-wisconsin-neighboring-states",
    snippet: "", publisher: "The Milwaukee Courier",
    publishedAt: Date.parse("2026-08-20T16:06:00Z"), position: 48,
  },
  "news-48": {
    family: "news", title: "Midtown apartment development getting $1 million city loan",
    url: "https://www.jsonline.com/story/money/real-estate/commercial/2026/08/21/milwaukee-midtown-apartment-project-gets-city-loan-for-environmental-cleanup/91401808007/",
    snippet: "", publisher: "Milwaukee Journal Sentinel",
    publishedAt: Date.parse("2026-08-21T15:48:00Z"), position: 49,
  },
  "news-49": {
    family: "news", title: "FHLBank Chicago and WHEDA Recognize Housing Counseling Grants Supporting Milwaukee-Area Homebuyers",
    url: "https://www.eagletribune.com/region/fhlbank-chicago-and-wheda-recognize-housing-counseling-grants-supporting-milwaukee-area-homebuyers/article_7a3efc6b-7d78-56c1-a9fa-20572c966746.html",
    snippet: "", publisher: "Eagle-Tribune",
    publishedAt: Date.parse("2026-08-20T18:16:57Z"), position: 50,
  },

  "official-0": {
    family: "official", title: "Homes MKE - City of Milwaukee",
    url: "https://city.milwaukee.gov/DCD/NIDC/Homes-MKE",
    snippet: "The goals of Homes MKE are to: sell, renovate and reoccupy up to 150 vacant foreclosed City owned houses. prioritize the development of the houses (414) 708- ...",
    position: 1,
  },
  "official-1": {
    family: "official", title: "City of Milwaukee - Calendar",
    url: "https://milwaukee.legistar.com/",
    snippet: "ZONING, NEIGHBORHOODS & DEVELOPMENT COMMITTEE. NEIGHBORHOOD IMPROVEMENT DEVELOPMENT CORPORATION ・ 526 E Concordia Ave ・ 1:00 PM Room 301-A, Third Floor, City ...",
    position: 2,
  },
  "official-5": {
    family: "official", title: "Mayor's \"Back to School\" Bike Ride",
    url: "https://city.milwaukee.gov/City-Events/Public-Works/Mayors-Back-to-School-Bike-Ride.htm?Occurrence=2026-08-29T10:00:00",
    snippet: "Housing & Home Ownership. Join Mayor Cavalier Johnson and the City of Milwaukee for a fun, slow-roll ride through the East Side of Milwaukee! Riverside Park ...",
    position: 6,
  },
  "official-7": {
    family: "official", title: "16th Street Bridge over the Menomonee River",
    url: "https://city.milwaukee.gov/City-Events/Public-Works/Public-Involvement-Meeting-16th-Street-Bridge-over-the-Menomonee-River.htm?Occurrence=2026-12-04T16:00:00",
    snippet: "The rehabilitation project is for the 384-foot-long Unit 14 over the Menomonee River. It is proposed to permanently fix the two movable leaves of the bascule ...",
    position: 8,
  },

  "reddit-0": {
    family: "community_discussion", title: "Getting an apartment in Bayview : r/milwaukee",
    url: "https://www.reddit.com/r/milwaukee/comments/1vsaa36/getting_an_apartment_in_bayview/",
    snippet: "How hard is it to get a two-bedroom apartment in Bayview right now? If I were to start looking now, is there a realistic possibility that I could…",
    position: 1,
  },
  "reddit-1": {
    family: "community_discussion", title: "What is the State Fair Fight? What happened? : r/milwaukee",
    url: "https://www.reddit.com/r/milwaukee/comments/1vrfx2c/what_is_the_state_fair_fight_what_happened/",
    snippet: "I skip the State Fair ONCE. what happened Sunday?",
    position: 2,
  },
  "reddit-2": {
    family: "community_discussion", title: "River Woods Condos on Randolph Ct (Riverwest)",
    url: "https://www.reddit.com/r/milwaukee/comments/1vrpng6/river_woods_condos_on_randolph_ct_riverwest/",
    snippet: "Considering buying a unit at River Woods Condos on Randolph Ct. Anyone live there or have experience with the building management?",
    position: 3,
  },
  "reddit-8": {
    family: "community_discussion", title: "Local fabric store suggestions : r/milwaukee",
    url: "https://www.reddit.com/r/milwaukee/comments/1vtlaa3/local_fabric_store_suggestions/",
    snippet: "I'm looking for a local store with a large fabric selection, please! My mom is still distraught over Joann's closing, and it's unimpressed with the Hobby ...",
    position: 9,
  },
} satisfies Record<string, FeedRow>;

type FeedRowKey = keyof typeof FEED_ROWS;

type FeedRole = "initiating" | "corroborating" | "coverage" | "enrichment";

/**
 * One lead. `question` and `beat` are OURS — the product's own output — and are
 * the only written fields here; everything else points at a captured row or is
 * a judgment the classifier would have made about it.
 *
 * Nothing on this type names a status, a label, a score or an exclusion reason.
 * Those are `internal.candidates.evaluate.evaluate`'s to write, and it is called
 * once per lead at the end of the seeder. To move a lead's verdict, change the
 * EVIDENCE SHAPE below and let the rules reach a different conclusion.
 */
type FeedLead = {
  slug: string;
  question: string;
  beat: "housing" | "transportation" | "culture";
  locality: "direct_city" | "county_city_effect" | "area_city_consequence" | "none";
  relevance: "policy_service_change" | "community_cultural_impact" | "emerging_question" | "promotion_only";
  sources: Array<{ row: FeedRowKey; role: FeedRole; unreachable?: true }>;
  speculative?: true;
  /** The classifier could not put it in a covered beat -> `no_beat_relevance`. */
  noBeat?: true;
  /** Classification failed outright: no judgment at all -> `unreadable_evidence`. */
  unjudged?: true;
  /** The coverage stage reached this lead. Only ten leads per scan ever can. */
  coverageTerms?: string[];
};

const src = (row: FeedRowKey, role: FeedRole, unreachable?: true) => ({ row, role, ...(unreachable ? { unreachable } : {}) });

const FEED_LEADS: FeedLead[] = [
  {
    slug: "metcalfe-park-hub", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "Who is behind the Metcalfe Park Liberation Hub, and what did the plan commission approve?",
    sources: [src("slice-0", "initiating"), src("slice-1", "corroborating"), src("slice-2", "corroborating"), src("slice-3", "enrichment")],
  },
  {
    slug: "midtown-apartment-city-loan", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "What is the $1 million city loan for the Midtown apartment project paying for?",
    sources: [src("news-48", "initiating")],
  },
  {
    // The coverage stage reached this one, so its verdict carries a real prior-
    // report count: Wisconsin Watch (general) and NNS (community), two groups.
    slug: "sherman-park-ten-years", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "Ten years after the Sherman Park uprising, what has changed for the people who live there?",
    sources: [src("news-0", "initiating"), src("news-3", "coverage"), src("news-9", "coverage")],
    coverageTerms: ["Sherman Park"],
  },
  {
    slug: "passenger-train-upgrades", beat: "transportation", locality: "area_city_consequence", relevance: "policy_service_change",
    question: "Which passenger train upgrades reach Wisconsin, and do any of them serve Milwaukee?",
    sources: [src("news-47", "initiating")],
  },
  {
    slug: "310w-conversion-incentives", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "Which city incentives unlocked the 310W conversion, and what do they cost the city?",
    sources: [src("news-42", "initiating")],
  },
  {
    // The one source in this fixture seeded with a FAILED ACCESS CHECK. That is
    // the scan's own observation, not a claim about the publisher — but it is
    // the only field here a reader could check today and find different.
    slug: "sixteenth-street-bridge", beat: "transportation", locality: "direct_city", relevance: "policy_service_change",
    question: "What does the 16th Street Bridge rehabilitation involve, and when does the work start?",
    sources: [src("official-7", "initiating", true)],
  },
  {
    slug: "pope-leo-village-harambee", beat: "housing", locality: "direct_city", relevance: "community_cultural_impact",
    question: "How many affordable homes does Pope Leo Village add in Harambee, and who qualifies for them?",
    sources: [src("news-4", "initiating")],
  },
  {
    slug: "art-therapists-milwaukee", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "What new ways are Milwaukee art therapists using to help residents deal with emotions?",
    sources: [src("news-24", "initiating")],
  },
  {
    slug: "homeowner-education-grants", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "Which three nonprofits share the $350,000 for homeowner education, and what will it pay for?",
    sources: [src("news-29", "initiating")],
    coverageTerms: ["homeowner education grant"],
  },
  {
    // The same press release under two mastheads, minutes apart — real
    // syndication, and the same story the Journal Sentinel lead above tells.
    slug: "wheda-counseling-grants", beat: "housing", locality: "area_city_consequence", relevance: "policy_service_change",
    question: "Which Milwaukee-area homebuyer agencies did FHLBank Chicago and WHEDA recognize?",
    sources: [src("news-8", "initiating"), src("news-49", "corroborating")],
  },
  {
    slug: "kenosha-mckinley-school", beat: "housing", locality: "none", relevance: "policy_service_change",
    question: "What will replace the former McKinley school site in Kenosha?",
    sources: [src("news-20", "initiating")],
  },
  {
    slug: "abandoned-motorcycles-stem", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "Who is turning abandoned motorcycles into youth STEM projects in Milwaukee?",
    sources: [src("news-41", "initiating")],
  },
  {
    slug: "affordable-housing-bonds", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "Which conduit is issuing Milwaukee's affordable housing bonds after the veto?",
    sources: [src("news-6", "initiating")],
  },
  {
    slug: "mayors-bike-ride", beat: "transportation", locality: "direct_city", relevance: "community_cultural_impact",
    question: "What route does the Mayor's Back to School Bike Ride take, and who can join it?",
    sources: [src("official-5", "initiating")],
  },
  {
    slug: "flooding-lessons-oped", beat: "housing", locality: "direct_city", relevance: "emerging_question",
    question: "What lessons does the Urban Milwaukee op-ed draw from Milwaukee’s flooding?",
    sources: [src("news-11", "initiating")],
    speculative: true,
  },
  {
    slug: "state-fair-fight-thread", beat: "culture", locality: "county_city_effect", relevance: "emerging_question",
    question: "What happened in the State Fair fight that r/milwaukee is asking about?",
    sources: [src("reddit-1", "enrichment")],
    noBeat: true,
  },
  {
    slug: "homes-mke-vacant-houses", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "How many of the up-to-150 vacant city-owned houses in Homes MKE have been sold and reoccupied?",
    sources: [src("official-0", "initiating")],
  },
  {
    slug: "sherman-park-investments", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "Who benefited from the investments that changed Sherman Park after 2016?",
    sources: [src("news-13", "initiating")],
  },
  {
    slug: "wisconsin-homelessness-2026", beat: "housing", locality: "area_city_consequence", relevance: "policy_service_change",
    question: "How much of the 2026 rise in Wisconsin homelessness is in Milwaukee?",
    sources: [src("news-30", "initiating")],
  },
  {
    slug: "faith-leaders-sherman-park", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "What do Sherman Park faith leaders expect from the next ten years?",
    sources: [src("news-36", "initiating")],
  },
  {
    slug: "bayview-apartment-thread", beat: "housing", locality: "direct_city", relevance: "emerging_question",
    question: "How hard is it to find a two-bedroom apartment in Bay View right now?",
    sources: [src("reddit-0", "enrichment")],
  },
  {
    slug: "whitewater-stonehaven", beat: "housing", locality: "none", relevance: "emerging_question",
    question: "What are the Vandevilles building at Stonehaven, and how would it change the market?",
    sources: [src("news-23", "initiating")],
    speculative: true,
  },
  {
    slug: "legistar-znd-calendar", beat: "housing", locality: "direct_city", relevance: "policy_service_change",
    question: "What is the Neighborhood Improvement Development Corporation taking up regarding 526 E Concordia Ave?",
    sources: [src("official-1", "initiating")],
    unjudged: true,
  },
  {
    slug: "food-audit-walk", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "Which Milwaukee neighborhood walked its own food audit, and what did it find?",
    sources: [src("news-2", "initiating")],
  },
  {
    slug: "bucks-jakucionis", beat: "culture", locality: "direct_city", relevance: "emerging_question",
    question: "What goal does the column set for Kasparas Jakucionis’s development?",
    sources: [src("news-33", "initiating")],
    noBeat: true,
  },
  {
    slug: "travis-landry-profile", beat: "culture", locality: "direct_city", relevance: "community_cultural_impact",
    question: "How does Travis Landry's work build Milwaukee communities?",
    sources: [src("news-12", "initiating")],
  },
  {
    slug: "five-things-week-aug-17", beat: "culture", locality: "direct_city", relevance: "promotion_only",
    question: "What did NNS pick for its five things to know the week of Aug. 17?",
    sources: [src("news-17", "initiating")],
  },
  {
    slug: "sixteenth-street-health-centers", beat: "culture", locality: "direct_city", relevance: "promotion_only",
    question: "What put Sixteenth Street in the top 10% of health centers nationwide?",
    sources: [src("news-21", "initiating")],
  },
  {
    slug: "river-woods-condos-thread", beat: "housing", locality: "direct_city", relevance: "emerging_question",
    question: "What is the building management like at the River Woods Condos on Randolph Ct?",
    sources: [src("reddit-2", "enrichment")],
  },
  {
    slug: "fabric-store-thread", beat: "culture", locality: "direct_city", relevance: "emerging_question",
    question: "Where do Milwaukee sewers buy fabric now that Joann's has closed?",
    sources: [src("reddit-8", "enrichment")],
  },
];

const aiValue = (value: string) => ({ value, basis: "ai_suggested" as const, reason: "suggested by the model from the supplied sources" });
const aiFlag = (value: boolean) => ({ value, basis: "ai_suggested" as const, reason: "flagged by the model" });

const feedJudgment = (lead: FeedLead) => ({
  localityBand: aiValue(lead.locality),
  relevanceBand: aiValue(lead.relevance),
  beat: lead.noBeat ? null : aiValue(lead.beat),
  isSpeculative: aiFlag(lead.speculative === true),
  isRoutineCrime: aiFlag(false),
  // Always false, like isRoutineCrime and hasMaterialConflict. The flag means
  // "this lead repeats a lead already in the feed" (src/lib/exclusion-reasons.ts:18).
  // The capture has one real syndication — the FHLBank/WHEDA release at news-8 and
  // news-49, same headline 57 seconds apart — but those are two SOURCES ON ONE
  // lead, not one lead repeating another, so the flag does not describe them.
  // Setting it anyway costs the fixture its `duplicate` reason; producing less is
  // the rule.
  isDuplicateOfCandidate: aiFlag(false),
  hasMaterialConflict: aiFlag(false),
});

type FeedVerdict =
  | { status: "eligible" | "excluded"; label: string; scoreTotal: number | null; reasons: string[] }
  | { rejected: "candidate_not_found" };

export const seedFeedFixture = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.object({ scanId: v.id("scans"), eligibleCount: v.number(), excludedCount: v.number() }),
  handler: async (ctx, { clerkUserId }): Promise<{ scanId: Id<"scans">; eligibleCount: number; excludedCount: number }> => {
    const now = FEED_NOW;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    const ownerId = existingUser?._id
      ?? (await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now }));

    // Re-running must leave a clean deployment, not a doubled one. Prior rows
    // are found by FINGERPRINT PREFIX, not by scan: a run whose scan has already
    // been deleted elsewhere still leaves candidates behind, and orphans make
    // the e2e first-run assertions read a dirty deployment as clean.
    const priorScanIds = new Set<Id<"scans">>();
    const priors = await ctx.db
      .query("candidates")
      .withIndex("by_owner_fingerprint", (q) =>
        q.eq("ownerId", ownerId).gte("fingerprint", FEED_PREFIX).lt("fingerprint", `${FEED_PREFIX}￿`))
      .collect();
    for (const prior of priors) {
      for (const appearance of await ctx.db.query("candidateAppearances").withIndex("by_candidate_scan", (q) => q.eq("candidateId", prior._id)).collect()) {
        priorScanIds.add(appearance.scanId);
        await ctx.db.delete(appearance._id);
      }
      for (const membership of await ctx.db.query("candidateSources").withIndex("by_candidate_scan", (q) => q.eq("candidateId", prior._id)).collect()) {
        await ctx.db.delete(membership._id);
      }
      for (const item of await ctx.db.query("evidenceItems").withIndex("by_candidate_version", (q) => q.eq("candidateId", prior._id)).collect()) {
        await ctx.db.delete(item._id);
      }
      for (const brief of await ctx.db.query("briefVersions").withIndex("by_candidate_version", (q) => q.eq("candidateId", prior._id)).collect()) {
        await ctx.db.delete(brief._id);
      }
      await ctx.db.delete(prior._id);
    }
    for (const scanId of priorScanIds) {
      if (await ctx.db.get(scanId)) await purgeScan(ctx, scanId);
    }

    const scanId = await ctx.db.insert("scans", {
      ownerId, marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "completed", stage: "briefs", startedAt: now - 300_000, completedAt: now,
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });

    // One searchRun per DISTINCT captured search, and one sourceResult per
    // DISTINCT captured row — the same discipline seedSliceFixture applies, so
    // the ledger never overstates how many paid calls the scan made.
    const runByFamily = new Map<FeedFamily, Id<"searchRuns">>();
    let runCount = 0;
    for (const family of Object.keys(FEED_SEARCHES) as FeedFamily[]) {
      const search = FEED_SEARCHES[family];
      runByFamily.set(family, await ctx.db.insert("searchRuns", {
        scanId, ownerId,
        idempotencyKey: `${scanId}:discovery:${search.templateId}:feed-fixture`,
        templateId: search.templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
        purpose: "discovery", engine: search.engine, query: search.query,
        parameters: { gl: "us", hl: "en" }, language: "en",
        status: "succeeded", attemptCount: 1, resultCount: 10, durationMs: 700 + runCount * 80,
        reservedAt: now - 250_000 + runCount * 1_000, completedAt: now - 249_000 + runCount * 1_000,
      }));
      runCount += 1;
    }

    const sourceIdByRow = new Map<FeedRowKey, Id<"sourceResults">>();
    const usedRows = new Set<FeedRowKey>();
    for (const lead of FEED_LEADS) for (const s of lead.sources) usedRows.add(s.row);
    const unreachableRows = new Set<FeedRowKey>();
    for (const lead of FEED_LEADS) for (const s of lead.sources) if (s.unreachable) unreachableRows.add(s.row);

    for (const rowKey of usedRows) {
      const row: FeedRow = FEED_ROWS[rowKey];
      const search = FEED_SEARCHES[row.family];
      const searchRunId = runByFamily.get(row.family);
      if (!searchRunId) throw new Error(`no search run for family ${row.family}`);
      sourceIdByRow.set(rowKey, await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `${search.engine}:${row.url}`, canonicalUrl: row.url, originalUrl: row.url,
        engine: search.engine, sourceFamily: row.family,
        sourceType: row.family === "community_discussion" ? "discussion" : row.family === "official" ? "primary" : "unknown",
        title: row.title, snippet: row.snippet, publisher: row.publisher,
        originalLanguage: "en",
        publishedAt: row.publishedAt, discoveredAt: now, position: row.position,
        isAccessible: !unreachableRows.has(rowKey), contentHash: `feed-${rowKey}`,
        ...(unreachableRows.has(rowKey) ? { accessCheckedAt: now - 120_000 } : {}),
      }));
    }

    let eligibleCount = 0;
    let excludedCount = 0;
    let coverageRuns = 0;

    for (const [i, lead] of FEED_LEADS.entries()) {
      const first: FeedRow = FEED_ROWS[lead.sources[0].row];
      // Discovery order, a second apart, so the feed's freshness tiebreak is
      // deterministic across re-runs instead of falling back to the row id.
      // Every lead here scores null, so this ordering IS the feed's order, and
      // the array above therefore reads top-to-bottom the way the page does.
      const firstSeenAt = now - i * 1_000;

      const candidateId = await ctx.db.insert("candidates", {
        ownerId, fingerprint: `${FEED_PREFIX}${lead.slug}`,
        currentTitle: first.title,
        reportingQuestion: lead.question,
        beat: lead.beat, status: "processing", primaryLabel: "Worth a look", disposition: "new",
        latestEvidenceVersion: 0, independentCategoryCount: 0, coverageOriginalCount: 0,
        coveragePassStatus: "pending",
        // Per-partition state is an INPUT the coverage stage writes; the derived
        // `coveragePassStatus` above is evaluate's to overwrite. At most ten
        // leads per scan can ever have theirs completed — coverage affords two
        // searches each out of twenty — which is why most of these stay pending.
        coveragePartitions: lead.coverageTerms
          ? { general: "succeeded", community: "succeeded" }
          : { general: "pending", community: "pending" },
        firstSeenAt, lastSeenAt: now, updatedAt: now,
        ...(lead.unjudged ? {} : { judgment: feedJudgment(lead) }),
      });

      if (lead.coverageTerms) {
        for (const templateId of ["coverage-general-01", "coverage-community-01"] as const) {
          // The logged query must be the query the catalog would execute, so it
          // comes from the real template rather than from a description of it.
          const template = getTemplate(templateId);
          if (!template) throw new Error(`no query template ${templateId}`);
          await ctx.db.insert("searchRuns", {
            scanId, ownerId, candidateId,
            idempotencyKey: `${scanId}:coverage:${templateId}:${lead.slug}`,
            templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
            purpose: "coverage", engine: "google",
            query: renderQuery(template, { now, terms: lead.coverageTerms }),
            parameters: { gl: "us", hl: "en" }, language: "en",
            status: "succeeded", attemptCount: 1, resultCount: 10, durationMs: 820,
            reservedAt: now - 200_000 + coverageRuns * 1_000, completedAt: now - 199_000 + coverageRuns * 1_000,
          });
          coverageRuns += 1;
        }
      }

      for (const s of lead.sources) {
        const sourceResultId = sourceIdByRow.get(s.row);
        const row: FeedRow = FEED_ROWS[s.row];
        if (!sourceResultId) throw new Error(`no source result for row ${s.row}`);
        await ctx.db.insert("candidateSources", {
          candidateId, scanId, sourceResultId,
          role: s.role,
          independenceGroup: `host:${new URL(row.url).hostname.replace(/^www\./, "")}`,
          signalCategory: row.family === "news" ? "original_news" : row.family === "official" ? "official_record" : "community_discussion",
          addedBy: "ai_suggestion",
        });
      }

      await ctx.db.insert("candidateAppearances", {
        candidateId, scanId, ownerId,
        statusAtScan: "processing", labelAtScan: "Worth a look", dispositionAtScan: "new", rank: i + 1,
      });

      // Every verdict on this screen is the rules engine's. Nothing above wrote
      // status, primaryLabel, scoreTotal or a single exclusion reason.
      const verdict: FeedVerdict = await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });
      if ("status" in verdict && verdict.status === "eligible") eligibleCount += 1;
      else excludedCount += 1;
    }

    await ctx.db.patch(scanId, {
      searchesReserved: runCount + coverageRuns,
      searchesSucceeded: runCount + coverageRuns,
      eligibleCount, excludedCount, processingCount: 0,
    });

    // ponytail: no evidenceItems and no briefVersions. The feed card reads none
    // of them, and a lead that did not qualify never gets a brief generated for
    // it anyway. seedSliceFixture is still the fixture for the evidence page.
    return { scanId, eligibleCount, excludedCount };
  },
});
