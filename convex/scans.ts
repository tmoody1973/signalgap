import { cancel as cancelWorkflow, getStatus, start, type WorkflowId } from "@convex-dev/workflow";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { MARKET_KEY, QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const vScanSummary = v.object({
  _id: v.id("scans"),
  status: V.vScanStatus,
  stage: V.vStage,
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  cancelRequestedAt: v.optional(v.number()),
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
});

const toSummary = (s: Doc<"scans">) => ({
  _id: s._id, status: s.status, stage: s.stage, startedAt: s.startedAt, completedAt: s.completedAt,
  cancelRequestedAt: s.cancelRequestedAt, searchBudgetLimit: s.searchBudgetLimit, searchesReserved: s.searchesReserved,
  searchesSucceeded: s.searchesSucceeded, searchesFailed: s.searchesFailed, eligibleCount: s.eligibleCount,
  excludedCount: s.excludedCount, processingCount: s.processingCount, failureSummaries: s.failureSummaries,
  isSavedDemo: s.isSavedDemo, captureTimestamp: s.captureTimestamp,
});

export const startScan = mutation({
  args: {},
  returns: v.id("scans"),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    for (const status of ["queued", "running"] as const) {
      const active = await ctx.db.query("scans").withIndex("by_owner_status", (q) => q.eq("ownerId", user._id).eq("status", status)).first();
      if (active) throw new Error("A scan is already running");
    }
    const scanId = await ctx.db.insert("scans", {
      ownerId: user._id,
      marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION,
      queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "queued",
      stage: "discovery",
      startedAt: Date.now(),
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [],
      isSavedDemo: false,
    });

    // Started INSIDE the same transaction as the insert. Either both happen or
    // neither does, so there is no window where a queued scan exists with
    // nothing executing it.
    const workflowId = await start(ctx, internal.scanWorkflow.runScan, { scanId });
    await ctx.db.patch(scanId, { workflowId });
    return scanId;
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), vScanSummary),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return null;
    return toSummary(scan);
  },
});

const vScanSummaryPage = v.object({ page: v.array(vScanSummary), isDone: v.boolean(), continueCursor: v.string() });

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: vScanSummaryPage,
  handler: async (ctx, { paginationOpts }) => {
    const user = await requireUser(ctx);
    const result = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).order("desc").paginate(paginationOpts);
    return { page: result.page.map(toSummary), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const cancel = mutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) throw new Error("Scan not found");
    if (scan.status === "completed" || scan.status === "partial" || scan.status === "canceled") return null;

    // The flag is what every step checks before spending money. Cancelling the
    // workflow stops future steps; it cannot abort an HTTP request already in
    // flight, and the spec is explicit that we do not pretend otherwise.
    await ctx.db.patch(scanId, { cancelRequestedAt: Date.now() });
    if (scan.workflowId) {
      const workflowId = scan.workflowId as WorkflowId;
      // The component's cancel throws if the workflow already finished
      // (success, failure, or a prior cancel) — there is nothing left to
      // stop, so that is not an error for the caller.
      const status = await getStatus(ctx, components.workflow, workflowId);
      if (status.type === "inProgress") await cancelWorkflow(ctx, components.workflow, workflowId);
    }
    // A cancelled workflow's handler never runs again, so it will never reach
    // its own finalize call. Without this, the scan would sit queued/running
    // forever and startScan's duplicate-scan guard would lock the owner out
    // of starting another one.
    await finalizeScan(ctx, scanId);
    return null;
  },
});

export const attachWorkflow = internalMutation({
  args: { scanId: v.id("scans"), workflowId: v.string() },
  returns: v.null(),
  handler: async (ctx, { scanId, workflowId }) => {
    await ctx.db.patch(scanId, { workflowId });
    return null;
  },
});

export const setStage = internalMutation({
  args: { scanId: v.id("scans"), stage: V.vStage },
  returns: v.null(),
  handler: async (ctx, { scanId, stage }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    // A terminal scan's stage is history. Nothing may move it.
    if (scan.status !== "queued" && scan.status !== "running") return null;
    await ctx.db.patch(scanId, { stage, status: "running" });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: { scanId: v.id("scans"), purpose: V.vPurpose, code: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { scanId, purpose, code, message }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    // Deduplicated by purpose+code: twenty rate-limited coverage calls are one
    // thing an editor needs told, not twenty.
    if (scan.failureSummaries.some((f) => f.purpose === purpose && f.code === code)) return null;
    await ctx.db.patch(scanId, {
      failureSummaries: [...scan.failureSummaries, { purpose, code, message: message.slice(0, 400) }],
    });
    return null;
  },
});

export const recordSearchOutcome = internalMutation({
  args: { scanId: v.id("scans"), succeeded: v.number(), failed: v.number() },
  returns: v.null(),
  handler: async (ctx, { scanId, succeeded, failed }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    await ctx.db.patch(scanId, {
      searchesSucceeded: scan.searchesSucceeded + succeeded,
      searchesFailed: scan.searchesFailed + failed,
    });
    return null;
  },
});

export const setCandidateCounts = internalMutation({
  args: {
    scanId: v.id("scans"),
    eligibleCount: v.number(), excludedCount: v.number(), processingCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { scanId, eligibleCount, excludedCount, processingCount }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    await ctx.db.patch(scanId, { eligibleCount, excludedCount, processingCount });
    return null;
  },
});

/**
 * The one place a scan reaches a terminal state. Shared by `finalize` (called
 * by the workflow's own step list) and `cancel` (which must finalize itself,
 * because cancelling the workflow guarantees the workflow will never reach
 * its own finalize call).
 *
 * It DERIVES the status rather than accepting one. A caller that could pass
 * "completed" is a caller that could turn a cancelled scan into a successful
 * one, and the spec forbids that outright.
 */
async function finalizeScan(ctx: MutationCtx, scanId: Doc<"scans">["_id"]) {
  const scan = await ctx.db.get(scanId);
  if (!scan) throw new Error("Scan not found");
  // Already terminal. Say what it is and change nothing — a failure that
  // arrives late cannot rewrite a scan that already ended.
  if (scan.status !== "queued" && scan.status !== "running") return { status: scan.status };

  const status = scan.cancelRequestedAt !== undefined
    ? ("canceled" as const)
    : scan.failureSummaries.length > 0
      ? ("partial" as const)
      : ("completed" as const);

  await ctx.db.patch(scanId, { status, completedAt: Date.now() });
  return { status };
}

export const finalize = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.object({ status: V.vScanStatus }),
  handler: async (ctx, { scanId }) => finalizeScan(ctx, scanId),
});

const vWorkflowScan = v.object({
  scanId: v.id("scans"),
  ownerId: v.id("users"),
  isCancelRequested: v.boolean(),
  isActive: v.boolean(),
  searchesReserved: v.number(),
  searchBudgetLimit: v.number(),
  remaining: v.number(),
});

/**
 * What a step needs to decide whether to spend anything. Read before every
 * external boundary, per `spec.md > Cancellation and idempotency`.
 */
export const getForWorkflow = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), vWorkflowScan),
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return null;
    const limit = Math.min(scan.searchBudgetLimit, SEARCH_BUDGET.hardCap);
    return {
      scanId: scan._id,
      ownerId: scan.ownerId,
      isCancelRequested: scan.cancelRequestedAt !== undefined,
      isActive: scan.status === "queued" || scan.status === "running",
      searchesReserved: scan.searchesReserved,
      searchBudgetLimit: limit,
      remaining: Math.max(0, limit - scan.searchesReserved),
    };
  },
});
