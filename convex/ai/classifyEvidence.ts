import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
import { deterministicLocality, resolveJudgment, type Judged } from "../editorial/judgment";
import * as V from "../lib/validators";
import { SCHEMA_VERSION, classifyEvidenceOutput, type ClassifyEvidenceOutput } from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

export const loadCandidateSources = internalQuery({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.array(v.object({
    sourceResultId: v.id("sourceResults"),
    title: v.string(),
    snippet: v.string(),
    publisher: v.union(v.string(), v.null()),
    sourceFamily: V.vSourceFamily,
    isAccessible: v.boolean(),
    host: v.string(),
  })),
  handler: async (ctx, { scanId, sourceResultIds }) => {
    const rows = [];
    for (const id of sourceResultIds) {
      const row = await ctx.db.get(id);
      if (!row || row.scanId !== scanId) continue;
      let host = "";
      try { host = new URL(row.canonicalUrl).hostname; } catch { host = ""; }
      rows.push({
        sourceResultId: row._id, title: row.title, snippet: row.snippet,
        publisher: row.publisher ?? null, sourceFamily: row.sourceFamily,
        isAccessible: row.isAccessible, host,
      });
    }
    return rows;
  },
});

/** The seven fields the rules engine reads, each carrying who set it (decision 004). */
export type JudgmentSet = {
  localityBand: Judged<string> | null;
  relevanceBand: Judged<string> | null;
  beat: Judged<string> | null;
  isSpeculative: Judged<boolean>;
  isRoutineCrime: Judged<boolean>;
  isDuplicateOfCandidate: Judged<boolean>;
  hasMaterialConflict: Judged<boolean>;
};

export type EditorOverrides = Partial<{
  localityBand: string; relevanceBand: string; beat: string;
  isSpeculative: boolean; isRoutineCrime: boolean; isDuplicateOfCandidate: boolean; hasMaterialConflict: boolean;
}>;

export type ClassifyArgs = {
  scanId: Id<"scans">;
  candidateId: Id<"candidates">;
  sourceResultIds: Id<"sourceResults">[];
  claims?: { text: string; sourceResultIds: string[] }[];
  editorOverrides?: EditorOverrides;
};

export type ClassifyOutcome =
  | { ok: true; suggestions: ClassifyEvidenceOutput; judgment: JudgmentSet; modelRunId: Id<"modelRuns"> }
  | { ok: false; reason: string; errors: string[] };

const flag = (
  aiValue: boolean,
  override: boolean | undefined,
  reason: string,
): Judged<boolean> =>
  resolveJudgment<boolean>(null, aiValue, override ?? null, reason) ?? { value: false, basis: "deterministic", reason: "default" };

export async function runClassifyEvidence(
  ctx: ActionCtx,
  { scanId, candidateId, sourceResultIds, claims = [], editorOverrides = {} }: ClassifyArgs,
  generate?: GenerateFn,
): Promise<ClassifyOutcome> {
  const sources = await ctx.runQuery(internal.ai.classifyEvidence.loadCandidateSources, { scanId, sourceResultIds });
  if (sources.length === 0) return { ok: false, reason: "no_sources", errors: ["no readable sources for this candidate"] };

  const input = {
    candidateId: candidateId as string,
    // host is loaded for the deterministic locality check below. The model is
    // not shown it — locality is settled by the rule, not argued from a domain.
    sources: sources.map((s) => ({
      sourceResultId: s.sourceResultId, title: s.title, snippet: s.snippet,
      publisher: s.publisher, sourceFamily: s.sourceFamily, isAccessible: s.isAccessible,
    })),
    claims,
  };

  const result = await runAiOperation<ClassifyEvidenceOutput>(ctx, {
    scanId, candidateId, operation: "classifyEvidence", input,
    outputSchema: classifyEvidenceOutput, schemaVersion: SCHEMA_VERSION,
    validation: {
      knownSourceIds: sources.map((s) => s.sourceResultId),
      excerptsBySourceId: Object.fromEntries(sources.map((s) => [s.sourceResultId, [s.title, s.snippet]])),
    },
    generate,
  });
  if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };

  const suggestions = result.value;

  // Decision 004: try the deterministic path FIRST. An official Milwaukee domain
  // among the sources settles locality without a model being involved at all.
  const ruleLocality = deterministicLocality(sources.map((s) => s.host));

  const judgment: JudgmentSet = {
    localityBand: resolveJudgment<string>(
      ruleLocality, suggestions.localityBandSuggestion, editorOverrides.localityBand ?? null,
      "suggested by the model from the supplied sources",
    ),
    relevanceBand: resolveJudgment<string>(
      null, suggestions.relevanceBandSuggestion, editorOverrides.relevanceBand ?? null,
      "suggested by the model from the supplied sources",
    ),
    beat: resolveJudgment<string>(
      null, suggestions.beatSuggestion, editorOverrides.beat ?? null,
      "suggested by the model from the supplied sources",
    ),
    isSpeculative: flag(suggestions.flags.isSpeculative, editorOverrides.isSpeculative, "flagged by the model"),
    isRoutineCrime: flag(suggestions.flags.isRoutineCrime, editorOverrides.isRoutineCrime, "flagged by the model"),
    isDuplicateOfCandidate: flag(suggestions.flags.isDuplicateOfCandidate, editorOverrides.isDuplicateOfCandidate, "flagged by the model"),
    hasMaterialConflict: flag(suggestions.flags.hasMaterialConflict, editorOverrides.hasMaterialConflict, "flagged by the model"),
  };

  return { ok: true, suggestions, judgment, modelRunId: result.modelRunId };
}

const vJudgedString = v.union(v.null(), v.object({ value: v.string(), basis: v.string(), reason: v.string() }));
const vJudgedBool = v.object({ value: v.boolean(), basis: v.string(), reason: v.string() });

export const classify = internalAction({
  args: {
    scanId: v.id("scans"),
    candidateId: v.id("candidates"),
    sourceResultIds: v.array(v.id("sourceResults")),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true), modelRunId: v.id("modelRuns"),
      judgment: v.object({
        localityBand: vJudgedString, relevanceBand: vJudgedString, beat: vJudgedString,
        isSpeculative: vJudgedBool, isRoutineCrime: vJudgedBool,
        isDuplicateOfCandidate: vJudgedBool, hasMaterialConflict: vJudgedBool,
      }),
    }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const outcome = await runClassifyEvidence(ctx, args);
    return outcome.ok
      ? { ok: true as const, modelRunId: outcome.modelRunId, judgment: outcome.judgment }
      : { ok: false as const, reason: outcome.reason, errors: outcome.errors };
  },
});
