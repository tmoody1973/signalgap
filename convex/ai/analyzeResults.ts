import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import * as V from "../lib/validators";
import { SCHEMA_VERSION, analyzeResultsOutput, type AnalyzeResultsOutput } from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

/** Loads exactly the stored fields the model is allowed to see. No raw JSON, no key. */
export const loadInput = internalQuery({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.array(v.object({
    sourceResultId: v.id("sourceResults"),
    title: v.string(),
    snippet: v.string(),
    publisher: v.union(v.string(), v.null()),
    canonicalUrl: v.string(),
    originalLanguage: v.string(),
    sourceFamily: V.vSourceFamily,
    publishedAt: v.union(v.string(), v.null()),
    sourceType: V.vSourceType,
  })),
  handler: async (ctx, { scanId, sourceResultIds }) => {
    const rows = [];
    for (const id of sourceResultIds) {
      const row = await ctx.db.get(id);
      if (!row || row.scanId !== scanId) continue;
      rows.push({
        sourceResultId: row._id, title: row.title, snippet: row.snippet,
        publisher: row.publisher ?? null, canonicalUrl: row.canonicalUrl,
        originalLanguage: row.originalLanguage, sourceFamily: row.sourceFamily,
        publishedAt: row.publishedAt === undefined ? null : new Date(row.publishedAt).toISOString(),
        sourceType: row.sourceType,
      });
    }
    return rows;
  },
});

export const persistAnalysis = internalMutation({
  args: {
    items: v.array(v.object({
      sourceResultId: v.id("sourceResults"),
      translatedTitle: v.union(v.string(), v.null()),
      translatedSnippet: v.union(v.string(), v.null()),
      sourceTypeSuggestion: V.vSourceType,
    })),
  },
  returns: v.object({ translated: v.number(), typed: v.number() }),
  handler: async (ctx, { items }) => {
    let translated = 0;
    let typed = 0;
    for (const item of items) {
      const row = await ctx.db.get(item.sourceResultId);
      if (!row) continue;
      const patch: Record<string, unknown> = {};

      // Translation sits BESIDE the original. title and snippet are never touched —
      // a translated headline that replaced the real one would quietly change what
      // a citation says.
      if (item.translatedTitle) patch.translatedTitle = item.translatedTitle;
      if (item.translatedSnippet) patch.translatedSnippet = item.translatedSnippet;
      if (patch.translatedTitle || patch.translatedSnippet) translated++;

      // A model may fill in what ingest could not work out. It may NOT overwrite
      // what ingest already knew deterministically (official -> primary,
      // r/milwaukee -> discussion).
      if (row.sourceType === "unknown" && item.sourceTypeSuggestion !== "unknown") {
        patch.sourceType = item.sourceTypeSuggestion;
        typed++;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(item.sourceResultId, patch);
    }
    return { translated, typed };
  },
});

export type AnalyzeArgs = { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] };
export type AnalyzeOutcome =
  | { ok: true; analysis: AnalyzeResultsOutput; modelRunId: Id<"modelRuns">; translated: number; typed: number }
  | { ok: false; reason: string; errors: string[] };

// Extracted from the internalAction so tests can inject a fake model. Convex
// validates action args before the handler runs, so a function value can never
// travel through `args` (learned the hard way in the SerpApi layer).
export async function runAnalyzeResults(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: AnalyzeArgs,
  generate?: GenerateFn,
): Promise<AnalyzeOutcome> {
  const sources = await ctx.runQuery(internal.ai.analyzeResults.loadInput, { scanId, sourceResultIds });
  if (sources.length === 0) return { ok: false, reason: "no_sources", errors: ["no readable sources for this scan"] };

  // sourceType is loaded so persistAnalysis can tell "the rules already decided"
  // from "nobody knows yet". The model is not shown it — a suggestion should not
  // be anchored by the guess we already made.
  const input = { sources: sources.map((s) => ({
    sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
    publisher: s.publisher, canonicalUrl: s.canonicalUrl,
    originalLanguage: s.originalLanguage, sourceFamily: s.sourceFamily, publishedAt: s.publishedAt,
  })) };

  const result = await runAiOperation<AnalyzeResultsOutput>(ctx, {
    scanId, operation: "analyzeResults", input,
    outputSchema: analyzeResultsOutput, schemaVersion: SCHEMA_VERSION,
    validation: {
      knownSourceIds: sources.map((s) => s.sourceResultId),
      // A quotation must match the title or snippet we stored, exactly.
      excerptsBySourceId: Object.fromEntries(sources.map((s) => [s.sourceResultId, [s.title, s.snippet]])),
    },
    generate,
  });
  if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };

  const { translated, typed } = await ctx.runMutation(internal.ai.analyzeResults.persistAnalysis, {
    items: result.value.items.map((i) => ({
      sourceResultId: i.sourceResultId as Id<"sourceResults">,
      translatedTitle: i.translatedTitle,
      translatedSnippet: i.translatedSnippet,
      sourceTypeSuggestion: i.sourceTypeSuggestion,
    })),
  });

  return { ok: true, analysis: result.value, modelRunId: result.modelRunId, translated, typed };
}

export const analyze = internalAction({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.union(
    v.object({ ok: v.literal(true), modelRunId: v.id("modelRuns"), translated: v.number(), typed: v.number() }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const outcome = await runAnalyzeResults(ctx, args);
    return outcome.ok
      ? { ok: true as const, modelRunId: outcome.modelRunId, translated: outcome.translated, typed: outcome.typed }
      : { ok: false as const, reason: outcome.reason, errors: outcome.errors };
  },
});
