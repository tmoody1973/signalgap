import { coverageGapAllowed, type CoverageSummary } from "./coverage";
import { evaluateEligibility, type EligibilityResult } from "./eligibility";
import type { IndependenceSummary } from "./independence";
import { calculateScore, type Score } from "./scoring";
import type { CandidateInput, ExclusionReason, SignalCategory } from "./types";

export type PrimaryLabel = "Worth a look" | "Unverified tip" | "Coverage gap" | "Conflicting reports" | "Needs a recheck";

export function derivePrimaryLabel(a: {
  eligible: boolean;
  coveragePassStatus: CoverageSummary["passStatus"];
  originalReportCount: number;
  hasMaterialConflict: boolean;
  needsReverification: boolean;
  hasNoConfirmingCategories: boolean;
  hasNonConfirmingSource: boolean;
}): PrimaryLabel {
  if (a.needsReverification) return "Needs a recheck";
  if (a.hasMaterialConflict) return "Conflicting reports";
  if (a.hasNoConfirmingCategories && a.hasNonConfirmingSource) return "Unverified tip";
  if (a.eligible && coverageGapAllowed({ passStatus: a.coveragePassStatus, originalReportCount: a.originalReportCount, countedReportIds: [], groupsChecked: [] })) return "Coverage gap";
  return "Worth a look";
}

export type CandidateEvaluation = {
  status: "eligible" | "excluded";
  label: PrimaryLabel;
  reasons: ExclusionReason[];
  score: Score | null;
  independence: IndependenceSummary;
  coverage: CoverageSummary;
};

export function evaluateCandidate(input: CandidateInput): CandidateEvaluation {
  const eligibility: EligibilityResult = evaluateEligibility(input);
  const reasons = eligibility.eligible ? [] : eligibility.reasons;
  const label = derivePrimaryLabel({
    eligible: eligibility.eligible,
    coveragePassStatus: eligibility.coverage.passStatus,
    originalReportCount: eligibility.coverage.originalReportCount,
    hasMaterialConflict: input.hasMaterialConflict,
    needsReverification: input.sources.some((s) => !s.isAccessible),
    hasNoConfirmingCategories: eligibility.independence.independentCategoryCount === 0,
    hasNonConfirmingSource: eligibility.independence.nonConfirmingSourceIds.length > 0,
  });
  return {
    status: eligibility.eligible ? "eligible" : "excluded",
    label,
    reasons,
    score: calculateScore(input, eligibility),
    independence: eligibility.independence,
    coverage: eligibility.coverage,
  };
}

export type Correction = Partial<Pick<CandidateInput, "beat" | "localityBand" | "relevanceBand">> & {
  sourceGroups?: Record<string, string>;
  sourceCategories?: Record<string, SignalCategory>;
};

export function applyCorrection(input: CandidateInput, c: Correction): CandidateInput {
  const { sourceGroups, sourceCategories, ...scalars } = c;
  return {
    ...input,
    ...scalars,
    sources: input.sources.map((s) => ({
      ...s,
      independenceGroup: sourceGroups?.[s.id] ?? s.independenceGroup,
      signalCategory: sourceCategories?.[s.id] ?? s.signalCategory,
    })),
  };
}

export const eligibilityTransition = (before: CandidateEvaluation, after: CandidateEvaluation): "none" | "No longer qualifies" =>
  before.status === "eligible" && after.status === "excluded" ? "No longer qualifies" : "none";

/**
 * The verdict for a candidate the system could not judge at all — its evidence
 * classification failed, so there are no bands, no categories and no snapshot.
 *
 * It exists so such a lead is EXCLUDED WITH A REASON rather than left at
 * "processing" forever, invisible in both the feed and the exclusions list.
 * Naming the real cause matters: "no judgment" describes the consequence, and
 * an editor reading it would look for the wrong problem.
 *
 * It lives here, beside `evaluateCandidate`, because the rules decide every
 * verdict this product renders — including the verdict "we cannot decide".
 */
export function unreadableVerdict(): CandidateEvaluation {
  return {
    status: "excluded",
    label: "Worth a look",
    reasons: ["unreadable_evidence"],
    // No score. Not zero — a zero would say the rules ran and found nothing.
    score: null,
    independence: { independentCategoryCount: 0, hasPrimary: false, groups: [], nonConfirmingSourceIds: [] },
    coverage: { passStatus: "pending", originalReportCount: 0, countedReportIds: [], groupsChecked: [] },
  };
}
