import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { runAdjudicatePairs } from "./ai/adjudicatePairs";
import { runClassifyEvidence } from "./ai/classifyEvidence";
import { runGenerateBrief } from "./ai/generateBrief";
import type { GenerateFn } from "./ai/provider";
import { groupSignals } from "./editorial/blocking";

/**
 * One captured scan, end to end: cluster the results, form candidates, classify
 * the evidence, snapshot it, let the RULES decide, then write the brief.
 *
 * Ordering is the point. Evaluation runs before the brief, so the brief is
 * generated against a candidate whose confirmed sources were settled by
 * `evaluateCandidate` and not by anything a model said.
 *
 * Extracted from the internalAction wrapper so tests inject a fake model: Convex
 * validates action args before the handler runs, so a function value can never
 * travel through `args`.
 */

export type SliceCandidateOutcome = {
  candidateId: Id<"candidates">;
  status: "eligible" | "excluded";
  label: string;
  scoreTotal: number | null;
  evidenceVersion: number | null;
  briefId: Id<"briefVersions"> | null;
  failures: string[];
};

export type SliceOutcome =
  | { ok: true; candidates: SliceCandidateOutcome[] }
  | { ok: false; reason: string; errors: string[] };

export type FormedCandidate = {
  candidateId: Id<"candidates">;
  sourceResultIds: Id<"sourceResults">[];
  evidenceVersion: number | null;
  failures: string[];
  /**
   * False when formation could not produce a judgment, so the rules engine has
   * nothing to decide on. Such a candidate is still finalized — `evaluate`
   * writes the honest "we could not read this" verdict (`unreadableVerdict` in
   * `convex/editorial/status.ts`) rather than leaving it invisible at
   * "processing" forever. This flag now only decides one thing: whether
   * `runCandidateFinalization` asks for a brief. There is no evidence snapshot
   * to cite, so it does not.
   */
  readyForVerdict: boolean;
};

export type FormationOutcome =
  | { ok: true; candidates: FormedCandidate[] }
  | { ok: false; reason: string; errors: string[] };

/**
 * Everything up to, but not including, the verdict.
 *
 * The cut is here because `spec.md > Data Flow` runs coverage searches (step 9)
 * BEFORE evaluation (step 11) — `coveragePassStatus` is an eligibility input.
 * The workflow puts the coverage stage in this gap. Evaluating first and
 * re-evaluating after would write the brief against a verdict about to change.
 */
export async function runCandidateFormation(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] },
  generate?: GenerateFn,
  // Optional so runSliceForScan and item 7's tests, which never cancel, are
  // unaffected. Checked once per cluster: `runClassifyEvidence` below is a
  // model call, and an unbounded number of clusters means an unbounded number
  // of them behind a single top-of-stage check otherwise. final-review.md I2.
  shouldContinue?: () => Promise<boolean>,
): Promise<FormationOutcome> {
  // Grouping is deterministic. `convex/editorial/blocking.ts` blocks, scores and
  // groups in code. It reads what `analyzeResults` already extracted and
  // persisted — entity keys, the claim summary, the translations — so a re-run
  // does not re-pay for it. A model is consulted about ONE thing, below, and only
  // about the pairs the score could not decide.
  const signals = await ctx.runQuery(internal.sourceResults.clusteringSignalsFor, { scanId, sourceResultIds });
  if (signals.length === 0) return { ok: false, reason: "no_signals", errors: ["nothing to cluster"] };
  const scored = groupSignals(signals);

  // The one place a model is asked anything about grouping, and the whole of
  // what it is asked. `scored` already decided two of the three rows on its own
  // — on the real 294 that is 15 links and 1,102 rejections, no model involved.
  // Only `stats.ambiguousPairs` is put to `adjudicatePairs`, one yes/no per
  // pair, and what comes back is a set of pair keys that `groupSignals` re-checks
  // against its OWN score before union-find sees any of it. A yes about a pair
  // the code linked or rejected does nothing.
  //
  // Every failure path here leaves `grouped` as `scored`: the scan still produces
  // clusters from the auto-links alone. Coarser clusters beat a dead scan, and
  // the reason is recorded on the scan rather than swallowed.
  let grouped = scored;
  if (scored.stats.ambiguousPairs > 0) {
    // Checked BEFORE the call, not after: an editor who cancelled must not pay
    // for it. `formFromCluster` below re-checks per cluster.
    if (!shouldContinue || (await shouldContinue())) {
      const adjudicated = await runAdjudicatePairs(ctx, { scanId, signals, pairs: scored.pairs }, generate);
      if (adjudicated.links.length > 0) grouped = groupSignals(signals, adjudicated.links);
      if (adjudicated.failure) {
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: "discovery", code: "adjudicate_failed",
          message: `${adjudicated.sent} ambiguous pairs went unadjudicated: ${adjudicated.failure}`,
        });
      }
      if (adjudicated.overCeiling > 0) {
        // The ceiling is a bound on one call, not a licence to lose pairs. These
        // keep the verdict the code already gave them — unlinked — and say so.
        await ctx.runMutation(internal.scans.recordFailure, {
          scanId, purpose: "discovery", code: "adjudicate_capped",
          message: `${adjudicated.overCeiling} ambiguous pairs were past the per-call ceiling of ${adjudicated.sent} and stay unlinked`,
        });
      }
    }
  }

  const titleById = new Map(signals.map((s) => [s.sourceResultId as string, s.title]));

  const candidates: FormedCandidate[] = [];

  for (const cluster of grouped.clusters) {
    if (shouldContinue && !(await shouldContinue())) break;

    const failures: string[] = [];
    // The tell for Task 4's source-id fallback. A cluster with no entity key
    // still gets a distinct identity, but one built from its own member ids,
    // which are scan-local — it can never match a prior scan's candidate. That
    // degradation is invisible everywhere else in the pipeline (every one of
    // Task 4's tests passes either way), so it is named here, per candidate.
    if (cluster.entityKeys.length === 0) {
      failures.push("identity: no entity keys on this cluster; fingerprint falls back to source ids and cannot match a prior scan");
    }

    const formed = await ctx.runMutation(internal.candidates.form.formFromCluster, {
      scanId,
      cluster,
      // A placeholder, not a judgment. `candidates.beat` is a three-value union
      // with no "not yet classified" member (lib/validators.ts:4), and the
      // classifier that decides the real beat needs a candidateId, so it cannot
      // run first; `saveJudgment` (candidates/judgment.ts:62) corrects the column
      // a moment later. Two costs, named rather than hidden: a candidate whose
      // classification FAILS keeps "housing" permanently in a column the feed can
      // filter on; and since the value never varies, the beat half of
      // `candidateFingerprint` contributes nothing to identity. Making it vary
      // here would be worse — the fingerprint is written once and never
      // recomputed, so a correctable field inside an immutable identity breaks
      // cross-scan continuity. Removing `beat` from the fingerprint is the real
      // fix; it rewrites every existing one, so it needs a decision doc (Task 9).
      beat: "housing",
      // The first member's real headline, verbatim. It used to be the model's
      // `similarityBasis`, which on the measured 294 produced a lead titled
      // "placeholder" (task-1-report.md). The deterministic basis is a list of
      // shared terms — true, but not a headline. A captured title is neither
      // invented nor a judgment.
      workingTitle: (titleById.get(cluster.sourceResultIds[0]) ?? cluster.similarityBasis).slice(0, 120),
    });
    if ("rejected" in formed) continue;
    const { candidateId } = formed;
    const memberIds = cluster.sourceResultIds as Id<"sourceResults">[];

    const classified = await runClassifyEvidence(ctx, { scanId, candidateId, sourceResultIds: memberIds }, generate);
    if (!classified.ok) {
      candidates.push({
        candidateId, sourceResultIds: memberIds, evidenceVersion: null,
        failures: [...failures, `classify: ${classified.reason}`], readyForVerdict: false,
      });
      continue;
    }

    await ctx.runMutation(internal.candidates.judgment.saveJudgment, {
      candidateId,
      judgment: {
        localityBand: classified.judgment.localityBand,
        relevanceBand: classified.judgment.relevanceBand,
        beat: classified.judgment.beat,
        isSpeculative: classified.judgment.isSpeculative,
        isRoutineCrime: classified.judgment.isRoutineCrime,
        isDuplicateOfCandidate: classified.judgment.isDuplicateOfCandidate,
        hasMaterialConflict: classified.judgment.hasMaterialConflict,
      },
    });

    const snapshot = await ctx.runMutation(internal.candidates.snapshot.writeSnapshot, {
      scanId,
      candidateId,
      modelRunId: classified.modelRunId,
      items: classified.suggestions.items.map((i) => ({
        sourceResultIds: i.sourceResultIds,
        kind: i.kind,
        claimText: i.claimText,
        exactExcerpt: i.exactExcerpt,
        originalLanguageText: i.originalLanguageText,
        translatedText: i.translatedText,
      })),
    });
    const evidenceVersion = "evidenceVersion" in snapshot ? snapshot.evidenceVersion : null;
    if ("rejected" in snapshot) failures.push(`snapshot: ${snapshot.rejected}`);

    candidates.push({ candidateId, sourceResultIds: memberIds, evidenceVersion: evidenceVersion ?? null, failures, readyForVerdict: true });
  }

  return { ok: true, candidates };
}

/**
 * The verdict, then the brief. In that order, always.
 *
 * `evaluate` is the single writer of status, label and score. Nothing here
 * re-derives any of them; the brief is generated against what the rules decided.
 */
export async function runCandidateFinalization(
  ctx: ActionCtx,
  { scanId, candidateId, readyForVerdict = true, now = Date.now() }: {
    scanId: Id<"scans">; candidateId: Id<"candidates">; readyForVerdict?: boolean; now?: number;
  },
  generate?: GenerateFn,
): Promise<SliceCandidateOutcome> {
  const failures: string[] = [];

  const verdict = await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });
  if ("rejected" in verdict) {
    return {
      candidateId, status: "excluded", label: "Worth a look", scoreTotal: null,
      evidenceVersion: null, briefId: null, failures: [`evaluate: ${verdict.rejected}`],
    };
  }

  let briefId: Id<"briefVersions"> | null = null;
  // No evidence snapshot means nothing to cite. Asking a model to write a brief
  // from nothing is the fabrication this product refuses.
  if (readyForVerdict) {
    const brief = await runGenerateBrief(ctx, { scanId, candidateId }, generate);
    if (brief.ok) briefId = brief.briefId;
    // "already_generated" means the identical brief exists; that is a success,
    // not a failure, and it deliberately costs no model call.
    else if (brief.reason !== "already_generated") failures.push(`brief: ${brief.reason}`);
  }

  const candidate = await ctx.runQuery(internal.candidates.evaluate.getEvidenceVersion, { candidateId });

  return {
    candidateId,
    status: verdict.status,
    label: verdict.label,
    scoreTotal: verdict.scoreTotal,
    evidenceVersion: candidate?.latestEvidenceVersion ?? null,
    briefId,
    failures,
  };
}

/**
 * Formation then finalization, with nothing in between — the item 7 behaviour,
 * unchanged. The workflow does not call this; it calls the two halves with the
 * coverage stage between them. Kept because item 7's tests and
 * `internal.testing.seedSliceFixture` both depend on it.
 */
export async function runSliceForScan(
  ctx: ActionCtx,
  { scanId, sourceResultIds, now = Date.now() }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[]; now?: number },
  generate?: GenerateFn,
): Promise<SliceOutcome> {
  const formed = await runCandidateFormation(ctx, { scanId, sourceResultIds }, generate);
  if (!formed.ok) return formed;

  const candidates: SliceCandidateOutcome[] = [];
  for (const c of formed.candidates) {
    // Every formed candidate is finalized, including one formation could not
    // classify — `evaluate` gives it the honest "unreadable" verdict instead
    // of leaving it invisible. `readyForVerdict` still decides whether a
    // brief is attempted; see `runCandidateFinalization`.
    const outcome = await runCandidateFinalization(ctx, { scanId, candidateId: c.candidateId, readyForVerdict: c.readyForVerdict, now }, generate);
    candidates.push({ ...outcome, evidenceVersion: c.evidenceVersion, failures: [...c.failures, ...outcome.failures] });
  }
  return { ok: true, candidates };
}

export const runSlice = internalAction({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      candidates: v.array(v.object({
        candidateId: v.id("candidates"),
        status: v.union(v.literal("eligible"), v.literal("excluded")),
        label: v.string(),
        scoreTotal: v.union(v.number(), v.null()),
        evidenceVersion: v.union(v.number(), v.null()),
        briefId: v.union(v.id("briefVersions"), v.null()),
        failures: v.array(v.string()),
      })),
    }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args): Promise<SliceOutcome> => await runSliceForScan(ctx, args),
});
