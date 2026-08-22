import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { internalAction } from "../../_generated/server";
import { vSearchSpec } from "../../searchRuns";
import { callSerpApi, buildParams } from "./client";
import { normalizeResponse } from "./normalize";

// 60s SerpApi timeout + two backoffs (~2s, ~8s) is ~80s worst case for one
// attempt to go from "running" to terminal; 5 minutes gives ample margin
// before we treat a "running" row as abandoned (e.g. by a crashed action)
// rather than in flight.
const STALE_RUNNING_MS = 5 * 60_000;

const vExecuteSearchResult = v.object({
  runId: v.optional(v.id("searchRuns")),
  status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("skipped")),
  resultCount: v.number(),
});
type ExecuteSearchResult = Infer<typeof vExecuteSearchResult>;
type ExecuteSearchArgs = { scanId: Id<"scans">; spec: Infer<typeof vSearchSpec> };
type ExecuteSearchOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

// Extracted from the internalAction wrapper so tests can call it directly with
// fetchImpl/sleep injected — Convex validates action args before the handler
// runs, so a function value (a sleep override) can never travel through the
// action's own `args`. `t.action` from convex-test accepts a raw
// `(ctx) => Promise<...>` closure, which is how tests reach this.
export async function runExecuteSearch(
  ctx: ActionCtx,
  { scanId, spec }: ExecuteSearchArgs,
  options: ExecuteSearchOptions = {},
): Promise<ExecuteSearchResult> {
  const reserved = await ctx.runMutation(internal.searchRuns.reserve, { scanId, spec });
  if ("rejected" in reserved) return { status: "skipped", resultCount: 0 };

  const { runId, reused } = reserved;
  if (reused) {
    const existing = await ctx.runQuery(internal.searchRuns.getRun, { runId });
    if (existing?.status === "succeeded") return { runId, status: "skipped", resultCount: existing.resultCount };
    if (existing?.status === "running" && Date.now() - existing.reservedAt < STALE_RUNNING_MS) {
      return { runId, status: "skipped", resultCount: 0 };
    }
    // Otherwise: failed, or running-but-stale (likely abandoned by a crash) — fall through and retry.
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not configured");

  const marked = await ctx.runMutation(internal.searchRuns.markRunning, { runId, parameters: buildParams(spec) });
  if (marked) return { runId, status: "skipped", resultCount: 0 };

  const result = await callSerpApi(spec, { apiKey, ...options });
  if (!result.ok) {
    await ctx.runMutation(internal.searchRuns.fail, {
      runId, errorCode: result.errorCode, errorMessage: result.errorMessage, durationMs: result.durationMs,
    });
    return { runId, status: "failed", resultCount: 0 };
  }

  // A paid call already succeeded at this point — any throw below (write conflict,
  // validator mismatch, storage RPC failure) must still land the run in a terminal
  // state, or it's stuck "running" forever with the scan never able to finish truthfully.
  try {
    const rawStorageId: Id<"_storage"> = await ctx.storage.store(
      new Blob([JSON.stringify(result.json)], { type: "application/json" }),
    );
    const { results } = normalizeResponse(spec, result.json);
    const { inserted } = await ctx.runMutation(internal.sourceResults.ingest, { scanId, searchRunId: runId, results });

    await ctx.runMutation(internal.searchRuns.complete, {
      runId, resultCount: inserted, durationMs: result.durationMs, rawStorageId,
    });
    return { runId, status: "succeeded", resultCount: inserted };
  } catch (error) {
    await ctx.runMutation(internal.searchRuns.fail, {
      runId, errorCode: "ingest_failed",
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 400),
      durationMs: result.durationMs,
    });
    return { runId, status: "failed", resultCount: 0 };
  }
}

export const executeSearch = internalAction({
  args: { scanId: v.id("scans"), spec: vSearchSpec },
  returns: vExecuteSearchResult,
  handler: (ctx, args) => runExecuteSearch(ctx, args),
});
