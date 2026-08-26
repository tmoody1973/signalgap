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
    /** The run that produced these items, stored so the extraction is traceable. */
    modelRunId: v.id("modelRuns"),
    items: v.array(v.object({
      sourceResultId: v.id("sourceResults"),
      translatedTitle: v.union(v.string(), v.null()),
      translatedSnippet: v.union(v.string(), v.null()),
      sourceTypeSuggestion: V.vSourceType,
      analysis: v.object({
        entityKeys: v.array(v.string()),
        claimSummary: v.string(),
        claims: v.array(v.object({ text: v.string(), exactExcerpt: v.union(v.string(), v.null()) })),
        dates: v.array(v.string()),
      }),
    })),
  },
  returns: v.object({ translated: v.number(), typed: v.number() }),
  handler: async (ctx, { items, modelRunId }) => {
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

      // The extraction we already paid for. Replaced wholesale, never merged —
      // a second analysis of the same row must not leave two competing entity
      // lists behind. It sits in its own field, so it can never reach `title`,
      // `snippet` or `sourceType` above.
      patch.analysis = {
        ...item.analysis,
        claims: item.analysis.claims.map((c) => ({
          text: c.text,
          ...(c.exactExcerpt === null ? {} : { exactExcerpt: c.exactExcerpt }),
        })),
        modelRunId,
      };

      if (Object.keys(patch).length > 0) await ctx.db.patch(item.sourceResultId, patch);
    }
    return { translated, typed };
  },
});

/**
 * The half of an analysed item worth keeping.
 *
 * `entities` arrives split five ways; every consumer wants one flat key list, so
 * it is flattened and deduplicated once, here. `claimSummary` is the first claim
 * with the model's `reason` as the fallback — the same rule the measurement used
 * to produce the three correct merges in task-1-report.md.
 *
 * Deliberately dropped: `detectedLanguage` (the row already carries
 * `originalLanguage` from ingest), `originalTitle`/`originalSnippet` (the row
 * already holds the verbatim text; storing the model's echo of it invites
 * disagreement about which one is true) and `potentialHumanSources`
 * (`classifyEvidence` already emits source-bound `potential_source` evidence,
 * which is what the brief reads).
 */
function toStoredAnalysis(item: AnalyzeResultsOutput["items"][number]) {
  const { people, organizations, streets, neighborhoods, agencies } = item.entities;
  const keys = [...people, ...organizations, ...streets, ...neighborhoods, ...agencies]
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return {
    entityKeys: [...new Set(keys)],
    claimSummary: item.claims[0]?.text ?? item.reason,
    claims: item.claims,
    dates: item.dates,
  };
}

/**
 * Measured on the real 294 sources of scan k1781cvj03wmdd2bgz4ks2rzbh8d4ze8
 * (see task-1-report.md), against `TIMEOUT_MS = 120_000` in provider.ts:
 *
 *   |  5 |  33.5 s | ok                                                 |
 *   | 10 |  55.7 s | ok — 2.2x headroom                                 |
 *   | 25 | 195.5 s | validates, but 1.6x OVER the timeout               |
 *   | 50 |  FAILED | HTTP/2 "stream timeout after 300000" — transport    |
 *
 * Ten is the largest size that finishes with real headroom on a slow day, and
 * the batch time does not move when a different news day returns 150 or 400
 * sources — only the number of batches does.
 */
export const ANALYZE_BATCH_SIZE = 10;

/**
 * Four at a time.
 *
 * Serial would be 30 x 55.7 s = 28 minutes, which brushes the 30-minute Convex
 * action limit. Unbounded would fire 30 concurrent requests at one API key and
 * invite 429s, which `classifyError` treats as transient and retries — turning a
 * rate limit into three times the spend. Four puts a 294-source scan at roughly
 * 7 minutes (30 / 4 x 55.7 s, derived) and keeps cancellation responsive: the
 * most work a cancelling editor can still pay for is four in-flight batches.
 */
export const ANALYZE_CONCURRENCY = 4;

export type AnalyzeArgs = { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[] };

export type AnalyzeBatchFailure = { batchIndex: number; reason: string; errors: string[] };

/**
 * Partial success is a REAL outcome, so this is one flat shape rather than a
 * success/failure union: a scan where 28 of 30 batches landed has both persisted
 * items and recorded failures, and a union would force one of them to be a lie.
 *
 * `ok` is true only when every batch succeeded. `reason`/`errors` mirror the
 * FIRST failure so a single-batch caller reads exactly as it did before.
 */
export type AnalyzeOutcome = {
  ok: boolean;
  batches: number;
  failures: AnalyzeBatchFailure[];
  reason: string | null;
  errors: string[];
  /** Every item that validated and was persisted, in the order sources were supplied. */
  items: AnalyzeResultsOutput["items"];
  /** One per batch that reached the model. The ledger equals what ran. */
  modelRunIds: Id<"modelRuns">[];
  translated: number;
  typed: number;
  canceled: boolean;
};

type LoadedSource = Awaited<ReturnType<typeof loadSourcesFor>>[number];
type LoadSourcesResult = Awaited<ReturnType<typeof loadSourcesFor>>;
async function loadSourcesFor(ctx: ActionCtx, args: AnalyzeArgs) {
  return await ctx.runQuery(internal.ai.analyzeResults.loadInput, args);
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

const emptyOutcome = (over: Partial<AnalyzeOutcome>): AnalyzeOutcome => ({
  ok: false, batches: 0, failures: [], reason: null, errors: [],
  items: [], modelRunIds: [], translated: 0, typed: 0, canceled: false, ...over,
});

// Extracted from the internalAction so tests can inject a fake model. Convex
// validates action args before the handler runs, so a function value can never
// travel through `args` (learned the hard way in the SerpApi layer).
export async function runAnalyzeResults(
  ctx: ActionCtx,
  { scanId, sourceResultIds }: AnalyzeArgs,
  generate?: GenerateFn,
  /** Re-checked before every batch. An editor who cancels stops paying immediately. */
  shouldContinue?: () => Promise<boolean>,
): Promise<AnalyzeOutcome> {
  const sources: LoadSourcesResult = await loadSourcesFor(ctx, { scanId, sourceResultIds });
  if (sources.length === 0) {
    return emptyOutcome({ reason: "no_sources", errors: ["no readable sources for this scan"] });
  }

  // One call for 294 sources is 27-38 minutes of output against a 120 s timeout.
  // It is not a big request; it is thirty requests wearing a trenchcoat.
  const batches = chunk(sources, ANALYZE_BATCH_SIZE);
  const results: Array<
    | { ok: true; items: AnalyzeResultsOutput["items"]; modelRunId: Id<"modelRuns">; translated: number; typed: number }
    | { ok: false; failure: AnalyzeBatchFailure }
    | undefined
  > = new Array(batches.length).fill(undefined);

  let canceled = false;

  const runBatch = async (batchIndex: number) => {
    const batch = batches[batchIndex];

    // sourceType is loaded so persistAnalysis can tell "the rules already decided"
    // from "nobody knows yet". The model is not shown it — a suggestion should not
    // be anchored by the guess we already made.
    const input = { sources: batch.map((s: LoadedSource) => ({
      sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
      publisher: s.publisher, canonicalUrl: s.canonicalUrl,
      originalLanguage: s.originalLanguage, sourceFamily: s.sourceFamily, publishedAt: s.publishedAt,
    })) };

    // Straight THROUGH runAiOperation, never around it: it owns the retry loop,
    // the schema-invalid rule and the ledger row. Each batch is its own call, so
    // each gets its own row — the input snapshot hash covers exactly the sources
    // that batch carried, and no row ever claims to cover the whole scan.
    const result = await runAiOperation<AnalyzeResultsOutput>(ctx, {
      scanId, operation: "analyzeResults", input,
      outputSchema: analyzeResultsOutput, schemaVersion: SCHEMA_VERSION,
      validation: {
        // Scoped to THIS batch: a model may not cite a source it was not shown.
        knownSourceIds: batch.map((s: LoadedSource) => s.sourceResultId),
        // A quotation must match the title or snippet we stored, exactly.
        excerptsBySourceId: Object.fromEntries(batch.map((s: LoadedSource) => [s.sourceResultId, [s.title, s.snippet]])),
      },
      generate,
    });

    if (!result.ok) {
      results[batchIndex] = { ok: false, failure: { batchIndex, reason: result.reason, errors: result.errors } };
      return;
    }

    const { translated, typed } = await ctx.runMutation(internal.ai.analyzeResults.persistAnalysis, {
      modelRunId: result.modelRunId,
      items: result.value.items.map((i) => ({
        sourceResultId: i.sourceResultId as Id<"sourceResults">,
        translatedTitle: i.translatedTitle,
        translatedSnippet: i.translatedSnippet,
        sourceTypeSuggestion: i.sourceTypeSuggestion,
        analysis: toStoredAnalysis(i),
      })),
    });

    results[batchIndex] = { ok: true, items: result.value.items, modelRunId: result.modelRunId, translated, typed };
  };

  // A worker pool, not Promise.all: the cancel check has to sit BETWEEN batches,
  // and an unbounded fan-out has nowhere to put it.
  let nextBatch = 0;
  const worker = async () => {
    for (;;) {
      if (shouldContinue && !(await shouldContinue())) {
        canceled = true;
        return;
      }
      const batchIndex = nextBatch++;
      if (batchIndex >= batches.length) return;
      await runBatch(batchIndex);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ANALYZE_CONCURRENCY, batches.length) }, () => worker()),
  );

  // Rebuilt in batch order, so N sources come back as N items in the order they
  // were supplied no matter which worker finished first.
  const done = results.filter((r) => r !== undefined);
  const failures = done.filter((r) => !r.ok).map((r) => r.failure);
  const succeeded = done.filter((r) => r.ok);

  return {
    ok: failures.length === 0 && succeeded.length > 0,
    batches: batches.length,
    failures,
    reason: failures[0]?.reason ?? null,
    errors: failures[0]?.errors ?? [],
    items: succeeded.flatMap((r) => r.items),
    modelRunIds: succeeded.map((r) => r.modelRunId),
    translated: succeeded.reduce((n, r) => n + r.translated, 0),
    typed: succeeded.reduce((n, r) => n + r.typed, 0),
    canceled,
  };
}

export const analyze = internalAction({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.object({
    ok: v.boolean(),
    batches: v.number(),
    // One id per batch that reached the model, so the ledger can be reconciled
    // against what actually ran rather than against one summary row.
    modelRunIds: v.array(v.id("modelRuns")),
    failures: v.array(v.object({
      batchIndex: v.number(), reason: v.string(), errors: v.array(v.string()),
    })),
    translated: v.number(),
    typed: v.number(),
    canceled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { ok, batches, modelRunIds, failures, translated, typed, canceled } = await runAnalyzeResults(ctx, args);
    return { ok, batches, modelRunIds, failures, translated, typed, canceled };
  },
});
