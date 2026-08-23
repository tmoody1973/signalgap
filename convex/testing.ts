import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MARKET_KEY, QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { EMPTY_SECTION_NOTES } from "./ai/generateBrief";
import { MILWAUKEE_LOCATION } from "./integrations/serpapi/contracts";

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

const SLICE_SOURCES = [
  {
    family: "official" as const, engine: "google" as const, language: "en",
    url: "https://city.milwaukee.gov/agenda/250412",
    title: "Common Council agenda item 250412",
    snippet: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
    publisher: undefined as string | undefined, accessible: true,
    templateId: "official-housing-01",
    query: "(site:city.milwaukee.gov OR site:milwaukee.legistar.com OR site:county.milwaukee.gov OR site:milwaukee.granicus.com OR site:mps.milwaukee.k12.wi.us OR site:wisconsinpublicnotices.org OR site:ridemcts.com) (housing OR zoning OR development OR displacement OR neighborhood)",
  },
  {
    family: "news" as const, engine: "google_news" as const, language: "en",
    url: "https://jsonline.com/story/harambee-rezoning",
    title: "Neighbors question Harambee rezoning timeline",
    snippet: "Residents say they learned of the proposal a week before the vote.",
    publisher: "Milwaukee Journal Sentinel", accessible: true,
    templateId: "news-housing-en-01",
    query: "Milwaukee (housing OR zoning OR development OR displacement OR neighborhood) when:7d",
  },
  {
    family: "news" as const, engine: "google" as const, language: "es",
    url: "https://elconquistador.example/rezonificacion-harambee",
    title: "Vecinos cuestionan la rezonificación de Harambee",
    snippet: "Los residentes dicen que se enteraron una semana antes de la votación.",
    publisher: "El Conquistador", accessible: true,
    templateId: "search-housing-es-01",
    query: "Milwaukee (vivienda OR zonificación OR desarrollo OR vecindario OR desalojo)",
  },
  {
    family: "community_discussion" as const, engine: "google" as const, language: "en",
    url: "https://reddit.com/r/milwaukee/comments/abc123/harambee_rezoning",
    title: "Anyone know what is happening with the Harambee rezoning?",
    snippet: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
    publisher: undefined, accessible: false,
    templateId: "reddit-housing-01",
    query: 'site:reddit.com/r/milwaukee/comments/ (development OR zoning OR apartment OR demolished OR opening OR closing OR "what happened")',
  },
];

const SLICE_FINGERPRINT = "fixture-harambee-rezoning";

export const seedSliceFixture = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.object({ scanId: v.id("scans"), candidateId: v.id("candidates") }),
  handler: async (ctx, { clerkUserId }): Promise<{ scanId: Id<"scans">; candidateId: Id<"candidates"> }> => {
    const now = Date.now();
    const day = 86_400_000;

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
      searchesReserved: 1, searchesSucceeded: 1, searchesFailed: 0,
      eligibleCount: 1, excludedCount: 0, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });

    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: SLICE_FINGERPRINT,
      currentTitle: "Harambee rezoning heads to a council vote",
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      beat: "housing", status: "processing", primaryLabel: "Worth a look", disposition: "new",
      latestEvidenceVersion: 0, independentCategoryCount: 0, coverageOriginalCount: 0,
      // Complete with zero reports: the coverage-gap path, and the one the demo shows.
      coveragePassStatus: "complete",
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
      judgment: {
        localityBand: { value: "direct_city", basis: "deterministic", reason: "an official Milwaukee source is cited: city.milwaukee.gov" },
        relevanceBand: { value: "policy_service_change", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        beat: { value: "housing", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        isSpeculative: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isRoutineCrime: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isDuplicateOfCandidate: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        hasMaterialConflict: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
      },
    });

    const sourceIds: Id<"sourceResults">[] = [];
    for (const [i, source] of SLICE_SOURCES.entries()) {
      // One search run per source, carrying the template that could ACTUALLY
      // have found it. Sharing one run would put a jsonline.com story under a
      // site:city.milwaukee.gov query — a trace that cannot be true, on the one
      // page whose whole job is being traceable.
      const searchRunId = await ctx.db.insert("searchRuns", {
        scanId, ownerId,
        idempotencyKey: `${scanId}:discovery:${source.templateId}:fixture`,
        templateId: source.templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
        purpose: "discovery", engine: source.engine,
        query: source.query,
        parameters: { gl: "us", hl: source.language },
        language: source.language === "es" ? "es" : "en",
        status: "succeeded", attemptCount: 1, resultCount: 10, durationMs: 640 + i * 90,
        reservedAt: now - 50_000 + i * 500, completedAt: now - 49_000 + i * 500,
      });

      const sourceResultId = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `${source.engine}:${source.url}`, canonicalUrl: source.url, originalUrl: source.url,
        engine: source.engine, sourceFamily: source.family,
        sourceType: source.family === "official" ? "primary" : source.family === "community_discussion" ? "discussion" : "unknown",
        title: source.title, snippet: source.snippet, publisher: source.publisher,
        originalLanguage: source.language,
        translatedTitle: source.language === "es" ? "Neighbors question the Harambee rezoning" : undefined,
        translatedSnippet: source.language === "es" ? "Residents say they found out a week before the vote." : undefined,
        publishedAt: now - day, discoveredAt: now, position: i + 1,
        isAccessible: source.accessible, contentHash: `fixture-${i}`,
      });
      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId,
        // Community discussion enters as enrichment, never corroboration
        // (spec.md:541), which is why an unreachable Reddit link shows
        // "Needs a recheck" without excluding the lead.
        role: source.family === "community_discussion" ? "enrichment" : i === 0 ? "initiating" : "corroborating",
        independenceGroup: `host:${new URL(source.url).hostname.replace(/^www\./, "")}`,
        signalCategory: source.family === "official" ? "official_record"
          : source.family === "news" ? "original_news" : "community_discussion",
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

    const evidence = [
      { kind: "existing_coverage", claimText: "The rezoning is agenda item 250412.", ids: [sourceIds[0]],
        excerpt: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive." },
      { kind: "unverified_signal", claimText: "Residents say they learned of the proposal a week before the vote.", ids: [sourceIds[1]],
        excerpt: "Residents say they learned of the proposal a week before the vote." },
      { kind: "unverified_signal", claimText: "Neighbors say they were notified a week before the vote.", ids: [sourceIds[2]],
        original: "Los residentes dicen que se enteraron una semana antes de la votación.",
        translated: "Residents say they found out a week before the vote." },
      { kind: "potential_source", claimText: "A resident reports surveyors on MLK Drive.", ids: [sourceIds[3]],
        excerpt: "Saw surveyors on MLK yesterday. Nobody I know got a notice." },
    ] as Array<{ kind: string; claimText: string; ids: Id<"sourceResults">[]; excerpt?: string; original?: string; translated?: string }>;

    for (const item of evidence) {
      await ctx.db.insert("evidenceItems", {
        candidateId, scanId, ownerId, evidenceVersion: 1,
        kind: item.kind as never, claimText: item.claimText, sourceResultIds: item.ids,
        exactExcerpt: item.excerpt, originalLanguageText: item.original, translatedText: item.translated,
        classificationBasis: "ai_suggested",
        // The Reddit source is deliberately unreachable, so its item shows
        // `Needs a recheck` on screen.
        requiresReverification: item.ids.includes(sourceIds[3]),
        createdByModelRunId: modelRunId,
      });
    }
    await ctx.db.patch(candidateId, { latestEvidenceVersion: 1 });

    await ctx.db.insert("briefVersions", {
      candidateId, scanId, ownerId, version: 1, modelRunId,
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      whySurfaced: "An official agenda item and two independent local outlets describe the same rezoning.",
      // Empty sections carry OUR fixed sentences with no citations, exactly as
      // runGenerateBrief writes them.
      confirmedFacts: [{ text: EMPTY_SECTION_NOTES.confirmedFacts, sourceResultIds: [] }],
      unverifiedClaims: [{ text: "Residents say they learned of the proposal a week before the vote.", sourceResultIds: [sourceIds[1]] }],
      conflicts: [{ text: EMPTY_SECTION_NOTES.conflicts, sourceResultIds: [] }],
      existingCoverage: [{ text: EMPTY_SECTION_NOTES.existingCoverageComplete, sourceResultIds: [] }],
      potentialHumanSources: [{ text: "A resident who saw surveyors on MLK Drive.", sourceResultIds: [sourceIds[3]] }],
      interviewQuestions: [
        "How much notice does the city owe residents before a rezoning vote?",
        "Who signed off on the notification schedule for item 250412?",
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
