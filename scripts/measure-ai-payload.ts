/**
 * Measures what the REAL analyzeResults and clusterSignals payloads cost, using
 * the 294 real source results from the first live Milwaukee scan.
 *
 *   npx tsx scripts/measure-ai-payload.ts --dry-run   # no paid calls, prints payload sizes
 *   npx tsx scripts/measure-ai-payload.ts --only=analyze
 *   npx tsx scripts/measure-ai-payload.ts --only=cluster
 *
 * Fidelity is the point. It imports the SAME prompt builder and the SAME zod
 * schemas the deployment uses, and calls the model exactly the way
 * `defaultGenerate` in convex/ai/provider.ts does. The only deliberate
 * differences from production are named here:
 *   1. The abort timeout is raised (--timeout), because the question is how long
 *      a call really takes, not whether it beats 120 s.
 *   2. Nothing is written to Convex. No modelRuns row, no persistAnalysis. This
 *      script only reads.
 *
 * PAID CALLS. Every model call in here costs real money on a real account.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { analyzeResultsOutput, clusterSignalsOutput } from "../convex/ai/contracts";
import { estimateCostUsd } from "../convex/ai/pricing";
import { buildPrompt } from "../convex/ai/prompts";
import type { AiOperation } from "../convex/ai/provider";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const SCAN_ID = "k1781cvj03wmdd2bgz4ks2rzbh8d4ze8";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const TIMEOUT_MS = Number(process.argv.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? 900_000);

// Run artifacts, not fixtures. `.eval-runs/` is already git-ignored and already
// serves this purpose for scripts/evaluate-models.ts.
const RUN_DIR = join(process.cwd(), ".eval-runs/measure");
mkdirSync(RUN_DIR, { recursive: true });

/** AI_PRIMARY_MODEL lives in the deployment env, not .env.local. Same lookup as scripts/evaluate-models.ts. */
function primaryModel(): string {
  if (process.env.AI_PRIMARY_MODEL) return process.env.AI_PRIMARY_MODEL;
  return execFileSync("npx", ["convex", "env", "get", "AI_PRIMARY_MODEL"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const MODEL_ID = primaryModel();

/** Internal Convex functions are not reachable from a browser client; the CLI is. */
function convexRun<T>(fn: string, args: unknown): T {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out) as T;
}

type SourceRow = {
  sourceResultId: string;
  title: string;
  snippet: string;
  publisher: string | null;
  canonicalUrl: string;
  originalLanguage: string;
  sourceFamily: string;
  publishedAt: string | null;
  sourceType: string;
};

function loadSources(): SourceRow[] {
  const cache = join(RUN_DIR, "sources.json");
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as SourceRow[];
  const ids = convexRun<string[]>("internal.sourceResults.idsForScan", { scanId: SCAN_ID, purpose: "discovery" });
  const rows = convexRun<SourceRow[]>("internal.ai.analyzeResults.loadInput", { scanId: SCAN_ID, sourceResultIds: ids });
  writeFileSync(cache, JSON.stringify(rows));
  return rows;
}

// Exactly convex/ai/analyzeResults.ts:99-103 — note sourceType is deliberately
// NOT shown to the model, so a suggestion is not anchored by our own guess.
const toAnalyzeInput = (rows: SourceRow[]) => ({
  sources: rows.map((s) => ({
    sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
    publisher: s.publisher, canonicalUrl: s.canonicalUrl,
    originalLanguage: s.originalLanguage, sourceFamily: s.sourceFamily, publishedAt: s.publishedAt,
  })),
});

type Measurement = {
  label: string;
  operation: AiOperation;
  n: number;
  ok: boolean;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  itemsReturned?: number;
  error?: string;
};

const results: Measurement[] = [];

function record(m: Measurement) {
  results.push(m);
  writeFileSync(join(RUN_DIR, "results.json"), JSON.stringify(results, null, 2));
  const tok = m.ok ? `in=${m.inputTokens} out=${m.outputTokens} items=${m.itemsReturned}` : `ERROR ${m.error}`;
  console.log(`${m.label}\tn=${m.n}\t${(m.ms / 1000).toFixed(1)}s\t${tok}`);
}

/**
 * The same call convex/ai/provider.ts:55 makes, with a raised timeout and no
 * retry. maxOutputTokens is deliberately left unset because production leaves it
 * unset — if the SDK default truncates a large batch, that is a real finding
 * about the real code, not an artifact of this script.
 */
async function measure<T>(
  label: string, operation: AiOperation, n: number, schema: z.ZodType<T>, input: unknown,
  countItems: (value: T) => number,
): Promise<T | null> {
  const { system, prompt } = buildPrompt(operation, input);
  const modelId = MODEL_ID;

  if (DRY_RUN) {
    console.log(`${label}\tn=${n}\tDRY RUN\tprompt chars=${system.length + prompt.length}`);
    return null;
  }

  const startedAt = Date.now();
  try {
    const result = await generateObject({
      model: anthropic(modelId), schema, system, prompt,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS), maxRetries: 0,
    });
    const ms = Date.now() - startedAt;
    // generateObject already parsed against the schema, but the report claims
    // "validated against the real schema", so the real schema says so.
    const parsed = schema.safeParse(result.object);
    const inputTokens = result.usage?.inputTokens;
    const outputTokens = result.usage?.outputTokens;
    record({
      label, operation, n, ok: parsed.success, ms, inputTokens, outputTokens,
      costUsd: estimateCostUsd(modelId, inputTokens, outputTokens),
      itemsReturned: parsed.success ? countItems(parsed.data) : undefined,
      error: parsed.success ? undefined : parsed.error.issues.map((i) => i.message).join("; "),
    });
    writeFileSync(join(RUN_DIR, `${label}.json`), JSON.stringify(result.object, null, 2));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    record({
      label, operation, n, ok: false, ms: Date.now() - startedAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return null;
  }
}

/** Capitalised runs from a title. Deterministic, NOT model-derived — the report says so. */
function crudeEntityKeys(title: string): string[] {
  return (title.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? []).slice(0, 8);
}

async function main() {
  const sources = loadSources();
  console.log(`loaded ${sources.length} real source rows for scan ${SCAN_ID}`);
  console.log(`model=${MODEL_ID} timeout=${TIMEOUT_MS}ms dryRun=${DRY_RUN}\n`);

  // --- A. analyzeResults on DISJOINT slices, so each batch sees different real
  // content and the 90 analysed sources feed the clustering measurement below.
  const slices: Array<[string, number, number]> = [
    ["analyze-05", 0, 5], ["analyze-10", 5, 15], ["analyze-25", 15, 40], ["analyze-50", 40, 90],
  ];
  const analyzed: Array<{ sourceResultId: string; entityKeys: string[]; claimSummary: string }> = [];

  if (ONLY !== "cluster") {
    for (const [label, from, to] of slices) {
      const rows = sources.slice(from, to);
      const value = await measure(
        label, "analyzeResults", rows.length, analyzeResultsOutput, toAnalyzeInput(rows), (v) => v.items.length,
      );
      for (const item of value?.items ?? []) {
        analyzed.push({
          sourceResultId: item.sourceResultId,
          entityKeys: [
            ...item.entities.people, ...item.entities.organizations, ...item.entities.streets,
            ...item.entities.neighborhoods, ...item.entities.agencies,
          ],
          claimSummary: item.claims[0]?.text ?? item.reason,
        });
      }
    }
    writeFileSync(join(RUN_DIR, "analyzed-signals.json"), JSON.stringify(analyzed, null, 2));
  }

  if (ONLY === "analyze") return;

  const existingCandidates = DRY_RUN
    ? []
    : convexRun<Array<{ candidateId: string; fingerprint: string; summary: string }>>(
        "internal.ai.clusterSignals.loadExistingCandidates", { scanId: SCAN_ID },
      );
  console.log(`\nexistingCandidates in the deployment: ${existingCandidates.length}`);

  // --- B1. EXACTLY what the failed live scan sent. convex/slice.ts:77 builds
  // every signal with `entityKeys: []` and `claimSummary: ""`, so the 294-signal
  // production payload is reproducible with zero invention.
  await measure(
    "cluster-294-as-production", "clusterSignals", 294, clusterSignalsOutput,
    {
      signals: sources.map((s) => ({ sourceResultId: s.sourceResultId, entityKeys: [], claimSummary: "" })),
      existingCandidates,
    },
    (v) => v.clusters.length,
  );

  // --- B2. What clustering WOULD get if Task 2 wired analyzeResults output into
  // it. Model-derived keys and claims, but only for the sources actually analysed.
  const real = existsSync(join(RUN_DIR, "analyzed-signals.json"))
    ? (JSON.parse(readFileSync(join(RUN_DIR, "analyzed-signals.json"), "utf8")) as typeof analyzed)
    : analyzed;
  if (real.length > 0) {
    await measure(
      `cluster-${real.length}-model-derived`, "clusterSignals", real.length, clusterSignalsOutput,
      { signals: real, existingCandidates }, (v) => v.clusters.length,
    );
  }

  // --- B3. 294 POPULATED signals. The first `real.length` are model-derived; the
  // rest are built deterministically from the real title and snippet. This proves
  // the SIZE and the WALL-CLOCK at full scale. It does NOT prove cluster quality,
  // because the filler keys never came from a model.
  const covered = new Set(real.map((s) => s.sourceResultId));
  const filler = sources
    .filter((s) => !covered.has(s.sourceResultId))
    .map((s) => ({
      sourceResultId: s.sourceResultId,
      entityKeys: crudeEntityKeys(s.title),
      claimSummary: s.snippet.slice(0, 200),
    }));
  await measure(
    "cluster-294-populated", "clusterSignals", 294, clusterSignalsOutput,
    { signals: [...real, ...filler], existingCandidates }, (v) => v.clusters.length,
  );

  const spent = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  console.log(`\nmeasured spend at list price: $${spent.toFixed(4)} across ${results.length} calls`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
