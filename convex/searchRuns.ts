import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { QUERY_CATALOG_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { idempotencyKeyFor } from "./integrations/serpapi/contracts";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const vSafeSearchRun = v.object({
  _id: v.id("searchRuns"),
  templateId: v.string(),
  purpose: V.vPurpose,
  engine: V.vEngine,
  query: v.string(),
  language: V.vLanguage,
  status: V.vSearchRunStatus,
  attemptCount: v.number(),
  resultCount: v.number(),
  durationMs: v.number(),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  reservedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const vSafeSearchRunPage = v.object({ page: v.array(vSafeSearchRun), isDone: v.boolean(), continueCursor: v.string() });

export const listForScan = query({
  args: { scanId: v.id("scans"), paginationOpts: paginationOptsValidator },
  returns: vSafeSearchRunPage,
  handler: async (ctx, { scanId, paginationOpts }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).paginate(paginationOpts);
    return {
      page: result.page.map((r) => ({
        _id: r._id, templateId: r.templateId, purpose: r.purpose, engine: r.engine, query: r.query, language: r.language,
        status: r.status, attemptCount: r.attemptCount, resultCount: r.resultCount, durationMs: r.durationMs,
        errorCode: r.errorCode, errorMessage: r.errorMessage, reservedAt: r.reservedAt, completedAt: r.completedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const vSearchSpec = v.object({
  templateId: v.string(),
  engine: V.vEngine,
  purpose: V.vPurpose,
  query: v.string(),
  location: v.literal("Milwaukee, Wisconsin, United States"),
  language: v.union(v.literal("en"), v.literal("es")),
  timeWindow: v.union(v.literal("7d"), v.literal("30d"), v.literal("current")),
  candidateId: v.optional(v.id("candidates")),
});

export const reserve = internalMutation({
  args: { scanId: v.id("scans"), spec: vSearchSpec },
  returns: v.union(
    v.object({ runId: v.id("searchRuns"), reused: v.boolean() }),
    v.object({ rejected: v.union(v.literal("budget_exhausted"), v.literal("scan_not_active")) }),
  ),
  handler: async (ctx, { scanId, spec }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return { rejected: "scan_not_active" as const };
    if (scan.cancelRequestedAt !== undefined) return { rejected: "scan_not_active" as const };
    if (scan.status !== "queued" && scan.status !== "running") return { rejected: "scan_not_active" as const };

    const idempotencyKey = idempotencyKeyFor(scanId, spec);
    const existing = await ctx.db
      .query("searchRuns")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { runId: existing._id, reused: true };

    // Convex mutations are serializable transactions, so this read-then-write
    // is atomic against concurrent reservations — that is what makes the cap hold.
    if (scan.searchesReserved >= Math.min(scan.searchBudgetLimit, SEARCH_BUDGET.hardCap)) {
      return { rejected: "budget_exhausted" as const };
    }
    await ctx.db.patch(scanId, { searchesReserved: scan.searchesReserved + 1 });

    const runId = await ctx.db.insert("searchRuns", {
      scanId, ownerId: scan.ownerId, idempotencyKey,
      templateId: spec.templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
      purpose: spec.purpose, engine: spec.engine, query: spec.query,
      parameters: {}, language: spec.language,
      status: "reserved", attemptCount: 0, resultCount: 0, durationMs: 0,
      reservedAt: Date.now(), candidateId: spec.candidateId,
    });
    return { runId, reused: false };
  },
});

export const markRunning = internalMutation({
  args: { runId: v.id("searchRuns"), parameters: v.record(v.string(), v.string()) },
  returns: v.null(),
  handler: async (ctx, { runId, parameters }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    // Idempotent: a run already running or terminal is left untouched (Ruling 8).
    if (run.status !== "reserved" && run.status !== "running") return null;
    // The API key is appended inside the client and is never part of `parameters`.
    await ctx.db.patch(runId, { status: "running", attemptCount: run.attemptCount + 1, parameters });
    return null;
  },
});

export const complete = internalMutation({
  args: { runId: v.id("searchRuns"), resultCount: v.number(), durationMs: v.number(), rawStorageId: v.optional(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { runId, resultCount, durationMs, rawStorageId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    // Idempotent: a run already succeeded or failed does not touch scan counters again (Ruling 8).
    if (run.status !== "reserved" && run.status !== "running") return null;
    await ctx.db.patch(runId, { status: "succeeded", resultCount, durationMs, rawStorageId, completedAt: Date.now() });
    const scan = await ctx.db.get(run.scanId);
    if (scan) await ctx.db.patch(run.scanId, { searchesSucceeded: scan.searchesSucceeded + 1 });
    return null;
  },
});

// Internal-only lookup so executeSearch can check whether a reused run already
// finished (or is still fresh), without going through the owner-gated listForScan
// query — this internal action has no browser identity to satisfy requireUser.
export const getRun = internalQuery({
  args: { runId: v.id("searchRuns") },
  returns: v.union(v.null(), v.object({ status: V.vSearchRunStatus, resultCount: v.number(), reservedAt: v.number() })),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run ? { status: run.status, resultCount: run.resultCount, reservedAt: run.reservedAt } : null;
  },
});

export const fail = internalMutation({
  args: { runId: v.id("searchRuns"), errorCode: v.string(), errorMessage: v.string(), durationMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { runId, errorCode, errorMessage, durationMs }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    // Idempotent: a run already succeeded or failed does not touch scan counters again (Ruling 8).
    if (run.status !== "reserved" && run.status !== "running") return null;
    await ctx.db.patch(runId, { status: "failed", errorCode, errorMessage, durationMs, completedAt: Date.now() });
    const scan = await ctx.db.get(run.scanId);
    if (scan) await ctx.db.patch(run.scanId, { searchesFailed: scan.searchesFailed + 1 });
    return null;
  },
});
