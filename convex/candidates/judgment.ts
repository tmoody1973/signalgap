import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { BEATS } from "../config/beats";
import * as V from "../lib/validators";

/**
 * Decision 004. The rules engine reads seven judgment fields; together they are
 * worth 40 of 100 points and they gate exclusions. Storing them without storing
 * WHO set them would make "deterministic rules decide" untrue.
 *
 * Precedence is editor > deterministic > AI, and it is applied here rather than
 * in each caller so there is exactly one place where an override can win.
 */

const vEditorOverrides = v.object({
  localityBand: v.optional(v.string()),
  relevanceBand: v.optional(v.string()),
  beat: v.optional(v.string()),
  isSpeculative: v.optional(v.boolean()),
  isRoutineCrime: v.optional(v.boolean()),
  isDuplicateOfCandidate: v.optional(v.boolean()),
  hasMaterialConflict: v.optional(v.boolean()),
});

const EDITOR_REASON = "set by an editor";

type JudgedString = { value: string; basis: "deterministic" | "ai_suggested" | "editor"; reason: string } | null;
type JudgedBoolean = { value: boolean; basis: "deterministic" | "ai_suggested" | "editor"; reason: string };

const overrideString = (current: JudgedString, override: string | undefined): JudgedString =>
  override === undefined ? current : { value: override, basis: "editor", reason: EDITOR_REASON };

const overrideBoolean = (current: JudgedBoolean, override: boolean | undefined): JudgedBoolean =>
  override === undefined ? current : { value: override, basis: "editor", reason: EDITOR_REASON };

export const saveJudgment = internalMutation({
  args: {
    candidateId: v.id("candidates"),
    judgment: V.vJudgmentRecord,
    editorOverrides: v.optional(vEditorOverrides),
  },
  returns: v.null(),
  handler: async (ctx, { candidateId, judgment, editorOverrides = {} }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;

    const resolved = {
      localityBand: overrideString(judgment.localityBand, editorOverrides.localityBand),
      relevanceBand: overrideString(judgment.relevanceBand, editorOverrides.relevanceBand),
      beat: overrideString(judgment.beat, editorOverrides.beat),
      isSpeculative: overrideBoolean(judgment.isSpeculative, editorOverrides.isSpeculative),
      isRoutineCrime: overrideBoolean(judgment.isRoutineCrime, editorOverrides.isRoutineCrime),
      isDuplicateOfCandidate: overrideBoolean(judgment.isDuplicateOfCandidate, editorOverrides.isDuplicateOfCandidate),
      hasMaterialConflict: overrideBoolean(judgment.hasMaterialConflict, editorOverrides.hasMaterialConflict),
    };

    const patch: Record<string, unknown> = { judgment: resolved, updatedAt: Date.now() };
    // The candidate's own beat column mirrors the judgment so the feed can filter
    // on it without unpacking the record. A value outside the three real beats is
    // ignored rather than written — the column is a schema union, and a model is
    // not allowed to invent a fourth beat.
    if (resolved.beat && Object.hasOwn(BEATS, resolved.beat.value)) {
      patch.beat = resolved.beat.value;
    }
    await ctx.db.patch(candidateId, patch);
    return null;
  },
});

export const readJudgment = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.union(v.null(), V.vJudgmentRecord),
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    return candidate?.judgment ?? null;
  },
});
