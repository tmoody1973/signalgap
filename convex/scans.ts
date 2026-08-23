import { cancel as cancelWorkflow, getStatus, start, type WorkflowId } from "@convex-dev/workflow";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
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
