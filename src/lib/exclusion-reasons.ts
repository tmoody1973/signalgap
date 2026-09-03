/**
 * Why a lead did not qualify, said the way an editor would say it.
 *
 * The rules engine emits codes like `insufficient_independence`. A screen that
 * shows only "did not qualify" hides its own reasoning, which is the one thing
 * this product promises never to do. These sentences are the translation, and
 * nothing else in the app may invent a different wording for the same rule.
 */
export const EXCLUSION_REASON_TEXT = {
  weak_locality: "nothing ties it to Milwaukee",
  stale: "the first signal is older than the discovery window",
  insufficient_independence: "only one kind of source confirmed it, and two are required",
  no_beat_relevance: "it does not fall in a covered beat",
  already_covered: "too many newsrooms have already reported it",
  inaccessible_evidence: "a source it depends on could not be opened",
  coverage_pass_incomplete: "the check for existing coverage did not finish",
  promotional: "the signals are promotion, not news",
  duplicate: "it repeats a lead already in the feed",
  speculative: "the claim is speculation, not a reported development",
  routine_crime: "it is routine crime, which this feed leaves out",
  unreadable_evidence: "the evidence could not be read, so nothing was judged",
} as const;

export type ExclusionReason = keyof typeof EXCLUSION_REASON_TEXT;

function isKnown(reason: string): reason is ExclusionReason {
  return reason in EXCLUSION_REASON_TEXT;
}

/**
 * The same reasons, short enough to sit in a chip. Keyed identically so a
 * reason can never have a sentence without a chip or a chip without a
 * sentence; the unit test enforces that.
 */
export const EXCLUSION_REASON_SHORT: Record<ExclusionReason, string> = {
  weak_locality: "Not Milwaukee",
  stale: "Too old",
  insufficient_independence: "One source",
  no_beat_relevance: "Off-beat",
  already_covered: "Already covered",
  inaccessible_evidence: "Source unreachable",
  coverage_pass_incomplete: "Coverage unchecked",
  promotional: "Promotion",
  duplicate: "Duplicate",
  speculative: "Speculation",
  routine_crime: "Routine crime",
  unreadable_evidence: "Unreadable",
};

/** One chip per known reason, each carrying the full sentence for its title. */
export function exclusionChips(reasons: readonly string[] | undefined): { short: string; long: string }[] {
  return (reasons ?? []).filter(isKnown).map((r) => ({ short: EXCLUSION_REASON_SHORT[r], long: EXCLUSION_REASON_TEXT[r] }));
}

/**
 * One sentence naming every rule the lead failed, or null if it failed none.
 *
 * Unknown codes are dropped rather than printed. A future rule reaching an old
 * client should show one less reason, never a raw code.
 */
export function exclusionSentence(reasons: readonly string[] | undefined): string | null {
  const clauses = (reasons ?? []).filter(isKnown).map((r) => EXCLUSION_REASON_TEXT[r]);
  if (clauses.length === 0) return null;
  const joined = clauses.length === 1
    ? clauses[0]
    : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  return `Did not qualify: ${joined}.`;
}
