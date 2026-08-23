import { v } from "convex/values";
import { query } from "./_generated/server";
import { coverageGapAllowed } from "./editorial/coverage";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

/**
 * One owner-scoped read that assembles the whole evidence view.
 *
 * It is one query on purpose: the demo's central move is opening a lead and
 * following a fact backward, and a view stitched from six round trips shows a
 * different set of half-loaded panels every time.
 *
 * `rawStorageId` is absent from the return validator, not optional. Raw SerpApi
 * JSON never reaches a browser.
 */

const SCORE_LABELS = {
  milwaukeeEvidence: "Milwaukee evidence",
  crossSource: "Independent sources",
  freshness: "Freshness",
  coverageScarcity: "Coverage scarcity",
  relevance: "Beat relevance",
} as const;

// A deliberate reading order, not index order: the primary record leads because
// it is the strongest thing we have, and community discussion goes last because
// it never counts toward confirmation.
const CATEGORY_RANK = {
  official_record: 0,
  original_news: 1,
  event: 2,
  video: 3,
  public_web: 4,
  map: 5,
  trend: 6,
  community_discussion: 7,
} as const;

const CATEGORY_LABELS = {
  official_record: "Official record",
  original_news: "Local reporting",
  event: "Public event",
  video: "Video",
  map: "Place",
  community_discussion: "Community discussion",
  public_web: "Public web",
  trend: "Search trend",
} as const;

const vEvidenceSource = v.object({
  sourceResultId: v.id("sourceResults"),
  title: v.string(),
  snippet: v.string(),
  canonicalUrl: v.string(),
  publisher: v.union(v.string(), v.null()),
  publishedAt: v.union(v.number(), v.null()),
  sourceFamily: V.vSourceFamily,
  sourceType: V.vSourceType,
  originalLanguage: v.string(),
  translatedTitle: v.union(v.string(), v.null()),
  translatedSnippet: v.union(v.string(), v.null()),
  isAccessible: v.boolean(),
  role: V.vSourceRole,
  signalCategory: V.vSignalCategory,
  independenceGroup: v.string(),
  // The stored, executed query text. The last link in the trace — a journalist
  // can re-run it themselves, which is the entire point of showing it.
  foundByQuery: v.union(v.string(), v.null()),
});

const vBlock = v.object({ text: v.string(), sourceResultIds: v.array(v.id("sourceResults")) });

const vEvidenceView = v.object({
  candidate: v.object({
    id: v.id("candidates"),
    title: v.string(),
    reportingQuestion: v.string(),
    beat: V.vBeat,
    status: V.vCandidateStatus,
    label: V.vProductLabel,
    disposition: V.vDisposition,
    scoreTotal: v.union(v.number(), v.null()),
    // Empty when the lead qualified. Never null — the page must be able to tell
    // "qualified" from "we have not evaluated it".
    exclusionReasons: v.array(V.vExclusionReason),
    updatedAt: v.number(),
  }),
  judgment: v.union(v.null(), V.vJudgmentRecord),
  score: v.union(v.null(), v.object({
    total: v.number(),
    components: v.array(v.object({
      key: v.string(),
      label: v.string(),
      points: v.number(),
      max: v.number(),
      bandId: v.string(),
      reason: v.string(),
      evidenceIds: v.array(v.string()),
    })),
  })),
  whySurfaced: v.array(v.object({
    category: V.vSignalCategory,
    label: v.string(),
    sourceResultId: v.id("sourceResults"),
    title: v.string(),
    publisher: v.union(v.string(), v.null()),
    publishedAt: v.union(v.number(), v.null()),
    // How many INDEPENDENT outlets sit behind this one row. The row shows one
    // source per kind, which is the rule; without this count a story three
    // newsrooms filed separately looks like a story one newsroom filed.
    outletCount: v.number(),
  })),
  evidence: v.array(v.object({
    id: v.id("evidenceItems"),
    kind: V.vEvidenceKind,
    claimText: v.string(),
    exactExcerpt: v.union(v.string(), v.null()),
    originalLanguageText: v.union(v.string(), v.null()),
    translatedText: v.union(v.string(), v.null()),
    requiresReverification: v.boolean(),
    sources: v.array(vEvidenceSource),
  })),
  coverage: v.object({
    passStatus: V.vCoveragePassStatus,
    originalReportCount: v.number(),
    gapAllowed: v.boolean(),
    reports: v.array(vEvidenceSource),
  }),
  brief: v.union(v.null(), v.object({
    version: v.number(),
    reportingQuestion: v.string(),
    whySurfaced: v.string(),
    sections: v.object({
      confirmedFacts: v.array(vBlock),
      unverifiedClaims: v.array(vBlock),
      conflicts: v.array(vBlock),
      existingCoverage: v.array(vBlock),
      potentialHumanSources: v.array(vBlock),
    }),
    interviewQuestions: v.array(v.string()),
    modelRunId: v.union(v.id("modelRuns"), v.null()),
  })),
  queryLog: v.array(v.object({
    templateId: v.string(),
    purpose: V.vPurpose,
    engine: V.vEngine,
    query: v.string(),
    status: V.vSearchRunStatus,
    resultCount: v.number(),
    durationMs: v.number(),
  })),
});

export const forCandidate = query({
  args: { candidateId: v.id("candidates") },
  returns: v.union(v.null(), vEvidenceView),
  handler: async (ctx, { candidateId }) => {
    const user = await requireUser(ctx);
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.ownerId !== user._id) return null;

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId))
      .collect();

    const sourceById = new Map<string, typeof vEvidenceSource.type>();
    const queryLog: typeof vEvidenceView.type.queryLog = [];
    const seenRuns = new Set<string>();

    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      if (!row) continue;
      const run = await ctx.db.get(row.searchRunId);
      if (run && !seenRuns.has(run._id as string)) {
        seenRuns.add(run._id as string);
        queryLog.push({
          templateId: run.templateId, purpose: run.purpose, engine: run.engine,
          query: run.query, status: run.status, resultCount: run.resultCount, durationMs: run.durationMs,
        });
      }
      sourceById.set(row._id as string, {
        sourceResultId: row._id,
        title: row.title,
        snippet: row.snippet,
        canonicalUrl: row.canonicalUrl,
        publisher: row.publisher ?? null,
        publishedAt: row.publishedAt ?? null,
        sourceFamily: row.sourceFamily,
        sourceType: row.sourceType,
        originalLanguage: row.originalLanguage,
        translatedTitle: row.translatedTitle ?? null,
        translatedSnippet: row.translatedSnippet ?? null,
        isAccessible: row.isAccessible,
        role: membership.role,
        signalCategory: membership.signalCategory,
        independenceGroup: membership.independenceGroup,
        foundByQuery: run?.query ?? null,
      });
    }

    const allEvidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    // Only the current snapshot. Earlier versions exist and stay reachable —
    // that is lead history, and it belongs to a different view.
    const evidence = allEvidence
      .filter((e) => e.evidenceVersion === candidate.latestEvidenceVersion)
      .map((e) => ({
        id: e._id,
        kind: e.kind,
        claimText: e.claimText,
        exactExcerpt: e.exactExcerpt ?? null,
        originalLanguageText: e.originalLanguageText ?? null,
        translatedText: e.translatedText ?? null,
        requiresReverification: e.requiresReverification,
        sources: e.sourceResultIds
          .map((id) => sourceById.get(id as string))
          .filter((s): s is typeof vEvidenceSource.type => s !== undefined),
      }));

    // `Why this surfaced` is the convergence: one entry per distinct kind of
    // source among the non-coverage members.
    const confirmingMembers = [...sourceById.values()].filter((s) => s.role !== "coverage");
    // Distinct independence groups per kind, NOT a raw source count. Two results
    // syndicated from one release are one outlet, exactly as the rules engine
    // counts them.
    const outletsByCategory = new Map<string, Set<string>>();
    for (const s of confirmingMembers) {
      const groups = outletsByCategory.get(s.signalCategory) ?? new Set<string>();
      groups.add(s.independenceGroup);
      outletsByCategory.set(s.signalCategory, groups);
    }

    const whySurfaced = [...new Map(
      confirmingMembers
        .sort((a, b) => CATEGORY_RANK[a.signalCategory] - CATEGORY_RANK[b.signalCategory])
        .map((s) => [s.signalCategory, {
          category: s.signalCategory,
          label: CATEGORY_LABELS[s.signalCategory],
          sourceResultId: s.sourceResultId,
          title: s.title,
          publisher: s.publisher,
          publishedAt: s.publishedAt,
          outletCount: outletsByCategory.get(s.signalCategory)?.size ?? 1,
        }]),
    ).values()];

    const components = candidate.scoreComponents;
    const score = candidate.scoreTotal === undefined || components === undefined ? null : {
      total: candidate.scoreTotal,
      components: (Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((key) => ({
        key,
        label: SCORE_LABELS[key],
        ...components[key],
      })),
    };

    const coverage = {
      passStatus: candidate.coveragePassStatus,
      originalReportCount: candidate.coverageOriginalCount,
      // A gap is a claim about the ABSENCE of reporting, so it may only be made
      // when the check actually finished.
      gapAllowed: coverageGapAllowed({
        passStatus: candidate.coveragePassStatus,
        originalReportCount: candidate.coverageOriginalCount,
        countedReportIds: [],
        groupsChecked: [],
      }),
      reports: [...sourceById.values()].filter((s) => s.role === "coverage"),
    };

    const briefs = await ctx.db
      .query("briefVersions")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .order("desc")
      .take(1);
    const latestBrief = briefs[0];
    const brief = latestBrief ? {
      version: latestBrief.version,
      reportingQuestion: latestBrief.reportingQuestion,
      whySurfaced: latestBrief.whySurfaced,
      sections: {
        confirmedFacts: latestBrief.confirmedFacts,
        unverifiedClaims: latestBrief.unverifiedClaims,
        conflicts: latestBrief.conflicts,
        existingCoverage: latestBrief.existingCoverage,
        potentialHumanSources: latestBrief.potentialHumanSources,
      },
      interviewQuestions: latestBrief.interviewQuestions,
      modelRunId: latestBrief.modelRunId ?? null,
    } : null;

    return {
      candidate: {
        id: candidate._id,
        title: candidate.currentTitle,
        reportingQuestion: brief?.reportingQuestion ?? candidate.reportingQuestion,
        beat: candidate.beat,
        status: candidate.status,
        label: candidate.primaryLabel,
        disposition: candidate.disposition,
        scoreTotal: candidate.scoreTotal ?? null,
        exclusionReasons: candidate.exclusionReasons ?? [],
        updatedAt: candidate.updatedAt,
      },
      judgment: candidate.judgment ?? null,
      score,
      whySurfaced,
      evidence,
      coverage,
      brief,
      queryLog,
    };
  },
});
