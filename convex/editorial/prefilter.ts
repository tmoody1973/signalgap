import { DISCOVERY_WINDOW_MS } from "../config/ruleset";
import type { LocalityBand, RelevanceBand } from "./types";
import type { Beat } from "../config/beats";

export type PrefilterReason =
  | "weak_locality" | "stale" | "no_beat_relevance" | "promotional"
  | "duplicate" | "speculative" | "routine_crime" | "no_confirming_signal";

export type PrefilterInput = {
  candidateId: string;
  localityBand: LocalityBand;
  relevanceBand: RelevanceBand;
  beat: Beat | null;
  initiatingSignalAt: number;
  now: number;
  isDuplicateOfCandidate: boolean;
  isSpeculative: boolean;
  isRoutineCrime: boolean;
  confirmingCategoryCount: number;
};

export type PrefilterVerdict =
  | { worthCoverage: true; priority: number }
  | { worthCoverage: false; reasons: PrefilterReason[] };

const DAY = 86_400_000;

/**
 * Which candidates get the money.
 *
 * There are 20 coverage reservations and each candidate costs two, so at most
 * TEN candidates can be fully checked in a scan. Spending a pair on a stale or
 * non-local candidate is a pair a real lead does not get.
 *
 * This is deliberately the SAME set of tests the eligibility gate applies, minus
 * everything that needs coverage results — running them early is what makes the
 * spend rational. It decides nothing about eligibility; `evaluateCandidate`
 * still does that, later, with the coverage answer in hand.
 */
export function prefilterCandidate(input: PrefilterInput): PrefilterVerdict {
  const reasons: PrefilterReason[] = [];

  if (input.localityBand === "none") reasons.push("weak_locality");
  if (input.now - input.initiatingSignalAt > DISCOVERY_WINDOW_MS) reasons.push("stale");
  if (input.beat === null) reasons.push("no_beat_relevance");
  if (input.relevanceBand === "promotion_only") reasons.push("promotional");
  if (input.isDuplicateOfCandidate) reasons.push("duplicate");
  if (input.isSpeculative) reasons.push("speculative");
  if (input.isRoutineCrime) reasons.push("routine_crime");
  // Nothing that CAN confirm means the coverage answer changes nothing: the
  // independence gate fails either way. Two paid searches would buy no decision.
  if (input.confirmingCategoryCount === 0) reasons.push("no_confirming_signal");

  if (reasons.length > 0) return { worthCoverage: false, reasons };

  // Priority favours convergence first, freshness second. A story three kinds of
  // source landed on today is the one an editor most needs answered.
  const ageDays = Math.max(0, (input.now - input.initiatingSignalAt) / DAY);
  const freshness = Math.max(0, 7 - ageDays);
  return { worthCoverage: true, priority: input.confirmingCategoryCount * 10 + freshness };
}

/**
 * Passing candidates, best first.
 *
 * The id tiebreak is not cosmetic: a workflow that replays after a restart must
 * order candidates identically, or the resumed run spends its coverage
 * reservations on a different set than the run it is continuing.
 */
export function orderForCoverage(
  verdicts: Array<{ candidateId: string; verdict: PrefilterVerdict }>,
): string[] {
  return verdicts
    .filter((v): v is { candidateId: string; verdict: { worthCoverage: true; priority: number } } => v.verdict.worthCoverage)
    .sort((a, b) => b.verdict.priority - a.verdict.priority || a.candidateId.localeCompare(b.candidateId))
    .map((v) => v.candidateId);
}
