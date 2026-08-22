import { DISCOVERY_WINDOW_MS, MAX_COVERAGE_REPORTS, MIN_INDEPENDENT_CATEGORIES } from "../config/ruleset";
import { coverageSummary, type CoverageSummary } from "./coverage";
import { independenceSummary, type IndependenceSummary } from "./independence";
import type { CandidateInput, ExclusionReason } from "./types";

export type EligibilityResult =
  | { eligible: true; independence: IndependenceSummary; coverage: CoverageSummary }
  | { eligible: false; reasons: ExclusionReason[]; independence: IndependenceSummary; coverage: CoverageSummary };

export function evaluateEligibility(input: CandidateInput): EligibilityResult {
  const independence = independenceSummary(input.sources);
  const coverage = coverageSummary(input.coverage);
  const reasons: ExclusionReason[] = [];

  if (input.localityBand === "none") reasons.push("weak_locality");
  if (input.now - input.initiatingSignalAt > DISCOVERY_WINDOW_MS) reasons.push("stale");
  if (independence.independentCategoryCount < MIN_INDEPENDENT_CATEGORIES) reasons.push("insufficient_independence");
  if (input.beat === null) reasons.push("no_beat_relevance");
  if (input.relevanceBand === "promotion_only") reasons.push("promotional");
  if (coverage.originalReportCount > MAX_COVERAGE_REPORTS) reasons.push("already_covered");
  if (input.sources.some((s) => !s.isAccessible)) reasons.push("inaccessible_evidence");
  if (coverage.passStatus !== "complete") reasons.push("coverage_pass_incomplete");
  if (input.isDuplicateOfCandidate) reasons.push("duplicate");
  if (input.isSpeculative) reasons.push("speculative");
  if (input.isRoutineCrime) reasons.push("routine_crime");

  return reasons.length === 0
    ? { eligible: true, independence, coverage }
    : { eligible: false, reasons, independence, coverage };
}
