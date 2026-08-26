/**
 * Runs the ambiguous-band adjudicator over the REAL 294-source scan, once.
 *
 *   npx tsx scripts/measure-adjudication.ts --dry-run   # no paid call, prints the payload size
 *   npx tsx scripts/measure-adjudication.ts
 *
 * Fidelity is the point, so it imports the same blocking code, the same request
 * builder, the same prompt builder, the same schema and the same completeness
 * check the deployment uses, and makes the call through
 * `streamStructuredObject` — the exact function `defaultGenerate` calls in
 * `convex/ai/provider.ts`. Two deliberate differences, named:
 *   1. No Convex. Nothing is written; there is no `modelRuns` row.
 *   2. The abort timeout is the script's own, so a slow call is measured rather
 *      than cut off at 120 s.
 *
 * PAID CALL. One call, on a real account.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdjudicationRequest, verdictsCoverExactly } from "../convex/ai/adjudicatePairs";
import { adjudicatePairsOutput } from "../convex/ai/contracts";
import { estimateCostUsd } from "../convex/ai/pricing";
import { buildPrompt } from "../convex/ai/prompts";
import { streamStructuredObject } from "../convex/ai/provider";
import { type ClusterSignal, groupSignals } from "../convex/editorial/blocking";
import scan294 from "../tests/fixtures/clustering/scan-294.json";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const TIMEOUT_MS = Number(process.argv.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? 600_000);
const RUN_DIR = join(process.cwd(), ".eval-runs/adjudicate");
mkdirSync(RUN_DIR, { recursive: true });

function primaryModel(): string {
  if (process.env.AI_PRIMARY_MODEL) return process.env.AI_PRIMARY_MODEL;
  return execFileSync("npx", ["convex", "env", "get", "AI_PRIMARY_MODEL"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const SIGNALS: ClusterSignal[] = (scan294 as Record<string, unknown>[]).map((r) => ({
  sourceResultId: r.sourceResultId as string,
  title: r.title as string,
  snippet: r.snippet as string,
  entityKeys: (r.entityKeys as string[]) ?? [],
  claimSummary: (r.claimSummary as string) ?? "",
  dates: [],
}));

async function main() {
  const scored = groupSignals(SIGNALS);
  const request = buildAdjudicationRequest(SIGNALS, scored.pairs);
  const { system, prompt } = buildPrompt("adjudicatePairs", request.input);
  const titleFor = new Map(SIGNALS.map((s) => [s.sourceResultId, s.title]));

  console.log(`signals=${scored.stats.signals} blocked=${scored.stats.blockedPairs} `
    + `linked=${scored.stats.linkedPairs} ambiguous=${scored.stats.ambiguousPairs} rejected=${scored.stats.rejectedPairs}`);
  console.log(`sent=${request.input.pairs.length} overCeiling=${request.overCeiling} promptChars=${system.length + prompt.length}`);
  if (DRY_RUN) return;

  const modelId = primaryModel();
  const startedAt = Date.now();
  const response = await streamStructuredObject(anthropic(modelId), {
    system, prompt, schema: adjudicatePairsOutput, abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - startedAt;

  const parsed = adjudicatePairsOutput.safeParse(response.object);
  if (!parsed.success) {
    console.log(`SCHEMA INVALID after ${(ms / 1000).toFixed(1)}s: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`);
    writeFileSync(join(RUN_DIR, "raw.json"), JSON.stringify(response.object, null, 2));
    return;
  }
  const completeness = verdictsCoverExactly(parsed.data, [...request.byPairId.keys()]);
  const yes = parsed.data.verdicts.filter((v) => v.sameStory);

  console.log(`\n${(ms / 1000).toFixed(1)}s  in=${response.usage.inputTokens} out=${response.usage.outputTokens} `
    + `cost=$${(estimateCostUsd(modelId, response.usage.inputTokens, response.usage.outputTokens) ?? 0).toFixed(4)}`);
  console.log(`completeness: ${completeness.length === 0 ? "OK" : completeness.join("; ")}`);
  console.log(`sameStory: ${yes.length} of ${parsed.data.verdicts.length}\n`);

  const rows = parsed.data.verdicts.map((v) => {
    const [a, b] = (request.byPairId.get(v.pairId) ?? "|").split("|");
    return { ...v, a: titleFor.get(a) ?? a, b: titleFor.get(b) ?? b, score: scored.pairs.find((p) => p.a === a && p.b === b)?.score };
  });
  for (const r of rows.filter((r) => r.sameStory)) {
    console.log(`YES ${r.score}  ${r.a}\n         || ${r.b}\n         ${r.reason}`);
  }
  writeFileSync(join(RUN_DIR, "verdicts.json"), JSON.stringify(rows, null, 2));
  writeFileSync(join(RUN_DIR, "usage.json"), JSON.stringify({ ms, modelId, usage: response.usage }, null, 2));
}

void main();
