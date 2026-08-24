import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { runClassifyEvidence } from "./ai/classifyEvidence";
import { runClusterSignals } from "./ai/clusterSignals";
import { runGenerateBrief } from "./ai/generateBrief";
import type { GenerateFn } from "./ai/provider";

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
   * nothing to decide on. Such a candidate must NOT be finalized: `evaluate`
   * would no-op with "no_judgment", which misnames the cause — classification
   * failed, and the absent judgment is the consequence, not the reason.
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
  const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
  const clustered = await runClusterSignals(ctx, { scanId, signals }, generate);
  if (!clustered.ok) return { ok: false, reason: clustered.reason, errors: clustered.errors };

  const candidates: FormedCandidate[] = [];

  for (const cluster of clustered.clusters) {
    if (shouldContinue && !(await shouldContinue())) break;

    const failures: string[] = [];

    const formed = await ctx.runMutation(internal.candidates.form.formFromCluster, {
      scanId,
      cluster,
      // The rules engine needs a beat to start from; the model's beat suggestion
      // arrives with classification a moment later and can move it.
      beat: "housing",
      workingTitle: cluster.similarityBasis.slice(0, 120),
    });
    if ("rejected" in formed) continue;
    const { candidateId } = formed;
    const memberIds = cluster.sourceResultIds as Id<"sourceResults">[];

    const classified = await runClassifyEvidence(ctx, { scanId, candidateId, sourceResultIds: memberIds }, generate);
    if (!classified.ok) {
      candidates.push({
        candidateId, sourceResultIds: memberIds, evidenceVersion: null,
        failures: [`classify: ${classified.reason}`], readyForVerdict: false,
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
  { scanId, candidateId, now = Date.now() }: { scanId: Id<"scans">; candidateId: Id<"candidates">; now?: number },
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
  const brief = await runGenerateBrief(ctx, { scanId, candidateId }, generate);
  if (brief.ok) briefId = brief.briefId;
  // "already_generated" means the identical brief exists; that is a success,
  // not a failure, and it deliberately costs no model call.
  else if (brief.reason !== "already_generated") failures.push(`brief: ${brief.reason}`);

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
    if (!c.readyForVerdict) {
      // Formation itself failed (no judgment to hand the rules). Match the
      // old single-pass code's terminal outcome exactly: never call evaluate.
      candidates.push({
        candidateId: c.candidateId, status: "excluded", label: "Worth a look", scoreTotal: null,
        evidenceVersion: c.evidenceVersion, briefId: null, failures: c.failures,
      });
      continue;
    }
    const outcome = await runCandidateFinalization(ctx, { scanId, candidateId: c.candidateId, now }, generate);
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
