import { v } from "convex/values";
import { internal } from "./_generated/api";
import { workflow } from "./workflow";

/**
 * The scan's durable spine — `spec.md > Data Flow > Critical scan lifecycle`,
 * steps 1 through 14.
 *
 * It orchestrates and NOTHING else. There is no `if` here that decides an
 * editorial question, no arithmetic on a score, and no string a user will read.
 * Every one of those lives in a step, written and tested on its own.
 *
 * The handler replays from the top whenever a step completes, so it must stay
 * deterministic: no `fetch`, no `process.env`, no unseeded randomness. The
 * component blocks those; this comment is here so nobody spends an hour on it.
 *
 * Cancellation is not checked here — each step checks it immediately before its
 * own external boundary and returns `canceled: true`, which is both more precise
 * and the only way to stop mid-stage.
 */
export const runScan = workflow.define({
  args: { scanId: v.id("scans") },
  returns: v.null(),
}).handler(async (step, { scanId }): Promise<null> => {
  // ── Stage 1 of 4: Discovering signals ──────────────────────────────────
  await step.runMutation(internal.scans.setStage, { scanId, stage: "discovery" });
  const discovery = await step.runAction(internal.stages.discovery.discover, { scanId });
  if (discovery.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 2 of 4: Checking local evidence ─────────────────────────────
  await step.runMutation(internal.scans.setStage, { scanId, stage: "evidence" });
  const evidence = await step.runAction(internal.stages.evidence.buildEvidence, {
    scanId, sourceResultIds: discovery.sourceResultIds,
  });
  if (evidence.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 3 of 4: Reviewing existing coverage ─────────────────────────
  // Coverage before enrichment, always: `spec.md > Search budget` requires the
  // required coverage capacity to be reserved before optional Maps or YouTube.
  await step.runMutation(internal.scans.setStage, { scanId, stage: "coverage" });
  const selection = await step.runQuery(internal.stages.evidence.selectForCoverage, {
    scanId, candidateIds: evidence.candidates.map((c) => c.candidateId), now: Date.now(),
  });
  const coverage = await step.runAction(internal.stages.coverage.checkCoverage, {
    scanId, candidateIds: selection.ordered,
  });
  if (coverage.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // Only candidates coverage actually finished, never the full selection —
  // enrichment money on a candidate coverage never reached buys a search that
  // is excluded regardless of what it finds. `final-review.md` I1.
  const enrichment = await step.runAction(internal.stages.enrichment.enrich, {
    scanId, candidateIds: coverage.completed,
  });
  if (enrichment.canceled) {
    await step.runMutation(internal.scans.finalize, { scanId });
    return null;
  }

  // ── Stage 4 of 4: Preparing leads ─────────────────────────────────────
  // Every candidate is evaluated, including the ones the prefilter skipped AND
  // the ones formation could not classify. A skipped candidate is not deleted —
  // it is excluded with its reasons shown, which is what an editor needs to
  // overrule it. `evidence.candidates` carries `readyForVerdict` per candidate
  // so finalization still knows which ones have no evidence snapshot to write
  // a brief from.
  await step.runMutation(internal.scans.setStage, { scanId, stage: "briefs" });
  await step.runAction(internal.stages.finalize.finalizeCandidates, {
    scanId, candidates: evidence.candidates,
  });

  await step.runMutation(internal.scans.finalize, { scanId });
  return null;
});
