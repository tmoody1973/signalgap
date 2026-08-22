import { v } from "convex/values";

export const vMarketKey = v.literal("milwaukee-wi");
export const vBeat = v.union(v.literal("housing"), v.literal("transportation"), v.literal("culture"));
export const vScanStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("partial"), v.literal("canceled"));
export const vStage = v.union(v.literal("discovery"), v.literal("evidence"), v.literal("coverage"), v.literal("briefs"));
export const vPurpose = v.union(v.literal("discovery"), v.literal("corroboration"), v.literal("coverage"), v.literal("enrichment"));
export const vEngine = v.union(
  v.literal("google"), v.literal("google_news"), v.literal("google_trends_trending_now"),
  v.literal("google_events"), v.literal("youtube"), v.literal("google_maps"),
);
export const vLanguage = v.union(v.literal("en"), v.literal("es"), v.literal("mixed"));
export const vSearchRunStatus = v.union(v.literal("reserved"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("skipped"));
export const vSourceFamily = v.union(
  v.literal("news"), v.literal("official"), v.literal("event"), v.literal("video"),
  v.literal("map"), v.literal("community_discussion"), v.literal("public_web"), v.literal("trend"),
);
export const vSourceType = v.union(v.literal("primary"), v.literal("secondary"), v.literal("discussion"), v.literal("unknown"));
export const vSignalCategory = v.union(
  v.literal("official_record"), v.literal("original_news"), v.literal("event"), v.literal("video"),
  v.literal("map"), v.literal("community_discussion"), v.literal("public_web"), v.literal("trend"),
);
export const vCandidateStatus = v.union(v.literal("processing"), v.literal("eligible"), v.literal("excluded"), v.literal("needs_reverification"));
export const vProductLabel = v.union(
  v.literal("Possible development"), v.literal("Unverified signal"), v.literal("Coverage gap detected"),
  v.literal("Conflicting evidence"), v.literal("Reverification needed"), v.literal("Eligibility changed"),
);
export const vDisposition = v.union(v.literal("new"), v.literal("rejected"), v.literal("monitoring"), v.literal("assigned"));
export const vCoveragePassStatus = v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"));
export const vSourceRole = v.union(v.literal("initiating"), v.literal("corroborating"), v.literal("coverage"), v.literal("enrichment"), v.literal("potential_source"));
export const vAddedBy = v.union(v.literal("ai_suggestion"), v.literal("deterministic_rule"), v.literal("editor"));
export const vEvidenceKind = v.union(v.literal("confirmed_fact"), v.literal("unverified_signal"), v.literal("conflicting_claim"), v.literal("existing_coverage"), v.literal("potential_source"));
export const vEditorEventType = v.union(v.literal("disposition_changed"), v.literal("note_added"), v.literal("question_edited"), v.literal("correction_added"), v.literal("source_flagged"));
export const vModelOperation = v.union(v.literal("analyzeResults"), v.literal("clusterSignals"), v.literal("classifyEvidence"), v.literal("planFollowUp"), v.literal("generateBrief"));
export const vModelRunStatus = v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid"), v.literal("failed"));

export const vScoreComponent = v.object({
  points: v.number(),
  max: v.number(),
  bandId: v.string(),
  reason: v.string(),
  evidenceIds: v.array(v.string()),
});
export const vScoreComponents = v.object({
  milwaukeeEvidence: vScoreComponent,
  crossSource: vScoreComponent,
  freshness: vScoreComponent,
  coverageScarcity: vScoreComponent,
  relevance: vScoreComponent,
});
export const vFailureSummary = v.object({ purpose: vPurpose, code: v.string(), message: v.string() });
export const vSourceBoundBlock = v.object({ text: v.string(), sourceResultIds: v.array(v.id("sourceResults")) });
