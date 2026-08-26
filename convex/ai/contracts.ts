import { z } from "zod";

/**
 * One input schema and one output schema per approved operation.
 *
 * Two rules shape every schema here:
 * 1. `.nullable()`, never `.optional()`. Some providers reject optional fields in
 *    structured output, and a missing field is indistinguishable from a refusal.
 *    Absent values are explicit nulls; `stripNulls` turns them into `undefined`
 *    after validation, at the boundary where Convex wants optionals.
 * 2. No field anywhere accepts a URL, a search parameter, or a confirmation.
 *    Those are decisions, and decisions are not the model's to make.
 */

export const SCHEMA_VERSION = "1";

// Length ceilings, from the spec. A model that rambles gets rejected, not truncated —
// truncation would silently change what a citation claims.
export const MAX_CLAIM = 400;
export const MAX_REASON = 300;
export const MAX_INTERVIEW_QUESTION = 200;

const claimText = z.string().min(1).max(MAX_CLAIM);
const reason = z.string().min(1).max(MAX_REASON);
const sourceId = z.string().min(1);

const beat = z.enum(["housing", "transportation", "culture"]);
const sourceTypeSuggestion = z.enum(["primary", "secondary", "discussion", "unknown"]);
const localityBand = z.enum(["direct_city", "county_city_effect", "area_city_consequence", "none"]);
const relevanceBand = z.enum(["policy_service_change", "community_cultural_impact", "emerging_question", "promotion_only"]);
const sourceFamily = z.enum(["news", "official", "event", "video", "map", "community_discussion", "public_web", "trend"]);
const purpose = z.enum(["discovery", "corroboration", "coverage", "enrichment"]);

/** A statement bound to the sources it came from. Never accepted without at least one. */
const sourceBoundBlock = z.object({
  text: claimText,
  sourceResultIds: z.array(sourceId).min(1),
  exactExcerpt: z.string().nullable(),
});

// --- analyzeResults -----------------------------------------------------------

export const analyzeResultsInput = z.object({
  sources: z.array(z.object({
    sourceResultId: sourceId,
    title: z.string(),
    snippet: z.string(),
    publisher: z.string().nullable(),
    canonicalUrl: z.string(),
    originalLanguage: z.string(),
    sourceFamily,
    publishedAt: z.string().nullable(),
  })).min(1),
});

export const analyzeResultsOutput = z.object({
  items: z.array(z.object({
    sourceResultId: sourceId,
    detectedLanguage: z.enum(["en", "es", "other"]),
    originalTitle: z.string().nullable(),
    translatedTitle: z.string().nullable(),
    originalSnippet: z.string().nullable(),
    translatedSnippet: z.string().nullable(),
    sourceTypeSuggestion,
    entities: z.object({
      people: z.array(z.string()),
      organizations: z.array(z.string()),
      streets: z.array(z.string()),
      neighborhoods: z.array(z.string()),
      agencies: z.array(z.string()),
    }),
    dates: z.array(z.string()),
    claims: z.array(z.object({ text: claimText, exactExcerpt: z.string().nullable() })),
    potentialHumanSources: z.array(z.object({ name: z.string().min(1), why: reason })),
    reason,
  })).min(1),
});

// --- clusterSignals -----------------------------------------------------------

export const clusterSignalsInput = z.object({
  signals: z.array(z.object({
    sourceResultId: sourceId,
    entityKeys: z.array(z.string()),
    claimSummary: z.string(),
  })).min(1),
  existingCandidates: z.array(z.object({
    candidateId: z.string().min(1),
    fingerprint: z.string(),
    summary: z.string(),
  })),
});

export const clusterSignalsOutput = z.object({
  clusters: z.array(z.object({
    // A cluster with no input result is not a cluster; the deterministic layer
    // may still split this one on source-family independence.
    sourceResultIds: z.array(sourceId).min(1),
    similarityBasis: reason,
    entityKeys: z.array(z.string()),
    suggestedExistingCandidateId: z.string().nullable(),
  })).min(1),
});

// --- adjudicatePairs ----------------------------------------------------------

/**
 * The ceiling on one adjudication call, and the one number in this file that is
 * a spend and latency bound rather than a content rule.
 *
 * CHOSEN: 200 — the top of the measured expectation in
 * `research-clustering.md` §3 ("order 50 to 200 pairs"). The real 294-source
 * scan produces 89. At 200 the output is roughly 200 x 30 = 6,000 tokens, which
 * measured at 55.7 s in `task-1-report.md` — inside `TIMEOUT_MS` (120 s) with
 * most of a factor of two to spare.
 *
 * PAST IT: `buildAdjudicationRequest` sends the 200 highest-scoring ambiguous
 * pairs and reports the rest as `overCeiling`. Those pairs keep the verdict the
 * deterministic layer already gave them — unlinked — which is exactly what every
 * ambiguous pair got before this operation existed. They are counted, recorded
 * on the scan as a failure summary, and never silently discarded.
 */
export const MAX_ADJUDICATED_PAIRS = 200;

/**
 * The over-merge tell. Not a cap — nothing is truncated when a cluster passes
 * it — but the one number that would show a degenerate adjudication run while
 * it is still on the scan rather than in a test.
 *
 * WHY A NUMBER IS NEEDED AT ALL: the schema stops the model NAMING a group; it
 * does not stop union-find BUILDING one out of its answers. yes(a,b) plus
 * yes(b,c) puts a and c in one cluster the model never endorsed, and the only
 * bound on how far that chains is the blocking graph.
 *
 * CHOSEN: 8, from three measurements on the real 294-source scan
 * (`tests/fixtures/clustering/scan-294.json`).
 *   - Today's run: 39 adjudicated links, largest cluster 5. A ceiling of 8
 *     leaves 60% headroom, so a normal scan never trips it.
 *   - Task 7's whole-scan canary uses the same "largest cluster <= 8", so the
 *     runtime tell and the fixture test agree on one number instead of drifting.
 *   - The degenerate case measured in `task-6-review.md` §2 — the model
 *     answering yes to all 89 band pairs — yields a largest cluster of 18, every
 *     r/milwaukee thread in the scan chained into one story. 8 catches that with
 *     room to spare.
 *
 * PAST IT: nothing is undone. The clusters stand and the scan records
 * `over_merged` naming the size, because silently repartitioning on a threshold
 * would be this code deciding an editorial question on a heuristic.
 */
export const MAX_ADJUDICATED_CLUSTER_SIZE = 8;

/**
 * Two sources the deterministic scorer could not decide between, with the terms
 * it matched them on. There is no sourceResultId here on purpose: the only
 * handle the model is given is `pairId`, a token this code minted, so it has
 * nothing with which to cite a source or compose a pair it was not shown.
 */
export const adjudicatePairsInput = z.object({
  pairs: z.array(z.object({
    pairId: z.string().min(1),
    sharedTerms: z.array(z.string()),
    first: z.object({ title: z.string(), snippet: z.string(), claimSummary: z.string() }),
    second: z.object({ title: z.string(), snippet: z.string(), claimSummary: z.string() }),
  })).min(1).max(MAX_ADJUDICATED_PAIRS),
});

/**
 * One yes/no per pair, and nothing wider.
 *
 * THE MODEL CANNOT NAME A GROUP. There is no array of source ids anywhere in
 * this schema, no cluster object, and no field in which more than one pair can
 * be named — the widest true statement the model can make is "these two are the
 * same story".
 *
 * IT CAN STILL BUILD ONE. Union-find in `convex/editorial/blocking.ts` composes
 * its yes-answers and has no way to honour a no: yes(a,b) plus yes(b,c) puts a
 * and c in one cluster the model never endorsed. What bounds that is not this
 * schema but the blocking graph — only pairs blocking proposed and the score
 * left ambiguous are ever asked about, and `groupSignals` honours a yes only for
 * a pair its own score put in that band. Measured on the real 294-source scan:
 * today's answers give a largest cluster of 5, and an all-yes answer over all 89
 * band pairs would give 18 (`task-6-review.md` §2). `MAX_ADJUDICATED_CLUSTER_SIZE`
 * above is the runtime tell for that.
 *
 * So the "AI suggests, code decides" line is drawn in a type AND in the graph —
 * the type alone does not draw it.
 */
export const adjudicatePairsOutput = z.object({
  verdicts: z.array(z.object({
    pairId: z.string().min(1),
    sameStory: z.boolean(),
    reason,
  })).min(1).max(MAX_ADJUDICATED_PAIRS),
});

// --- classifyEvidence ---------------------------------------------------------

export const classifyEvidenceInput = z.object({
  candidateId: z.string().min(1),
  sources: z.array(z.object({
    sourceResultId: sourceId,
    title: z.string(),
    snippet: z.string(),
    publisher: z.string().nullable(),
    sourceFamily,
    isAccessible: z.boolean(),
  })).min(1),
  claims: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
});

/**
 * `confirmed_fact` is deliberately absent from this enum. Confirmation is computed
 * afterwards from qualifying sources and rules — a model that could emit it would
 * be setting evidence status, which the product forbids.
 */
export const suggestedEvidenceKind = z.enum([
  "unverified_signal", "conflicting_claim", "existing_coverage", "potential_source",
]);

export const classifyEvidenceOutput = z.object({
  beatSuggestion: beat.nullable(),
  localityBandSuggestion: localityBand,
  relevanceBandSuggestion: relevanceBand,
  flags: z.object({
    isSpeculative: z.boolean(),
    isRoutineCrime: z.boolean(),
    isDuplicateOfCandidate: z.boolean(),
    hasMaterialConflict: z.boolean(),
  }),
  items: z.array(z.object({
    sourceResultIds: z.array(sourceId).min(1),
    kind: suggestedEvidenceKind,
    claimText,
    exactExcerpt: z.string().nullable(),
    originalLanguageText: z.string().nullable(),
    translatedText: z.string().nullable(),
    sourceTypeSuggestion,
    independenceGroupSuggestion: z.string().nullable(),
    relationship: z.enum(["supports", "conflicts", "unrelated"]),
    milwaukeeConnection: reason,
    accessibilityConcern: z.boolean(),
    repeatsPressRelease: z.boolean(),
    reason,
  })).min(1),
});

// --- planFollowUp -------------------------------------------------------------

export const planFollowUpInput = z.object({
  candidateId: z.string().min(1),
  beat: beat.nullable(),
  gaps: z.array(z.string()),
  priorTemplateIds: z.array(z.string()),
  remainingBudget: z.object({
    discovery: z.number(), coverage: z.number(), corroboration: z.number(), enrichment: z.number(),
  }),
});

/**
 * An intent names a frozen template and a purpose. There is no URL field and no
 * parameter field, by construction — `editorial.validateSearchIntent` then maps
 * the intent to an approved template or rejects it with a reason.
 */
export const planFollowUpOutput = z.object({
  intents: z.array(z.object({
    templateId: z.string().min(1),
    purpose,
    desiredSourceFamily: sourceFamily,
    entityTerms: z.array(z.string()),
    reason,
  })).max(10),
});

// --- generateBrief ------------------------------------------------------------

export const generateBriefInput = z.object({
  candidateId: z.string().min(1),
  whySurfacedFacts: z.array(z.string()),
  confirmedEvidence: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
  unverifiedEvidence: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
  conflictingEvidence: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
  coverageEvidence: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
  potentialSources: z.array(z.object({ text: claimText, sourceResultIds: z.array(sourceId).min(1) })),
  sourceMetadata: z.array(z.object({
    sourceResultId: sourceId,
    title: z.string(),
    publisher: z.string().nullable(),
    canonicalUrl: z.string(),
  })),
});

export const generateBriefOutput = z.object({
  reportingQuestion: reason,
  whySurfaced: claimText,
  confirmedFacts: z.array(sourceBoundBlock),
  unverifiedClaims: z.array(sourceBoundBlock),
  conflicts: z.array(sourceBoundBlock),
  existingCoverage: z.array(sourceBoundBlock),
  potentialHumanSources: z.array(sourceBoundBlock),
  interviewQuestions: z.array(z.string().min(1).max(MAX_INTERVIEW_QUESTION)).max(10),
});

// --- registry -----------------------------------------------------------------

export const OPERATION_SCHEMAS = {
  analyzeResults: { input: analyzeResultsInput, output: analyzeResultsOutput },
  clusterSignals: { input: clusterSignalsInput, output: clusterSignalsOutput },
  adjudicatePairs: { input: adjudicatePairsInput, output: adjudicatePairsOutput },
  classifyEvidence: { input: classifyEvidenceInput, output: classifyEvidenceOutput },
  planFollowUp: { input: planFollowUpInput, output: planFollowUpOutput },
  generateBrief: { input: generateBriefInput, output: generateBriefOutput },
} as const;

export type AnalyzeResultsOutput = z.infer<typeof analyzeResultsOutput>;
export type ClusterSignalsOutput = z.infer<typeof clusterSignalsOutput>;
export type AdjudicatePairsInput = z.infer<typeof adjudicatePairsInput>;
export type AdjudicatePairsOutput = z.infer<typeof adjudicatePairsOutput>;
export type ClassifyEvidenceOutput = z.infer<typeof classifyEvidenceOutput>;
export type PlanFollowUpOutput = z.infer<typeof planFollowUpOutput>;
export type GenerateBriefOutput = z.infer<typeof generateBriefOutput>;

/**
 * Nulls are how the schema says "absent"; Convex optionals are how the database
 * says it. This converts one to the other, and only at that boundary.
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null) continue;
    out[k] = stripNulls(v);
  }
  return out as T;
}
