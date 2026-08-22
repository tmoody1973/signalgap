import { isOfficialDomain } from "../config/officialDomains";

/**
 * Decision 004. The rules engine reads seven judgment fields — localityBand,
 * relevanceBand, beat, and four flags. Together they are worth 40 of 100 points
 * and they gate exclusions. Until now nothing recorded WHO set them.
 *
 * "Deterministic rules decide" is only true if you can point at a field and say
 * where its value came from. That is what `basis` is for. It travels with the
 * value, always.
 */

export type JudgmentBasis = "deterministic" | "ai_suggested" | "editor";
export type Judged<T> = { value: T; basis: JudgmentBasis; reason: string };

/**
 * An official Milwaukee domain among a candidate's sources proves a direct city
 * connection without asking a model anything. Returns null when no rule applies —
 * a null here means "we do not know", never "not local".
 */
export function deterministicLocality(hosts: string[]): Judged<"direct_city"> | null {
  const official = hosts.find((host) => isOfficialDomain(host));
  if (!official) return null;
  return {
    value: "direct_city",
    basis: "deterministic",
    reason: `an official Milwaukee source is cited: ${official.toLowerCase().replace(/^www\./, "")}`,
  };
}

/**
 * Precedence: editor beats AI beats rule.
 *
 * An editor is a person who looked at the lead; a rule is certain but narrow; a
 * model is neither. What matters more than the order is that the answer never
 * arrives without its basis attached.
 */
export function resolveJudgment<T>(
  deterministic: Judged<T> | null,
  aiSuggested: T | null,
  editorOverride: T | null,
  aiReason: string,
): Judged<T> | null {
  if (editorOverride !== null) {
    return { value: editorOverride, basis: "editor", reason: "set by an editor" };
  }
  if (deterministic !== null) return deterministic;
  if (aiSuggested !== null) {
    return { value: aiSuggested, basis: "ai_suggested", reason: aiReason };
  }
  return null;
}
