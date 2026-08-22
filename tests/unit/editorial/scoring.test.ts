import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../../convex/editorial/eligibility";
import { calculateScore, diagnosticCrossSourceBand } from "../../../convex/editorial/scoring";
import { HOUR, NOW, eligibleCandidate, src } from "../../fixtures/editorial";

const score = (overrides: Parameters<typeof eligibleCandidate>[0] = {}) => {
  const input = eligibleCandidate(overrides);
  return calculateScore(input, evaluateEligibility(input));
};
const reports = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `r${i}`, independenceGroup: `r${i}`, group: "general" as const }));
const cov = (k: number) => ({ partitions: { general: "succeeded", community: "succeeded" } as const, reports: reports(k) });

describe("calculateScore", () => {
  it("returns null for ineligible", () => {
    expect(score({ localityBand: "none" })).toBeNull();
  });
  it("total equals component sum and max is 100", () => {
    const s = score({ hasTrendMomentum: true })!;
    const sum = Object.values(s.components).reduce((a, c) => a + c.points, 0);
    expect(s.total).toBe(sum);
    expect(Object.values(s.components).reduce((a, c) => a + c.max, 0)).toBe(100);
  });
  it("locality bands", () => {
    expect(score()!.components.milwaukeeEvidence.points).toBe(25);
    expect(score({ localityBand: "county_city_effect" })!.components.milwaukeeEvidence.points).toBe(18);
    expect(score({ localityBand: "area_city_consequence" })!.components.milwaukeeEvidence.points).toBe(12);
  });
  it("cross-source bands", () => {
    expect(score()!.components.crossSource.points).toBe(15); // 2 incl primary
    expect(score({ sources: [src("o", "official_record"), src("n", "original_news"), src("e", "event")] })!.components.crossSource.points).toBe(20);
    expect(score({ sources: [src("n", "original_news"), src("e", "event")] })!.components.crossSource.points).toBe(10);
    expect(diagnosticCrossSourceBand(evaluateEligibility(eligibleCandidate({ sources: [src("o", "official_record")] })).independence).points).toBe(5);
  });
  it("freshness bands", () => {
    expect(score({ initiatingSignalAt: NOW - 10 * HOUR, hasTrendMomentum: true })!.components.freshness.points).toBe(15);
    expect(score({ initiatingSignalAt: NOW - 60 * HOUR })!.components.freshness.points).toBe(10);
    const old = [src("o", "official_record", { publishedAt: NOW - 5 * 24 * HOUR }), src("n", "original_news", { publishedAt: NOW - 6 * 24 * HOUR })];
    expect(score({ initiatingSignalAt: NOW - 5 * 24 * HOUR, sources: old })!.components.freshness.points).toBe(5);
  });
  it("coverage scarcity bands at 0/1/2 and ineligible at 3", () => {
    expect(score({ coverage: cov(0) })!.components.coverageScarcity.points).toBe(25);
    expect(score({ coverage: cov(1) })!.components.coverageScarcity.points).toBe(15);
    expect(score({ coverage: cov(2) })!.components.coverageScarcity.points).toBe(5);
    expect(score({ coverage: cov(3) })).toBeNull();
  });
  it("relevance bands", () => {
    expect(score()!.components.relevance.points).toBe(15);
    expect(score({ relevanceBand: "community_cultural_impact" })!.components.relevance.points).toBe(10);
    expect(score({ relevanceBand: "emerging_question" })!.components.relevance.points).toBe(5);
  });
  it("every component names its evidence and reason", () => {
    for (const c of Object.values(score()!.components)) {
      expect(c.reason.length).toBeGreaterThan(10);
      expect(c.bandId).toBeTruthy();
    }
  });
});
