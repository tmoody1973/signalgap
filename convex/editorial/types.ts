import type { Beat } from "../config/beats";

export type SignalCategory = "official_record" | "original_news" | "event" | "video" | "map" | "community_discussion" | "public_web" | "trend";
export const CONFIRMING_CATEGORIES: ReadonlySet<SignalCategory> = new Set(["official_record", "original_news", "event", "video", "public_web"]);
export const PRIMARY_CATEGORIES: ReadonlySet<SignalCategory> = new Set(["official_record"]);

export type SourceRole = "initiating" | "corroborating" | "coverage" | "enrichment" | "potential_source";

export type EngineSource = {
  id: string;
  signalCategory: SignalCategory;
  role: SourceRole;
  independenceGroup: string;   // press-release / syndication lineage; same group = one source
  isAccessible: boolean;
  publishedAt?: number;
  isPromotional: boolean;
};

export type CoverageReport = { id: string; independenceGroup: string; group: "general" | "community" };
export type CoveragePartitionStatus = "pending" | "succeeded" | "failed";
export type CoverageInput = {
  partitions: { general: CoveragePartitionStatus; community: CoveragePartitionStatus };
  reports: CoverageReport[];
};

export type LocalityBand = "direct_city" | "county_city_effect" | "area_city_consequence" | "none";
export type RelevanceBand = "policy_service_change" | "community_cultural_impact" | "emerging_question" | "promotion_only";

export type CandidateInput = {
  localityBand: LocalityBand;
  beat: Beat | null;
  relevanceBand: RelevanceBand;
  initiatingSignalAt: number;
  now: number;
  sources: EngineSource[];
  coverage: CoverageInput;
  hasTrendMomentum: boolean;
  isDuplicateOfCandidate: boolean;
  isSpeculative: boolean;
  isRoutineCrime: boolean;
  hasMaterialConflict: boolean;
};

export type ExclusionReason =
  | "weak_locality" | "stale" | "insufficient_independence" | "no_beat_relevance" | "already_covered"
  | "inaccessible_evidence" | "coverage_pass_incomplete" | "promotional" | "duplicate" | "speculative"
  | "routine_crime" | "unreadable_evidence";
