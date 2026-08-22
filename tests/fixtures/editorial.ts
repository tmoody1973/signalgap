import type { CandidateInput, EngineSource } from "../../convex/editorial/types";

export const HOUR = 60 * 60 * 1000;
export const NOW = 1_800_000_000_000;

export const src = (id: string, signalCategory: EngineSource["signalCategory"], overrides: Partial<EngineSource> = {}): EngineSource =>
  ({ id, signalCategory, independenceGroup: id, isAccessible: true, isPromotional: false, publishedAt: NOW - 12 * HOUR, ...overrides });

export const eligibleCandidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  localityBand: "direct_city",
  beat: "housing",
  relevanceBand: "policy_service_change",
  initiatingSignalAt: NOW - 24 * HOUR,
  now: NOW,
  sources: [src("official", "official_record"), src("news", "original_news")],
  coverage: { partitions: { general: "succeeded", community: "succeeded" }, reports: [] },
  hasTrendMomentum: false,
  isDuplicateOfCandidate: false,
  isSpeculative: false,
  isRoutineCrime: false,
  hasMaterialConflict: false,
  ...overrides,
});
