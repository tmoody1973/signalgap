import { describe, expect, it } from "vitest";
import { applyCorrection, derivePrimaryLabel, eligibilityTransition, evaluateCandidate } from "../../../convex/editorial/status";
import { eligibleCandidate, src } from "../../fixtures/editorial";

describe("status", () => {
  it("eligible + complete coverage ≤2 → Coverage gap", () => {
    expect(evaluateCandidate(eligibleCandidate()).label).toBe("Coverage gap");
  });
  it("failed coverage never yields the gap label even when everything else passes", () => {
    const e = evaluateCandidate(eligibleCandidate({ coverage: { partitions: { general: "failed", community: "succeeded" }, reports: [] } }));
    expect(e.status).toBe("excluded");
    expect(e.label).toBe("Worth a look");
  });
  it("material conflict shows Conflicting reports and keeps the candidate", () => {
    const e = evaluateCandidate(eligibleCandidate({ hasMaterialConflict: true }));
    expect(e.label).toBe("Conflicting reports");
    expect(e.status).toBe("eligible");
  });
  it("inaccessible needed source → Needs a recheck", () => {
    const e = evaluateCandidate(eligibleCandidate({ sources: [src("o", "official_record"), src("n", "original_news", { isAccessible: false })] }));
    expect(e.label).toBe("Needs a recheck");
    expect(e.status).toBe("excluded");
  });
  it("derivePrimaryLabel never returns the gap label without complete coverage", () => {
    expect(derivePrimaryLabel({ eligible: true, coveragePassStatus: "pending", originalReportCount: 0, hasMaterialConflict: false, needsReverification: false, hasNoConfirmingCategories: false, hasNonConfirmingSource: false })).toBe("Worth a look");
  });
  it("a Reddit-only candidate is excluded and labeled Unverified tip", () => {
    const e = evaluateCandidate(eligibleCandidate({ sources: [src("r", "community_discussion")] }));
    expect(e.status).toBe("excluded");
    expect(e.label).toBe("Unverified tip");
  });
  it("accessible confirming evidence plus one inaccessible enrichment source stays eligible, scores, and still needs a recheck", () => {
    const e = evaluateCandidate(eligibleCandidate({
      sources: [src("o", "official_record"), src("n", "original_news"), src("x", "public_web", { isAccessible: false, role: "enrichment" })],
    }));
    expect(e.status).toBe("eligible");
    expect(e.score).not.toBeNull();
    expect(e.label).toBe("Needs a recheck");
  });
  it("an inaccessible initiating source still excludes", () => {
    const e = evaluateCandidate(eligibleCandidate({
      sources: [src("o", "official_record", { isAccessible: false, role: "initiating" }), src("n", "original_news")],
    }));
    expect(e.status).toBe("excluded");
    expect(e.reasons).toContain("inaccessible_evidence");
  });
  it("a correction recalculates without touching disposition and does not mutate input", () => {
    const input = eligibleCandidate();
    const corrected = applyCorrection(input, { localityBand: "none" });
    expect(input.localityBand).toBe("direct_city");
    expect(evaluateCandidate(corrected).status).toBe("excluded");
  });
  it("correcting duplicate-source grouping can restore eligibility", () => {
    const dup = eligibleCandidate({ sources: [src("a", "original_news", { independenceGroup: "pr" }), src("b", "official_record", { independenceGroup: "pr" })] });
    expect(evaluateCandidate(dup).status).toBe("excluded");
    const fixed = applyCorrection(dup, { sourceGroups: { b: "b" } });
    expect(evaluateCandidate(fixed).status).toBe("eligible");
    expect(eligibilityTransition(evaluateCandidate(dup), evaluateCandidate(fixed))).toBe("none");
    expect(eligibilityTransition(evaluateCandidate(fixed), evaluateCandidate(fixed))).toBe("none");
    expect(eligibilityTransition(evaluateCandidate(fixed), evaluateCandidate(dup))).toBe("No longer qualifies");
  });
});
