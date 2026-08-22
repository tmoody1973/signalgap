import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { estimateCostUsd } from "./ai/pricing";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

/**
 * Model idempotency key, per spec:
 * scanId:candidateId:operation:inputSnapshotHash:schemaVersion:promptVersion:modelId
 * `candidateId` is the empty string for scan-level operations.
 */
export const modelIdempotencyKey = (parts: {
  scanId: string; candidateId?: string; operation: string;
  inputSnapshotHash: string; schemaVersion: string; promptVersion: string; modelId: string;
}) =>
  [parts.scanId, parts.candidateId ?? "", parts.operation, parts.inputSnapshotHash,
    parts.schemaVersion, parts.promptVersion, parts.modelId].join(":");

export const create = internalMutation({
  args: {
    scanId: v.id("scans"),
    candidateId: v.optional(v.id("candidates")),
    operation: V.vModelOperation,
    provider: v.string(),
    modelId: v.string(),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    inputSnapshotHash: v.string(),
    attempt: v.number(),
    fallbackFromRunId: v.optional(v.id("modelRuns")),
    fallbackReason: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ runId: v.id("modelRuns"), reused: v.boolean() }),
    v.object({ rejected: v.literal("scan_not_found") }),
  ),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get(args.scanId);
    if (!scan) return { rejected: "scan_not_found" as const };

    const idempotencyKey = modelIdempotencyKey({ ...args, candidateId: args.candidateId ?? undefined });
    // A fallback attempt is a genuinely different run against a different model,
    // so its key differs by modelId and it will not collide with the primary.
    const existing = await ctx.db
      .query("modelRuns")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { runId: existing._id, reused: true };

    const runId = await ctx.db.insert("modelRuns", {
      scanId: args.scanId, candidateId: args.candidateId, ownerId: scan.ownerId,
      operation: args.operation, idempotencyKey,
      provider: args.provider, modelId: args.modelId,
      promptVersion: args.promptVersion, schemaVersion: args.schemaVersion,
      inputSnapshotHash: args.inputSnapshotHash,
      status: "running", attempt: args.attempt,
      fallbackFromRunId: args.fallbackFromRunId, fallbackReason: args.fallbackReason,
      startedAt: Date.now(),
    });
    return { runId, reused: false };
  },
});

export const complete = internalMutation({
  args: {
    runId: v.id("modelRuns"),
    durationMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, durationMs, inputTokens, outputTokens }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    // Terminal states are final — a re-run must create a new row, or the token
    // and cost totals for the scan stop adding up.
    if (run.status !== "running") return null;
    await ctx.db.patch(runId, {
      status: "succeeded", durationMs, inputTokens, outputTokens,
      estimatedCostUsd: estimateCostUsd(run.modelId, inputTokens, outputTokens),
      completedAt: Date.now(),
    });
    return null;
  },
});

export const invalidate = internalMutation({
  args: {
    runId: v.id("modelRuns"),
    // "invalid" = the model answered but the answer did not fit the contract.
    // "failed"  = we never got an answer (network, 429, 5xx, timeout, 4xx).
    status: v.union(v.literal("invalid"), v.literal("failed")),
    validationErrors: v.array(v.string()),
    durationMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, validationErrors, durationMs, inputTokens, outputTokens }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    if (run.status !== "running") return null;
    await ctx.db.patch(runId, {
      status, validationErrors, durationMs, inputTokens, outputTokens,
      estimatedCostUsd: estimateCostUsd(run.modelId, inputTokens, outputTokens),
      completedAt: Date.now(),
    });
    return null;
  },
});

// Prompt text is never stored and never returned. What an editor may see is that
// a model ran, which one, whether it worked, and what it cost.
const vSafeModelRun = v.object({
  _id: v.id("modelRuns"),
  operation: V.vModelOperation,
  provider: v.string(),
  modelId: v.string(),
  promptVersion: v.string(),
  schemaVersion: v.string(),
  status: V.vModelRunStatus,
  attempt: v.number(),
  usedFallback: v.boolean(),
  fallbackReason: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  validationErrors: v.optional(v.array(v.string())),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const listForScan = query({
  args: { scanId: v.id("scans") },
  returns: v.array(vSafeModelRun),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return [];
    const runs = await ctx.db
      .query("modelRuns")
      .withIndex("by_scan_operation", (q) => q.eq("scanId", scanId))
      .collect();
    return runs.map((r) => ({
      _id: r._id, operation: r.operation, provider: r.provider, modelId: r.modelId,
      promptVersion: r.promptVersion, schemaVersion: r.schemaVersion, status: r.status,
      attempt: r.attempt, usedFallback: r.fallbackFromRunId !== undefined, fallbackReason: r.fallbackReason,
      durationMs: r.durationMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
      estimatedCostUsd: r.estimatedCostUsd, validationErrors: r.validationErrors,
      startedAt: r.startedAt, completedAt: r.completedAt,
    }));
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("modelRuns") },
  returns: v.union(v.null(), v.object({ status: V.vModelRunStatus, modelId: v.string(), attempt: v.number() })),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run ? { status: run.status, modelId: run.modelId, attempt: run.attempt } : null;
  },
});
