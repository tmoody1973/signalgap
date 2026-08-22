import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../../convex/editorial/eligibility";
import { HOUR, NOW, eligibleCandidate, src } from "../../fixtures/editorial";

const reasonsOf = (r: ReturnType<typeof evaluateEligibility>) => (r.eligible ? [] : r.reasons);

describe("evaluateEligibility", () => {
  it("passes the baseline candidate", () => {
    expect(evaluateEligibility(eligibleCandidate()).eligible).toBe(true);
  });
  it("fails reddit-only", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources: [src("r", "community_discussion")] })))).toContain("insufficient_independence");
  });
  it("fails one primary source alone (stricter two-category gate)", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources: [src("o", "official_record")] })))).toContain("insufficient_independence");
  });
  it("fails duplicate release counted once", () => {
    const sources = [src("a", "original_news", { independenceGroup: "pr" }), src("b", "public_web", { independenceGroup: "pr" })];
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources })))).toContain("insufficient_independence");
  });
  it("fails when coverage pass failed", () => {
    const r = evaluateEligibility(eligibleCandidate({ coverage: { partitions: { general: "failed", community: "succeeded" }, reports: [] } }));
    expect(reasonsOf(r)).toContain("coverage_pass_incomplete");
  });
  it("fails with three original reports", () => {
    const reports = ["a", "b", "c"].map((id) => ({ id, independenceGroup: id, group: "general" as const }));
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ coverage: { partitions: { general: "succeeded", community: "succeeded" }, reports } })))).toContain("already_covered");
  });
  it("fails weak locality", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ localityBand: "none" })))).toContain("weak_locality");
  });
  it("fails pure promotion", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ relevanceBand: "promotion_only" })))).toContain("promotional");
  });
  it("fails stale initiating signal", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ initiatingSignalAt: NOW - 8 * 24 * HOUR })))).toContain("stale");
  });
  it("fails when a needed source is inaccessible", () => {
    const sources = [src("o", "official_record"), src("n", "original_news", { isAccessible: false })];
    const r = evaluateEligibility(eligibleCandidate({ sources }));
    expect(reasonsOf(r)).toEqual(expect.arrayContaining(["inaccessible_evidence", "insufficient_independence"]));
  });
  it("returns every failed reason, not just the first", () => {
    const r = evaluateEligibility(eligibleCandidate({ localityBand: "none", isDuplicateOfCandidate: true, isSpeculative: true, isRoutineCrime: true, beat: null }));
    expect(reasonsOf(r)).toEqual(expect.arrayContaining(["weak_locality", "duplicate", "speculative", "routine_crime", "no_beat_relevance"]));
  });
});
