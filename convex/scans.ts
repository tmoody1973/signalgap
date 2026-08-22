import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
    return ctx.db.insert("scans", {
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
    // ponytail: workflow.start lands in the item-8 plan; queued rows are enough to test ownership now.
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
    if (scan.status !== "queued" && scan.status !== "running") return null;
    const now = Date.now();
    await ctx.db.patch(scanId, scan.status === "queued"
      ? { cancelRequestedAt: now, status: "canceled", completedAt: now }
      : { cancelRequestedAt: now });
    return null;
  },
});
