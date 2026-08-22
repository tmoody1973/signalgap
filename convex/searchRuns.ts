import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
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
