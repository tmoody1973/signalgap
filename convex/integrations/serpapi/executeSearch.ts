import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction, internalQuery } from "../../_generated/server";
import * as V from "../../lib/validators";
import { buildParams, callSerpApi } from "./client";
import { normalizeResponse } from "./normalize";

const vSearchSpec = v.object({
  templateId: v.string(),
  engine: V.vEngine,
  purpose: V.vPurpose,
  query: v.string(),
  location: v.literal("Milwaukee, Wisconsin, United States"),
  language: v.union(v.literal("en"), v.literal("es")),
  timeWindow: v.union(v.literal("7d"), v.literal("30d"), v.literal("current")),
  candidateId: v.optional(v.id("candidates")),
});

const vExecuteSearchResult = v.object({
  runId: v.optional(v.id("searchRuns")),
  status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("skipped")),
  resultCount: v.number(),
});

// Internal-only lookup so executeSearch can check whether a reused run already
// finished, without going through searchRuns.listForScan (which requires a
// browser identity this internal action does not have).
export const getRun = internalQuery({
  args: { runId: v.id("searchRuns") },
  returns: v.union(v.null(), v.object({ status: V.vSearchRunStatus, resultCount: v.number() })),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run ? { status: run.status, resultCount: run.resultCount } : null;
  },
});

type ExecuteSearchResult = { runId?: Id<"searchRuns">; status: "succeeded" | "failed" | "skipped"; resultCount: number };

export const executeSearch = internalAction({
  args: { scanId: v.id("scans"), spec: vSearchSpec },
  returns: vExecuteSearchResult,
  handler: async (ctx, { scanId, spec }): Promise<ExecuteSearchResult> => {
    const reserved = await ctx.runMutation(internal.searchRuns.reserve, { scanId, spec });
    if ("rejected" in reserved) return { status: "skipped" as const, resultCount: 0 };

    const { runId, reused } = reserved;
    if (reused) {
      const existing = await ctx.runQuery(internal.integrations.serpapi.executeSearch.getRun, { runId });
      if (existing?.status === "succeeded") return { runId, status: "succeeded" as const, resultCount: existing.resultCount };
    }

    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) throw new Error("SERPAPI_API_KEY is not configured");

    await ctx.runMutation(internal.searchRuns.markRunning, { runId, parameters: buildParams(spec) });

    const result = await callSerpApi(spec, { apiKey });
    if (!result.ok) {
      await ctx.runMutation(internal.searchRuns.fail, {
        runId, errorCode: result.errorCode, errorMessage: result.errorMessage, durationMs: result.durationMs,
      });
      return { runId, status: "failed" as const, resultCount: 0 };
    }

    const rawStorageId: Id<"_storage"> = await ctx.storage.store(
      new Blob([JSON.stringify(result.json)], { type: "application/json" }),
    );
    const { results } = normalizeResponse(spec, result.json);
    const { inserted } = await ctx.runMutation(internal.sourceResults.ingest, { scanId, searchRunId: runId, results });

    await ctx.runMutation(internal.searchRuns.complete, {
      runId, resultCount: inserted, durationMs: result.durationMs, rawStorageId,
    });
    return { runId, status: "succeeded" as const, resultCount: inserted };
  },
});
