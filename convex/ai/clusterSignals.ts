import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
import { SCHEMA_VERSION, clusterSignalsOutput, type ClusterSignalsOutput } from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

export const loadExistingCandidates = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.array(v.object({ candidateId: v.string(), fingerprint: v.string(), summary: v.string() })),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return [];
    const candidates = await ctx.db
      .query("candidates")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", scan.ownerId))
      .order("desc")
      .take(50);
    return candidates.map((c) => ({
      candidateId: c._id as string,
      fingerprint: c.fingerprint,
      summary: c.currentTitle,
    }));
  },
});

export type ClusterSignalInput = { sourceResultId: Id<"sourceResults">; entityKeys: string[]; claimSummary: string };
export type ClusterArgs = { scanId: Id<"scans">; signals: ClusterSignalInput[] };
export type ClusterOutcome =
  | { ok: true; clusters: ClusterSignalsOutput["clusters"]; modelRunId: Id<"modelRuns"> }
  | { ok: false; reason: string; errors: string[] };

/**
 * Proposes groupings only. Nothing here creates a candidate: `independence.ts`
 * still applies source-family independence afterwards and MAY split any cluster
 * the model proposed. No embeddings, no vector store — entity keys plus
 * structured output are enough at this scale.
 */
export async function runClusterSignals(
  ctx: ActionCtx,
  { scanId, signals }: ClusterArgs,
  generate?: GenerateFn,
): Promise<ClusterOutcome> {
  if (signals.length === 0) return { ok: false, reason: "no_signals", errors: ["nothing to cluster"] };

  const existingCandidates = await ctx.runQuery(internal.ai.clusterSignals.loadExistingCandidates, { scanId });
  const input = { signals, existingCandidates };

  const result = await runAiOperation<ClusterSignalsOutput>(ctx, {
    scanId, operation: "clusterSignals", input,
    outputSchema: clusterSignalsOutput, schemaVersion: SCHEMA_VERSION,
    validation: {
      knownSourceIds: signals.map((s) => s.sourceResultId),
      excerptsBySourceId: {},
      // A link to a candidate we never showed the model is the same failure mode
      // as an invented source id, so it is checked in the same place — BEFORE the
      // run is marked succeeded, or the log would say "succeeded" about output we
      // threw away.
      knownCandidateIds: existingCandidates.map((c) => c.candidateId),
    },
    generate,
  });
  if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };

  return { ok: true, clusters: result.value.clusters, modelRunId: result.modelRunId };
}

export const cluster = internalAction({
  args: {
    scanId: v.id("scans"),
    signals: v.array(v.object({
      sourceResultId: v.id("sourceResults"),
      entityKeys: v.array(v.string()),
      claimSummary: v.string(),
    })),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true), modelRunId: v.id("modelRuns"),
      clusters: v.array(v.object({
        sourceResultIds: v.array(v.string()),
        similarityBasis: v.string(),
        entityKeys: v.array(v.string()),
        suggestedExistingCandidateId: v.union(v.string(), v.null()),
      })),
    }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const outcome = await runClusterSignals(ctx, args);
    return outcome.ok
      ? { ok: true as const, modelRunId: outcome.modelRunId, clusters: outcome.clusters }
      : { ok: false as const, reason: outcome.reason, errors: outcome.errors };
  },
});
