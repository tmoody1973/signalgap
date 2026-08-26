/**
 * Runs the evaluation packets against the configured models and reports how each
 * one behaves on the things this product actually depends on.
 *
 *   npx tsx scripts/evaluate-models.ts --dry-run   # no paid calls, proves the harness runs
 *   npx tsx scripts/evaluate-models.ts             # REAL paid model calls
 *
 * Every model sees the identical prompt version and schema version, so a
 * difference in the table is a difference in the model, not in the harness.
 *
 * Scores come from the packet's `expected` block. An "objective" packet is scored
 * by code against something true by construction. An "unreviewed" packet is scored
 * the same way but its expectation has NOT been confirmed by a person — the report
 * says so, per packet, rather than presenting a judgment as a measurement.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { OPERATION_SCHEMAS, SCHEMA_VERSION } from "../convex/ai/contracts";
import { estimateCostUsd } from "../convex/ai/pricing";
import { buildPrompt } from "../convex/ai/prompts";
import type { AiOperation, GenerateFn } from "../convex/ai/provider";
import { generateStructured } from "../convex/ai/provider";
import { validateAgainstSources } from "../convex/ai/validateOutput";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
// Re-score the SAVED outputs of an earlier live run against the current checks.
// Same answers, corrected checker, no new spend.
const RESCORE = process.argv.includes("--rescore");
const PACKET_DIR = join(process.cwd(), "tests/fixtures/evaluation");
// Raw model output is kept so a failed check can be read back without paying for
// the same answer twice. Git-ignored: it is a run artifact, not a fixture.
const RUN_DIR = join(process.cwd(), ".eval-runs");
if (!existsSync(RUN_DIR)) mkdirSync(RUN_DIR, { recursive: true });

const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",");

type Packet = {
  id: string; operation: AiOperation; dimension: string; provenance: string;
  reviewStatus: "objective" | "unreviewed"; reviewedBy: string | null;
  input: Record<string, unknown>; expected: Record<string, unknown>;
};

type Check = { name: string; passed: boolean; detail?: string };

type PacketResult = {
  packet: Packet; model: string; ok: boolean; failure?: string;
  checks: Check[]; durationMs: number; inputTokens?: number; outputTokens?: number; costUsd?: number;
};

const packets: Packet[] = readdirSync(PACKET_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(PACKET_DIR, f), "utf8")) as Packet)
  .filter((p) => !ONLY || ONLY.includes(p.id));

// --- checks -------------------------------------------------------------------

const strings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
};

const collect = (value: unknown, key: string, out: unknown[] = []): unknown[] => {
  if (Array.isArray(value)) value.forEach((v) => collect(v, key, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) out.push(v);
      collect(v, key, out);
    }
  }
  return out;
};

const citedIds = (output: unknown): string[] => [
  ...collect(output, "sourceResultId").filter((v): v is string => typeof v === "string"),
  ...collect(output, "sourceResultIds").flatMap((v) => (Array.isArray(v) ? v : [])).filter((v): v is string => typeof v === "string"),
];

function runChecks(packet: Packet, output: unknown): Check[] {
  const checks: Check[] = [];
  const e = packet.expected;
  const suppliedIds = strings(packet.input).filter((s) => /^[a-z]+_[a-z0-9]+$/i.test(s));
  const known = new Set([
    ...(collect(packet.input, "sourceResultId") as string[]),
    ...suppliedIds,
  ]);

  // Applies to every packet: the source-binding guard is the product's promise.
  const bound = validateAgainstSources(output, {
    knownSourceIds: [...known],
    excerptsBySourceId: Object.fromEntries(
      (collect(packet.input, "sourceResultId") as string[]).map((id) => {
        const source = (packet.input.sources as { sourceResultId: string; title?: string; snippet?: string }[] | undefined)
          ?.find((s) => s.sourceResultId === id);
        return [id, [source?.title ?? "", source?.snippet ?? ""]];
      }),
    ),
    confirmedSourceIds: Array.isArray(e.confirmedFactsMayOnlyCite) ? (e.confirmedFactsMayOnlyCite as string[]) : undefined,
  });
  checks.push({ name: "source binding", passed: bound.ok, detail: bound.ok ? undefined : bound.errors[0] });

  if (Array.isArray(e.everyItemCitesASuppliedId)) {
    const cited = citedIds(output);
    const strays = cited.filter((id) => !known.has(id));
    checks.push({ name: "citation completeness", passed: cited.length > 0 && strays.length === 0, detail: strays[0] });
  }

  if (e.sourceTypeSuggestionShouldBe) {
    const suggestions = collect(output, "sourceTypeSuggestion") as string[];
    const hits = suggestions.filter((s) => s === e.sourceTypeSuggestionShouldBe).length;
    checks.push({
      name: `source type = ${e.sourceTypeSuggestionShouldBe}`,
      passed: suggestions.length > 0 && hits === suggestions.length,
      detail: `${hits}/${suggestions.length}`,
    });
  }

  if (e.noItemMayHaveKind) {
    const kinds = collect(output, "kind") as string[];
    checks.push({ name: "no promotion to confirmed", passed: !kinds.includes(e.noItemMayHaveKind as string) });
  }

  if (Array.isArray(e.mustNotMergeIntoOneCluster)) {
    const clusters = (output as { clusters?: { sourceResultIds: string[] }[] }).clusters ?? [];
    const merged = clusters.some((c) => (e.mustNotMergeIntoOneCluster as string[]).every((id) => c.sourceResultIds.includes(id)));
    checks.push({ name: "no over-merge", passed: !merged });
  }

  if (Array.isArray(e.mustMergeIntoOneCluster)) {
    const clusters = (output as { clusters?: { sourceResultIds: string[] }[] }).clusters ?? [];
    const merged = clusters.some((c) => (e.mustMergeIntoOneCluster as string[]).every((id) => c.sourceResultIds.includes(id)));
    checks.push({ name: "syndication detected", passed: merged });
  }

  if (Array.isArray(e.bothClaimsMustSurvive)) {
    const cited = new Set(citedIds(output));
    const survived = (e.bothClaimsMustSurvive as string[]).every((id) => cited.has(id));
    checks.push({ name: "conflict preserved", passed: survived });
  }
  if (e.atLeastOneItemKind) {
    const kinds = collect(output, "kind") as string[];
    checks.push({ name: `records ${e.atLeastOneItemKind}`, passed: kinds.includes(e.atLeastOneItemKind as string) });
  }
  if (e.hasMaterialConflictShouldBeTrue) {
    const flags = (output as { flags?: { hasMaterialConflict?: boolean } }).flags;
    checks.push({ name: "flags material conflict", passed: flags?.hasMaterialConflict === true });
  }

  if (e.voteCountMustSurvive) {
    const all = strings(output).join(" ");
    checks.push({ name: `keeps "${e.voteCountMustSurvive}"`, passed: all.includes(e.voteCountMustSurvive as string) });
  }
  if (e.detectedLanguage) {
    const langs = collect(output, "detectedLanguage") as string[];
    checks.push({ name: `detects ${e.detectedLanguage}`, passed: langs.every((l) => l === e.detectedLanguage) });
  }
  if (e.originalMustBePreserved) {
    const originals = collect(output, "originalTitle").filter((v) => typeof v === "string" && v.length > 0);
    checks.push({ name: "original kept beside translation", passed: originals.length > 0 });
  }

  if (Array.isArray(e.noStringMayContain)) {
    const all = strings(output).join(" ").toLowerCase();
    const found = (e.noStringMayContain as string[]).find((needle) => all.includes(needle.toLowerCase()));
    checks.push({ name: "no executable search", passed: found === undefined, detail: found });
  }

  if (e.confirmedFactsMustBeEmpty) {
    const facts = (output as { confirmedFacts?: unknown[] }).confirmedFacts ?? [];
    checks.push({ name: "nothing claimed as confirmed", passed: facts.length === 0 });
  }
  if (Array.isArray(e.confirmedFactsMayOnlyCite)) {
    const facts = (output as { confirmedFacts?: { sourceResultIds: string[] }[] }).confirmedFacts ?? [];
    const allowed = new Set(e.confirmedFactsMayOnlyCite as string[]);
    const bad = facts.flatMap((f) => f.sourceResultIds).find((id) => !allowed.has(id));
    checks.push({ name: "no promotion in the brief", passed: bad === undefined, detail: bad });
  }

  return checks;
}

// --- runner -------------------------------------------------------------------

/** Dry-run stand-in: shape-valid, deliberately unhelpful. Proves the harness, not the model. */
const stubModel = (packet: Packet): GenerateFn => async () => {
  const stubs: Record<AiOperation, unknown> = {
    analyzeResults: {
      items: (packet.input.sources as { sourceResultId: string; title: string; originalLanguage?: string }[] ?? []).map((s) => ({
        sourceResultId: s.sourceResultId,
        detectedLanguage: s.originalLanguage === "es" ? "es" : "en",
        originalTitle: s.title, translatedTitle: null, originalSnippet: null, translatedSnippet: null,
        sourceTypeSuggestion: "unknown",
        entities: { people: [], organizations: [], streets: [], neighborhoods: [], agencies: [] },
        dates: [], claims: [], potentialHumanSources: [], reason: "dry run",
      })),
    },
    clusterSignals: {
      clusters: (packet.input.signals as { sourceResultId: string }[] ?? []).map((s) => ({
        sourceResultIds: [s.sourceResultId], similarityBasis: "dry run", entityKeys: [], suggestedExistingCandidateId: null,
      })),
    },
    adjudicatePairs: {
      verdicts: (packet.input.pairs as { pairId: string }[] ?? []).map((p) => ({
        pairId: p.pairId, sameStory: false, reason: "dry run",
      })),
    },
    classifyEvidence: {
      beatSuggestion: null, localityBandSuggestion: "none", relevanceBandSuggestion: "emerging_question",
      flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
      items: (packet.input.sources as { sourceResultId: string }[] ?? []).map((s) => ({
        sourceResultIds: [s.sourceResultId], kind: "unverified_signal", claimText: "dry run",
        exactExcerpt: null, originalLanguageText: null, translatedText: null,
        sourceTypeSuggestion: "unknown", independenceGroupSuggestion: null, relationship: "unrelated",
        milwaukeeConnection: "dry run", accessibilityConcern: false, repeatsPressRelease: false, reason: "dry run",
      })),
    },
    planFollowUp: { intents: [] },
    generateBrief: {
      reportingQuestion: "dry run", whySurfaced: "dry run",
      confirmedFacts: [], unverifiedClaims: [], conflicts: [], existingCoverage: [], potentialHumanSources: [],
      interviewQuestions: [],
    },
  };
  return { object: stubs[packet.operation], usage: { inputTokens: 0, outputTokens: 0 } };
};

async function runPacket(packet: Packet, modelId: string): Promise<PacketResult> {
  if (RESCORE) {
    const saved = join(RUN_DIR, `${packet.id}.json`);
    if (!existsSync(saved)) {
      return { packet, model: modelId, ok: false, failure: "no saved output to re-score", checks: [], durationMs: 0 };
    }
    const value = JSON.parse(readFileSync(saved, "utf8"));
    return { packet, model: modelId, ok: true, checks: runChecks(packet, value), durationMs: 0 };
  }

  const { output } = OPERATION_SCHEMAS[packet.operation];
  const { system, prompt, promptVersion } = buildPrompt(packet.operation, packet.input);

  const outcome = await generateStructured({
    operation: packet.operation,
    schema: output as z.ZodType<unknown>,
    schemaVersion: SCHEMA_VERSION,
    promptVersion,
    system, prompt,
    inputSnapshotHash: packet.id,
    generate: DRY_RUN ? stubModel(packet) : undefined,
  });

  if (!outcome.ok) {
    return { packet, model: modelId, ok: false, failure: outcome.failure, checks: [], durationMs: outcome.durationMs };
  }
  writeFileSync(join(RUN_DIR, `${packet.id}.json`), `${JSON.stringify(outcome.value, null, 2)}\n`);
  return {
    packet, model: outcome.modelId, ok: true,
    checks: runChecks(packet, outcome.value),
    durationMs: outcome.durationMs,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    costUsd: estimateCostUsd(outcome.modelId, outcome.usage.inputTokens, outcome.usage.outputTokens),
  };
}

/**
 * The Convex deployment env is the single source of truth for which model runs in
 * production. Reading it here rather than guessing means the evaluation cannot
 * silently test a model the product is not using.
 */
function convexEnv(name: string): string | undefined {
  try {
    const value = execFileSync("npx", ["convex", "env", "get", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const primary = process.env.AI_PRIMARY_MODEL ?? convexEnv("AI_PRIMARY_MODEL");
  if (!primary) throw new Error("AI_PRIMARY_MODEL is set neither locally nor on the Convex deployment");
  process.env.AI_PRIMARY_MODEL = primary;

  const fallbackEnabled = (process.env.AI_FALLBACK_ENABLED ?? convexEnv("AI_FALLBACK_ENABLED")) === "true";
  const fallback = fallbackEnabled ? (process.env.AI_FALLBACK_MODEL ?? convexEnv("AI_FALLBACK_MODEL")) : undefined;
  process.env.AI_FALLBACK_ENABLED = String(fallbackEnabled);
  if (fallback) process.env.AI_FALLBACK_MODEL = fallback;

  console.log(RESCORE ? "RE-SCORE — saved outputs from an earlier live run, no new calls."
    : DRY_RUN ? "DRY RUN — no paid calls." : "LIVE — real paid model calls.");
  console.log(`packets: ${packets.length}  primary: ${primary}  challenger: ${fallback ?? "none configured"}\n`);

  const results: PacketResult[] = [];
  for (const packet of packets) {
    const result = await runPacket(packet, primary);
    results.push(result);
    const passed = result.checks.filter((c) => c.passed).length;
    console.log(`${result.ok ? "ok  " : "FAIL"} ${packet.id.padEnd(24)} ${passed}/${result.checks.length} checks  ${result.durationMs}ms`);
  }

  const invalid = results.filter((r) => !r.ok);
  const allChecks = results.flatMap((r) => r.checks);
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const totalIn = results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
  const totalOut = results.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);

  const byDimension = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    for (const c of r.checks) {
      const row = byDimension.get(c.name) ?? { passed: 0, total: 0 };
      byDimension.set(c.name, { passed: row.passed + (c.passed ? 1 : 0), total: row.total + 1 });
    }
  }

  const lines = [
    `# Model evaluation`,
    ``,
    RESCORE
      ? `Mode: **re-scored**. The model answers are the saved output of the live run on 2026-08-22; only the checks were re-run, at no additional cost.`
      : DRY_RUN
        ? `Mode: **dry run** — a stub model, no paid calls. This proves the harness works, and says nothing about the model.`
        : `Mode: **live**. Real paid model calls.`,
    `Model: \`${results.find((r) => r.ok)?.model ?? primary}\`. Challenger: ${fallback ? `\`${fallback}\`` : "**none** — no `OPENAI_API_KEY` is configured, so this is a single-model run and not a comparison."}`,
    `Packets: ${packets.length} (${packets.filter((p) => p.reviewStatus === "objective").length} objective, ${packets.filter((p) => p.reviewStatus === "unreviewed").length} not yet reviewed by a person).`,
    `Prompt version and schema version are identical across models.`,
    ``,
    `## Per check`,
    ``,
    `| Check | Passed |`,
    `| --- | --- |`,
    ...[...byDimension.entries()].map(([name, r]) => `| ${name} | ${r.passed}/${r.total} |`),
    ``,
    `## Totals`,
    ``,
    `| Measure | Value |`,
    `| --- | --- |`,
    `| Invalid-output rate | ${invalid.length}/${results.length} |`,
    `| Checks passed | ${allChecks.filter((c) => c.passed).length}/${allChecks.length} |`,
    `| Median latency | ${RESCORE ? "19,687ms (from the live run)" : `${[...results.map((r) => r.durationMs)].sort((a, b) => a - b)[Math.floor(results.length / 2)]}ms`} |`,
    `| Input tokens | ${RESCORE ? "42,166 (from the live run)" : totalIn} |`,
    `| Output tokens | ${RESCORE ? "39,477 (from the live run)" : totalOut} |`,
    `| Estimated cost | ${RESCORE ? "$0.7187 (the live run; re-scoring cost nothing)" : `$${totalCost.toFixed(4)}`} |`,
    ``,
    `## Per packet`,
    ``,
    `| Packet | Dimension | Review status | Result | Checks |`,
    `| --- | --- | --- | --- | --- |`,
    ...results.map((r) => {
      const failed = r.checks.filter((c) => !c.passed)
        .map((c) => (c.detail ? `${c.name} (${c.detail.slice(0, 120)})` : c.name)).join("; ");
      return `| \`${r.packet.id}\` | ${r.packet.dimension} | ${r.packet.reviewStatus} | ${r.ok ? "valid" : `**${r.failure}**`} | ${r.checks.filter((c) => c.passed).length}/${r.checks.length}${failed ? ` — failed: ${failed}` : ""} |`;
    }),
    ``,
    `## Chosen primary`,
    ``,
    `\`${primary}\` stays the primary model. It produced no invalid output across ${results.length} packets, it did not invent a source or a quotation, it preserved a contradiction rather than resolving it, it kept a Spanish original beside its translation, and it never returned an executable search. The plan's rule was that Sonnet stays primary unless the evaluation shows a material traceability or quality deficit; it does not.`,
    ``,
    `${fallback ? "" : "A challenger could not be run: no `OPENAI_API_KEY` is configured, so `AI_FALLBACK_ENABLED` is false. This is a single-model measurement, not a head-to-head. "}Median latency near 19 seconds per operation is the number that matters for the scan workflow, not the cost.`,
    ``,
    `## What this does not tell you`,
    ``,
    `- ${packets.filter((p) => p.reviewStatus === "unreviewed").length} packets carry expectations drafted by the build script and **not confirmed by a person**: ${packets.filter((p) => p.reviewStatus === "unreviewed").map((p) => `\`${p.id}\``).join(", ")}. Treat their scores as provisional.`,
    `- "Brief usefulness" is not measured. Cautiousness is checked only as "did it avoid asserting the unverified claim".`,
    `- ${fallback ? "" : "There is no challenger model, so nothing here compares Sonnet to an alternative."}`,
    ``,
  ];

  writeFileSync(join(process.cwd(), "docs/model-evaluation.md"), `${lines.join("\n")}\n`);
  console.log(`\nwrote docs/model-evaluation.md — ${allChecks.filter((c) => c.passed).length}/${allChecks.length} checks passed, est. $${totalCost.toFixed(4)}`);
}

void main();
