import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { type Beat, BEATS } from "../config/beats";
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

const isBeat = (value: string): value is Beat => Object.hasOwn(BEATS, value);

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

    // The candidate's own beat column mirrors the judgment so the feed can filter
    // on it without unpacking the record. A TOTAL mirror, not a partial one: a
    // judgment naming no beat, or naming one outside the three real beats, clears
    // the column rather than leaving whatever was there. A model is not allowed
    // to invent a fourth beat, and the product is not allowed to keep asserting
    // an old one after the judgment stopped supporting it. `undefined` in a
    // Convex patch REMOVES the field, which is how "never established" is stored.
    const beat = resolved.beat && isBeat(resolved.beat.value) ? resolved.beat.value : undefined;
    await ctx.db.patch(candidateId, { judgment: resolved, beat, updatedAt: Date.now() });
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
