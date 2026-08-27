import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as V from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_user_id", ["clerkUserId"]),

  scans: defineTable({
    ownerId: v.id("users"),
    marketKey: V.vMarketKey,
    rulesetVersion: v.string(),
    queryCatalogVersion: v.string(),
    status: V.vScanStatus,
    stage: V.vStage,
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelRequestedAt: v.optional(v.number()),
    // The durable workflow executing this scan. Optional because a scan row can
    // exist for a moment before `start` returns, and because saved demo scans
    // (item 10) are imported rows that no workflow ever ran.
    workflowId: v.optional(v.string()),
    searchBudgetLimit: v.number(),
    searchesReserved: v.number(),
    searchesSucceeded: v.number(),
    searchesFailed: v.number(),
    eligibleCount: v.number(),
    excludedCount: v.number(),
    processingCount: v.number(),
    failureSummaries: v.array(V.vFailureSummary),
    isSavedDemo: v.boolean(),
    captureTimestamp: v.optional(v.number()),
  })
    .index("by_owner_started", ["ownerId", "startedAt"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status_started", ["status", "startedAt"]),

  searchRuns: defineTable({
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    idempotencyKey: v.string(),
    templateId: v.string(),
    queryCatalogVersion: v.string(),
    purpose: V.vPurpose,
    engine: V.vEngine,
    query: v.string(),
    parameters: v.record(v.string(), v.string()),
    language: V.vLanguage,
    status: V.vSearchRunStatus,
    attemptCount: v.number(),
    resultCount: v.number(),
    durationMs: v.number(),
    rawStorageId: v.optional(v.id("_storage")),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    reservedAt: v.number(),
    completedAt: v.optional(v.number()),
    candidateId: v.optional(v.id("candidates")),
  })
    .index("by_scan_purpose", ["scanId", "purpose"])
    .index("by_scan_status", ["scanId", "status"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_candidate", ["candidateId"]),

  sourceResults: defineTable({
    scanId: v.id("scans"),
    searchRunId: v.id("searchRuns"),
    ownerId: v.id("users"),
    canonicalKey: v.string(),
    canonicalUrl: v.string(),
    originalUrl: v.string(),
    engine: V.vEngine,
    sourceFamily: V.vSourceFamily,
    sourceType: V.vSourceType,
    title: v.string(),
    snippet: v.string(),
    originalLanguage: v.string(),
    translatedTitle: v.optional(v.string()),
    translatedSnippet: v.optional(v.string()),
    publisher: v.optional(v.string()),
    author: v.optional(v.string()),
    channel: v.optional(v.string()),
    placeName: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    discoveredAt: v.number(),
    position: v.optional(v.number()),
    nativeId: v.optional(v.string()),
    redditPostId: v.optional(v.string()),
    isAccessible: v.boolean(),
    accessCheckedAt: v.optional(v.number()),
    contentHash: v.string(),
    // What analyzeResults extracted, kept in ONE nested field so model-derived
    // data is never mistaken for the deterministic fields above it. Optional
    // because a row ingested before analysis ran — or whose analysis failed —
    // is a valid row; `analysis === undefined` is the single "never analysed"
    // check. Written only by `ai/analyzeResults.persistAnalysis`.
    analysis: v.optional(v.object({
      // The five entity categories the model returns, flattened and deduplicated.
      // Every consumer (candidateFingerprint, clusterSignals, blocking) wants one
      // flat key list, so the split is collapsed once here instead of five times
      // downstream.
      entityKeys: v.array(v.string()),
      // The first extracted claim, falling back to the model's reason. This is
      // what clustering and blocking read; the fallback rule lives here so no
      // consumer has to reinvent it.
      claimSummary: v.string(),
      claims: v.array(v.object({
        text: v.string(),
        // Already checked word-for-word against the stored title or snippet by
        // `validateAgainstSources` before it could be written.
        exactExcerpt: v.optional(v.string()),
      })),
      dates: v.array(v.string()),
      // Which paid call produced this, the same provenance rule evidenceItems
      // uses. It is what makes "we already paid for this" auditable.
      modelRunId: v.id("modelRuns"),
    })),
  })
    .index("by_scan", ["scanId"])
    .index("by_search_run", ["searchRunId"])
    .index("by_scan_canonical", ["scanId", "canonicalKey"])
    .index("by_reddit_post_id", ["redditPostId"]),

  candidates: defineTable({
    ownerId: v.id("users"),
    fingerprint: v.string(),
    currentTitle: v.string(),
    reportingQuestion: v.string(),
    // Absent until the classifier establishes one. Formation runs BEFORE
    // classification (the classifier needs a candidateId), so at insert there is
    // no honest value to write — and `no_beat_relevance` is a real verdict, so
    // even a successful classification often names none. Optional rather than an
    // "unassigned" union member: absence is not a fourth beat, and it must never
    // appear in the beat filter or in BEAT_TEXT.
    beat: v.optional(V.vBeat),
    status: V.vCandidateStatus,
    primaryLabel: V.vProductLabel,
    disposition: V.vDisposition,
    latestEvidenceVersion: v.number(),
    latestBriefVersion: v.optional(v.number()),
    scoreTotal: v.optional(v.number()),
    scoreComponents: v.optional(V.vScoreComponents),
    // Decision 004: every judgment field the rules engine reads records WHO set
    // it — a rule, the AI, or an editor. Optional because a candidate created
    // before classification runs has no judgment yet.
    judgment: v.optional(V.vJudgmentRecord),
    independentCategoryCount: v.number(),
    coverageOriginalCount: v.number(),
    coveragePassStatus: V.vCoveragePassStatus,
    // Per-partition, because "general succeeded, community failed" is a real
    // outcome the spec names and a single collapsed status cannot express.
    // A scan that checked only the big outlets must never claim a coverage gap.
    coveragePartitions: v.optional(v.object({
      general: V.vCoveragePartitionStatus,
      community: V.vCoveragePartitionStatus,
    })),
    // Why a candidate was excluded, in the engine's own words. Empty when it
    // qualified. Optional because rows written before evaluation have no verdict.
    exclusionReasons: v.optional(v.array(V.vExclusionReason)),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_fingerprint", ["ownerId", "fingerprint"])
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_owner_disposition", ["ownerId", "disposition"]),

  candidateAppearances: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    statusAtScan: V.vCandidateStatus,
    labelAtScan: V.vProductLabel,
    dispositionAtScan: V.vDisposition,
    scoreAtScan: v.optional(v.number()),
    coverageCountAtScan: v.optional(v.number()),
    categoryCountAtScan: v.optional(v.number()),
    changeSummary: v.optional(v.record(v.string(), v.string())),
    rank: v.optional(v.number()),
  })
    .index("by_scan_rank", ["scanId", "rank"])
    .index("by_candidate_scan", ["candidateId", "scanId"])
    .index("by_owner_scan", ["ownerId", "scanId"]),

  candidateSources: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    sourceResultId: v.id("sourceResults"),
    role: V.vSourceRole,
    independenceGroup: v.string(),
    signalCategory: V.vSignalCategory,
    addedBy: V.vAddedBy,
  })
    .index("by_candidate_scan", ["candidateId", "scanId"])
    .index("by_source_result", ["sourceResultId"])
    .index("by_candidate_role", ["candidateId", "role"]),

  // ponytail: `by_source_result` index dropped here — it indexed sourceResultIds,
  // an array field, which Convex does not allow for a table index.
  evidenceItems: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    evidenceVersion: v.number(),
    kind: V.vEvidenceKind,
    claimText: v.string(),
    sourceResultIds: v.array(v.id("sourceResults")),
    exactExcerpt: v.optional(v.string()),
    originalLanguageText: v.optional(v.string()),
    translatedText: v.optional(v.string()),
    classificationBasis: v.string(),
    confidence: v.optional(v.number()),
    conflictGroupId: v.optional(v.string()),
    requiresReverification: v.boolean(),
    createdByModelRunId: v.optional(v.id("modelRuns")),
  })
    .index("by_candidate_version", ["candidateId", "evidenceVersion"])
    .index("by_scan_kind", ["scanId", "kind"]),

  briefVersions: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    version: v.number(),
    reportingQuestion: v.string(),
    whySurfaced: v.string(),
    confirmedFacts: v.array(V.vSourceBoundBlock),
    unverifiedClaims: v.array(V.vSourceBoundBlock),
    conflicts: v.array(V.vSourceBoundBlock),
    existingCoverage: v.array(V.vSourceBoundBlock),
    potentialHumanSources: v.array(V.vSourceBoundBlock),
    interviewQuestions: v.array(v.string()),
    modelRunId: v.optional(v.id("modelRuns")),
    editedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_candidate_version", ["candidateId", "version"])
    .index("by_scan", ["scanId"]),

  editorEvents: defineTable({
    candidateId: v.id("candidates"),
    ownerId: v.id("users"),
    scanId: v.id("scans"),
    actorUserId: v.id("users"),
    type: V.vEditorEventType,
    before: v.optional(v.record(v.string(), v.string())),
    after: v.optional(v.record(v.string(), v.string())),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_candidate_created", ["candidateId", "createdAt"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  modelRuns: defineTable({
    scanId: v.id("scans"),
    candidateId: v.optional(v.id("candidates")),
    ownerId: v.id("users"),
    operation: V.vModelOperation,
    idempotencyKey: v.string(),
    provider: v.string(),
    modelId: v.string(),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    inputSnapshotHash: v.string(),
    status: V.vModelRunStatus,
    attempt: v.number(),
    fallbackFromRunId: v.optional(v.id("modelRuns")),
    fallbackReason: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    validationErrors: v.optional(v.array(v.string())),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_scan_operation", ["scanId", "operation"])
    .index("by_candidate_operation", ["candidateId", "operation"])
    .index("by_idempotency_key", ["idempotencyKey"]),
});
