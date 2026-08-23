import { describe, expect, it } from "vitest";
import { orderForCoverage, prefilterCandidate, type PrefilterInput } from "../../../convex/editorial/prefilter";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const base: PrefilterInput = {
  candidateId: "c1",
  localityBand: "direct_city",
  relevanceBand: "policy_service_change",
  beat: "housing",
  initiatingSignalAt: NOW - DAY,
  now: NOW,
  isDuplicateOfCandidate: false,
  isSpeculative: false,
  isRoutineCrime: false,
  confirmingCategoryCount: 2,
};

describe("prefilterCandidate", () => {
  it("passes a fresh, local, on-beat candidate with confirming signal", () => {
    const verdict = prefilterCandidate(base);
    expect(verdict.worthCoverage).toBe(true);
  });

  it("refuses a candidate with no Milwaukee connection", () => {
    const verdict = prefilterCandidate({ ...base, localityBand: "none" });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["weak_locality"] });
  });

  it("refuses a candidate older than the seven-day discovery window", () => {
    const verdict = prefilterCandidate({ ...base, initiatingSignalAt: NOW - 8 * DAY });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["stale"] });
  });

  it("refuses promotion, duplicates, speculation and routine crime", () => {
    expect(prefilterCandidate({ ...base, relevanceBand: "promotion_only" }))
      .toEqual({ worthCoverage: false, reasons: ["promotional"] });
    expect(prefilterCandidate({ ...base, isDuplicateOfCandidate: true }))
      .toEqual({ worthCoverage: false, reasons: ["duplicate"] });
    expect(prefilterCandidate({ ...base, isSpeculative: true }))
      .toEqual({ worthCoverage: false, reasons: ["speculative"] });
    expect(prefilterCandidate({ ...base, isRoutineCrime: true }))
      .toEqual({ worthCoverage: false, reasons: ["routine_crime"] });
  });

  it("refuses a candidate nothing can confirm", () => {
    // A Reddit thread on its own is a tip. Spending two paid coverage searches
    // on a tip is two searches a real lead does not get.
    const verdict = prefilterCandidate({ ...base, confirmingCategoryCount: 0 });
    expect(verdict).toEqual({ worthCoverage: false, reasons: ["no_confirming_signal"] });
  });

  it("names every reason, not just the first", () => {
    const verdict = prefilterCandidate({
      ...base, localityBand: "none", isSpeculative: true, confirmingCategoryCount: 0,
    });
    expect(verdict.worthCoverage).toBe(false);
    if (verdict.worthCoverage) throw new Error("unreachable");
    expect(verdict.reasons.sort()).toEqual(["no_confirming_signal", "speculative", "weak_locality"]);
  });

  it("ranks a two-category, same-day candidate above a one-category, six-day-old one", () => {
    const strong = prefilterCandidate({ ...base, confirmingCategoryCount: 3, initiatingSignalAt: NOW });
    const weak = prefilterCandidate({ ...base, confirmingCategoryCount: 1, initiatingSignalAt: NOW - 6 * DAY });
    if (!strong.worthCoverage || !weak.worthCoverage) throw new Error("both should pass");
    expect(strong.priority).toBeGreaterThan(weak.priority);
  });
});

describe("orderForCoverage", () => {
  it("returns only passing candidates, highest priority first", () => {
    const ordered = orderForCoverage([
      { candidateId: "low", verdict: { worthCoverage: true, priority: 1 } },
      { candidateId: "skip", verdict: { worthCoverage: false, reasons: ["stale"] } },
      { candidateId: "high", verdict: { worthCoverage: true, priority: 9 } },
    ]);
    expect(ordered).toEqual(["high", "low"]);
  });

  it("breaks a priority tie by candidate id, so a replayed workflow orders the same way", () => {
    const ordered = orderForCoverage([
      { candidateId: "b", verdict: { worthCoverage: true, priority: 5 } },
      { candidateId: "a", verdict: { worthCoverage: true, priority: 5 } },
    ]);
    expect(ordered).toEqual(["a", "b"]);
  });
});
