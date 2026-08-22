import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import * as V from "../lib/validators";
import { SCHEMA_VERSION, generateBriefOutput, type GenerateBriefOutput } from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

/**
 * The brief is a draft a journalist reports FROM. It is never a story.
 *
 * Two things make it safe: every block cites a source ID we supplied, and the
 * confirmed-facts section may cite only sources the DETERMINISTIC layer already
 * classified as confirming. A model that tries to promote a claim fails the whole
 * output — it cannot half-succeed into a brief an editor then trusts.
 */

/**
 * Written by us, not the model. When a section has no evidence, the honest
 * sentence is a fixed one — asking a model to phrase an absence is asking it to
 * fill a gap, which is exactly the failure mode this product exists to avoid.
 */
export const EMPTY_SECTION_NOTES = {
  confirmedFacts: "Nothing here has been independently confirmed yet. Treat every claim below as unverified.",
  unverifiedClaims: "No unverified claims were extracted from the cited sources.",
  conflicts: "No conflicting reports were found among the cited sources.",
  existingCoverageComplete: "The 30-day coverage check completed and found no prior local reporting.",
  existingCoverageIncomplete: "The coverage check did not complete, so prior local reporting is unknown.",
  potentialHumanSources: "No named people were identified in the cited sources.",
} as const;

const vEvidenceRecord = v.object({ text: v.string(), sourceResultIds: v.array(v.string()) });

export const loadBriefInput = internalQuery({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates") },
  returns: v.union(v.null(), v.object({
    currentTitle: v.string(),
    coveragePassStatus: V.vCoveragePassStatus,
    nextVersion: v.number(),
    confirmedEvidence: v.array(vEvidenceRecord),
    unverifiedEvidence: v.array(vEvidenceRecord),
    conflictingEvidence: v.array(vEvidenceRecord),
    coverageEvidence: v.array(vEvidenceRecord),
    potentialSources: v.array(vEvidenceRecord),
    sourceMetadata: v.array(v.object({
      sourceResultId: v.string(), title: v.string(),
      publisher: v.union(v.string(), v.null()), canonicalUrl: v.string(),
      excerpts: v.array(v.string()),
    })),
    confirmedSourceIds: v.array(v.string()),
  })),
  handler: async (ctx, { scanId, candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;
    // A candidate and a scan that belong to different newsrooms must never be
    // written into one brief.
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== candidate.ownerId) return null;

    const evidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();

    const byKind = (kind: string) => evidence
      .filter((e) => e.kind === kind)
      .map((e) => ({ text: e.claimText, sourceResultIds: e.sourceResultIds.map((id) => id as string) }));

    const citedIds = [...new Set(evidence.flatMap((e) => e.sourceResultIds))];
    const sourceMetadata = [];
    for (const id of citedIds) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      sourceMetadata.push({
        sourceResultId: row._id as string, title: row.title,
        publisher: row.publisher ?? null, canonicalUrl: row.canonicalUrl,
        excerpts: [row.title, row.snippet],
      });
    }

    // The ONLY source of truth for "confirmed". It comes from evidence the
    // deterministic layer already classified, never from anything the model says.
    const confirmedSourceIds = [...new Set(
      evidence.filter((e) => e.kind === "confirmed_fact").flatMap((e) => e.sourceResultIds.map((id) => id as string)),
    )];

    return {
      currentTitle: candidate.currentTitle,
      coveragePassStatus: candidate.coveragePassStatus,
      nextVersion: (candidate.latestBriefVersion ?? 0) + 1,
      confirmedEvidence: byKind("confirmed_fact"),
      unverifiedEvidence: byKind("unverified_signal"),
      conflictingEvidence: byKind("conflicting_claim"),
      coverageEvidence: byKind("existing_coverage"),
      potentialSources: byKind("potential_source"),
      sourceMetadata,
      confirmedSourceIds,
    };
  },
});

const vBlock = v.object({ text: v.string(), sourceResultIds: v.array(v.id("sourceResults")) });

export const persistBrief = internalMutation({
  args: {
    scanId: v.id("scans"),
    candidateId: v.id("candidates"),
    version: v.number(),
    modelRunId: v.id("modelRuns"),
    reportingQuestion: v.string(),
    whySurfaced: v.string(),
    confirmedFacts: v.array(vBlock),
    unverifiedClaims: v.array(vBlock),
    conflicts: v.array(vBlock),
    existingCoverage: v.array(vBlock),
    potentialHumanSources: v.array(vBlock),
    interviewQuestions: v.array(v.string()),
  },
  returns: v.union(v.id("briefVersions"), v.null()),
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) return null;
    const { scanId, candidateId, version, modelRunId, ...body } = args;
    const briefId = await ctx.db.insert("briefVersions", {
      candidateId, scanId, ownerId: candidate.ownerId, version, modelRunId,
      ...body, createdAt: Date.now(),
    });
    await ctx.db.patch(candidateId, { latestBriefVersion: version, updatedAt: Date.now() });
    return briefId;
  },
});

type Block = { text: string; sourceResultIds: string[]; exactExcerpt?: string | null };

/** An empty section gets our fixed sentence and cites nothing, because nothing is what it has. */
const withNoteIfEmpty = (blocks: Block[], note: string): Block[] =>
  blocks.length > 0 ? blocks : [{ text: note, sourceResultIds: [] }];

export type BriefArgs = { scanId: Id<"scans">; candidateId: Id<"candidates"> };
export type BriefOutcome =
  | { ok: true; briefId: Id<"briefVersions">; version: number; modelRunId: Id<"modelRuns">; draft: GenerateBriefOutput }
  | { ok: false; reason: string; errors: string[] };

export async function runGenerateBrief(
  ctx: ActionCtx,
  { scanId, candidateId }: BriefArgs,
  generate?: GenerateFn,
): Promise<BriefOutcome> {
  const loaded = await ctx.runQuery(internal.ai.generateBrief.loadBriefInput, { scanId, candidateId });
  if (!loaded) return { ok: false, reason: "candidate_not_found", errors: ["candidate not found"] };

  const input = {
    candidateId: candidateId as string,
    whySurfacedFacts: [loaded.currentTitle],
    confirmedEvidence: loaded.confirmedEvidence,
    unverifiedEvidence: loaded.unverifiedEvidence,
    conflictingEvidence: loaded.conflictingEvidence,
    coverageEvidence: loaded.coverageEvidence,
    potentialSources: loaded.potentialSources,
    // The stored excerpts stay on our side: they are what a quotation is checked
    // against, not something the model needs handed back to it.
    sourceMetadata: loaded.sourceMetadata.map((s) => ({
      sourceResultId: s.sourceResultId, title: s.title, publisher: s.publisher, canonicalUrl: s.canonicalUrl,
    })),
  };

  const result = await runAiOperation<GenerateBriefOutput>(ctx, {
    scanId, candidateId, operation: "generateBrief", input,
    outputSchema: generateBriefOutput, schemaVersion: SCHEMA_VERSION,
    validation: {
      knownSourceIds: loaded.sourceMetadata.map((s) => s.sourceResultId),
      excerptsBySourceId: Object.fromEntries(loaded.sourceMetadata.map((s) => [s.sourceResultId, s.excerpts])),
      confirmedSourceIds: loaded.confirmedSourceIds,
    },
    generate,
  });
  if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };

  const draft = result.value;
  const coverageNote = loaded.coveragePassStatus === "complete"
    ? EMPTY_SECTION_NOTES.existingCoverageComplete
    : EMPTY_SECTION_NOTES.existingCoverageIncomplete;

  const toBlocks = (blocks: Block[]) => blocks.map((b) => ({
    text: b.text, sourceResultIds: b.sourceResultIds as Id<"sourceResults">[],
  }));

  const briefId = await ctx.runMutation(internal.ai.generateBrief.persistBrief, {
    scanId, candidateId, version: loaded.nextVersion, modelRunId: result.modelRunId,
    reportingQuestion: draft.reportingQuestion,
    whySurfaced: draft.whySurfaced,
    confirmedFacts: toBlocks(withNoteIfEmpty(draft.confirmedFacts, EMPTY_SECTION_NOTES.confirmedFacts)),
    unverifiedClaims: toBlocks(withNoteIfEmpty(draft.unverifiedClaims, EMPTY_SECTION_NOTES.unverifiedClaims)),
    conflicts: toBlocks(withNoteIfEmpty(draft.conflicts, EMPTY_SECTION_NOTES.conflicts)),
    existingCoverage: toBlocks(withNoteIfEmpty(draft.existingCoverage, coverageNote)),
    potentialHumanSources: toBlocks(withNoteIfEmpty(draft.potentialHumanSources, EMPTY_SECTION_NOTES.potentialHumanSources)),
    interviewQuestions: draft.interviewQuestions,
  });
  if (!briefId) return { ok: false, reason: "candidate_not_found", errors: ["candidate disappeared before the brief was written"] };

  return { ok: true, briefId, version: loaded.nextVersion, modelRunId: result.modelRunId, draft };
}

export const write = internalAction({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates") },
  returns: v.union(
    v.object({ ok: v.literal(true), briefId: v.id("briefVersions"), version: v.number(), modelRunId: v.id("modelRuns") }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const outcome = await runGenerateBrief(ctx, args);
    return outcome.ok
      ? { ok: true as const, briefId: outcome.briefId, version: outcome.version, modelRunId: outcome.modelRunId }
      : { ok: false as const, reason: outcome.reason, errors: outcome.errors };
  },
});
