import { DISCOVERY_WINDOW_MS } from "../config/ruleset";
import type { EligibilityResult } from "./eligibility";
import type { IndependenceSummary } from "./independence";
import { CONFIRMING_CATEGORIES, type CandidateInput } from "./types";

export type ScoreComponent = { points: number; max: number; bandId: string; reason: string; evidenceIds: string[] };
export type ScoreComponents = {
  milwaukeeEvidence: ScoreComponent;
  crossSource: ScoreComponent;
  freshness: ScoreComponent;
  coverageScarcity: ScoreComponent;
  relevance: ScoreComponent;
};
export type Score = { total: number; components: ScoreComponents };

const HOUR = 60 * 60 * 1000;

function milwaukeeEvidence(input: CandidateInput): ScoreComponent {
  const ids = input.sources.map((s) => s.id);
  switch (input.localityBand) {
    case "direct_city": return { points: 25, max: 25, bandId: "locality.direct", reason: "Sources document a direct City of Milwaukee action, address, institution, or impact.", evidenceIds: ids };
    case "county_city_effect": return { points: 18, max: 25, bandId: "locality.county", reason: "A Milwaukee County development with a sourced city effect.", evidenceIds: ids };
    case "area_city_consequence": return { points: 12, max: 25, bandId: "locality.area", reason: "An area development with a specific sourced city consequence.", evidenceIds: ids };
    default: return { points: 0, max: 25, bandId: "locality.none", reason: "No sourced Milwaukee connection.", evidenceIds: [] };
  }
}

export function diagnosticCrossSourceBand(ind: IndependenceSummary): ScoreComponent {
  const ids = ind.groups.flatMap((g) => g.sourceIds);
  const n = ind.independentCategoryCount;
  if (n >= 3 && ind.hasPrimary) return { points: 20, max: 20, bandId: "cross.3plus_primary", reason: `${n} independent source categories, including a primary record.`, evidenceIds: ids };
  if (n === 2 && ind.hasPrimary) return { points: 15, max: 20, bandId: "cross.2_primary", reason: "Two independent source categories, including a primary record.", evidenceIds: ids };
  if (n === 2) return { points: 10, max: 20, bandId: "cross.2_secondary", reason: "Two independent non-primary public sources.", evidenceIds: ids };
  if (n === 1 && ind.hasPrimary) return { points: 5, max: 20, bandId: "cross.1_primary_diagnostic", reason: "One primary record only; fails the two-category gate (diagnostic band).", evidenceIds: ids };
  return { points: 0, max: 20, bandId: "cross.none", reason: "No independent confirming source categories.", evidenceIds: ids };
}

function freshness(input: CandidateInput): ScoreComponent {
  const age = input.now - input.initiatingSignalAt;
  const recent = input.sources.filter((s) => s.isAccessible && CONFIRMING_CATEGORIES.has(s.signalCategory) && s.publishedAt !== undefined && input.now - s.publishedAt <= 72 * HOUR);
  const ids = recent.map((s) => s.id);
  if (age <= 48 * HOUR && (input.hasTrendMomentum || recent.length >= 2)) return { points: 15, max: 15, bandId: "fresh.48h_momentum", reason: "Initiating signal within 48 hours with trend growth or repeated signals.", evidenceIds: ids };
  if (age <= 72 * HOUR || recent.length >= 2) return { points: 10, max: 15, bandId: "fresh.72h", reason: "Initiating signal within 72 hours, or two recent signals.", evidenceIds: ids };
  const withinWindow = input.sources.filter((s) => s.isAccessible && CONFIRMING_CATEGORIES.has(s.signalCategory) && s.publishedAt !== undefined && input.now - s.publishedAt <= DISCOVERY_WINDOW_MS);
  return { points: 5, max: 15, bandId: "fresh.7d", reason: "One qualifying signal within the seven-day window.", evidenceIds: withinWindow.map((s) => s.id) };
}

function coverageScarcity(e: EligibilityResult): ScoreComponent {
  const n = e.coverage.originalReportCount;
  const ids = e.coverage.countedReportIds;
  if (n === 0) return { points: 25, max: 25, bandId: "coverage.0", reason: "No qualifying original local report found in the prior 30 days.", evidenceIds: ids };
  if (n === 1) return { points: 15, max: 25, bandId: "coverage.1", reason: "One qualifying original local report found in the prior 30 days.", evidenceIds: ids };
  if (n === 2) return { points: 5, max: 25, bandId: "coverage.2", reason: "Two qualifying original local reports found in the prior 30 days.", evidenceIds: ids };
  return { points: 0, max: 25, bandId: "coverage.3plus", reason: "Three or more qualifying original reports; fails eligibility.", evidenceIds: ids };
}

function relevance(input: CandidateInput): ScoreComponent {
  const ids = input.sources.map((s) => s.id);
  switch (input.relevanceBand) {
    case "policy_service_change": return { points: 15, max: 15, bandId: "relevance.policy", reason: "Documented policy, service, access, resource, safety, or spending change.", evidenceIds: ids };
    case "community_cultural_impact": return { points: 10, max: 15, bandId: "relevance.community", reason: "Documented community or cultural impact.", evidenceIds: ids };
    case "emerging_question": return { points: 5, max: 15, bandId: "relevance.emerging", reason: "Emerging beat question with unestablished impact.", evidenceIds: ids };
    default: return { points: 0, max: 15, bandId: "relevance.promotion", reason: "Pure promotion.", evidenceIds: [] };
  }
}

export function calculateScore(input: CandidateInput, eligibility: EligibilityResult): Score | null {
  if (!eligibility.eligible) return null;
  const components: ScoreComponents = {
    milwaukeeEvidence: milwaukeeEvidence(input),
    crossSource: diagnosticCrossSourceBand(eligibility.independence),
    freshness: freshness(input),
    coverageScarcity: coverageScarcity(eligibility),
    relevance: relevance(input),
  };
  const total = Object.values(components).reduce((sum, c) => sum + c.points, 0);
  return { total, components };
}
