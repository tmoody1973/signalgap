/**
 * Task 3's real end-to-end proof: does the BATCHED, STREAMED, effort:low
 * analyzeResults path actually fit inside `TIMEOUT_MS = 120_000`?
 *
 *   npx tsx scripts/measure-analyze-batching.ts            # control + 6 batches
 *   npx tsx scripts/measure-analyze-batching.ts --only=control
 *
 * Fidelity is the point, and it is higher than scripts/measure-ai-payload.ts's:
 * that script re-implements the provider call, this one IMPORTS the production
 * `streamStructuredObject` from convex/ai/provider.ts. Same prompt builder, same
 * zod schema, same 120 s abort production uses. The only differences from a real
 * scan are named here:
 *   1. Sources come from the cached `.eval-runs/measure/sources.json` (the 294
 *      real rows of scan k1781cvj03wmdd2bgz4ks2rzbh8d4ze8), not a live query.
 *   2. Nothing is written to Convex. No modelRuns row, no persistAnalysis.
 *
 * PAID CALLS. Every model call in here costs real money on a real account.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeResultsOutput } from "../convex/ai/contracts";
import { estimateCostUsd } from "../convex/ai/pricing";
import { buildPrompt } from "../convex/ai/prompts";
import { streamStructuredObject } from "../convex/ai/provider";
import { ANALYZE_BATCH_SIZE, ANALYZE_CONCURRENCY } from "../convex/ai/analyzeResults";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const SOURCES_TO_ANALYZE = Number(process.argv.find((a) => a.startsWith("--n="))?.slice("--n=".length) ?? 60);

/** The production abort. If a batch does not fit inside this, that IS the finding. */
const TIMEOUT_MS = 120_000;

const RUN_DIR = join(process.cwd(), ".eval-runs/measure");
mkdirSync(RUN_DIR, { recursive: true });

function primaryModel(): string {
  if (process.env.AI_PRIMARY_MODEL) return process.env.AI_PRIMARY_MODEL;
  return execFileSync("npx", ["convex", "env", "get", "AI_PRIMARY_MODEL"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
const MODEL_ID = primaryModel();

type SourceRow = {
  sourceResultId: string; title: string; snippet: string; publisher: string | null;
  canonicalUrl: string; originalLanguage: string; sourceFamily: string;
  publishedAt: string | null; sourceType: string;
};

const sources = JSON.parse(readFileSync(join(RUN_DIR, "sources.json"), "utf8")) as SourceRow[];

// Exactly convex/ai/analyzeResults.ts's per-batch input.
const toAnalyzeInput = (rows: SourceRow[]) => ({
  sources: rows.map((s) => ({
    sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
    publisher: s.publisher, canonicalUrl: s.canonicalUrl,
    originalLanguage: s.originalLanguage, sourceFamily: s.sourceFamily, publishedAt: s.publishedAt,
  })),
});

type Row = {
  label: string; n: number; ok: boolean; ms: number;
  inputTokens?: number; outputTokens?: number; costUsd?: number; items?: number; error?: string;
};
const rows: Row[] = [];

async function runBatch(label: string, batch: SourceRow[]): Promise<Row> {
  const { system, prompt } = buildPrompt("analyzeResults", toAnalyzeInput(batch));
  const startedAt = Date.now();
  try {
    const res = await streamStructuredObject(anthropic(MODEL_ID), {
      system, prompt, schema: analyzeResultsOutput, abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - startedAt;
    // The REAL schema says whether it validated, not the SDK's word for it.
    const parsed = analyzeResultsOutput.safeParse(res.object);
    const row: Row = {
      label, n: batch.length, ok: parsed.success, ms,
      inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens,
      costUsd: estimateCostUsd(MODEL_ID, res.usage.inputTokens, res.usage.outputTokens),
      items: parsed.success ? parsed.data.items.length : undefined,
      error: parsed.success ? undefined : parsed.error.issues.map((i) => i.message).join("; "),
    };
    if (parsed.success) writeFileSync(join(RUN_DIR, `${label}-low.json`), JSON.stringify(parsed.data, null, 2));
    return row;
  } catch (error) {
    return {
      label, n: batch.length, ok: false, ms: Date.now() - startedAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function report(row: Row) {
  rows.push(row);
  writeFileSync(join(RUN_DIR, "batching-results.json"), JSON.stringify(rows, null, 2));
  console.log(
    `${row.label}\tn=${row.n}\t${(row.ms / 1000).toFixed(1)}s\t` +
    (row.ok ? `in=${row.inputTokens} out=${row.outputTokens} items=${row.items} $${row.costUsd?.toFixed(4)}` : `FAILED ${row.error}`),
  );
}

async function main() {
  console.log(`model=${MODEL_ID} batchSize=${ANALYZE_BATCH_SIZE} concurrency=${ANALYZE_CONCURRENCY} timeout=${TIMEOUT_MS}ms`);
  console.log(`${sources.length} cached real sources\n`);

  // --- Control: the EXACT slice task-1-report.md measured as "analyze-10"
  // (sources[5:15], 55.7 s, 4,215 in, 6,028 out, generateObject, thinking
  // adaptive). Same slice, same schema, same model — the only differences are
  // streaming and effort:low. Anything else would not be a before/after.
  console.log("--- control: the analyze-10 slice, now streamed at effort:low");
  report(await runBatch("stream-low-10", sources.slice(5, 15)));
  if (ONLY === "control") return;

  // --- The batched path over a realistic slice, at the real concurrency.
  const slice = sources.slice(0, SOURCES_TO_ANALYZE);
  const batches: SourceRow[][] = [];
  for (let i = 0; i < slice.length; i += ANALYZE_BATCH_SIZE) batches.push(slice.slice(i, i + ANALYZE_BATCH_SIZE));
  console.log(`\n--- batched: ${slice.length} sources -> ${batches.length} batches of <=${ANALYZE_BATCH_SIZE}, ${ANALYZE_CONCURRENCY} at a time`);

  const results: Row[] = new Array(batches.length);
  let next = 0;
  const startedAt = Date.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= batches.length) return;
      const row = await runBatch(`batch-${i}`, batches[i]);
      results[i] = row;
      report(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ANALYZE_CONCURRENCY, batches.length) }, () => worker()));
  const wallClock = Date.now() - startedAt;

  const ids = new Set(slice.map((s) => s.sourceResultId));
  const okRows = results.filter((r) => r.ok);
  const items = okRows.reduce((n, r) => n + (r.items ?? 0), 0);
  const slowest = Math.max(...results.map((r) => r.ms));
  const spend = results.reduce((n, r) => n + (r.costUsd ?? 0), 0);

  console.log(`\nbatches:            ${batches.length} (${okRows.length} validated, ${batches.length - okRows.length} failed)`);
  console.log(`items returned:     ${items} of ${slice.length} sources`);
  console.log(`slowest batch:      ${(slowest / 1000).toFixed(1)}s  (timeout is ${TIMEOUT_MS / 1000}s)`);
  console.log(`stage wall-clock:   ${(wallClock / 1000).toFixed(1)}s at concurrency ${ANALYZE_CONCURRENCY}`);
  console.log(`tokens:             in=${okRows.reduce((n, r) => n + (r.inputTokens ?? 0), 0)} out=${okRows.reduce((n, r) => n + (r.outputTokens ?? 0), 0)}`);
  console.log(`cost (pricing.ts):  $${spend.toFixed(4)}`);
  console.log(`all ids known:      ${ids.size === slice.length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
