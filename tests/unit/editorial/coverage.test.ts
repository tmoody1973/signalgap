import { describe, expect, it } from "vitest";
import { coverageGapAllowed, coverageSummary } from "../../../convex/editorial/coverage";
import type { CoverageInput } from "../../../convex/editorial/types";

const done = { general: "succeeded", community: "succeeded" } as const;
const report = (id: string, group: "general" | "community", independenceGroup = id) => ({ id, group, independenceGroup });

describe("coverage", () => {
  it("is complete only when both partitions succeeded", () => {
    expect(coverageSummary({ partitions: done, reports: [] }).passStatus).toBe("complete");
    expect(coverageSummary({ partitions: { general: "succeeded", community: "pending" }, reports: [] }).passStatus).toBe("pending");
    expect(coverageSummary({ partitions: { general: "succeeded", community: "failed" }, reports: [] }).passStatus).toBe("failed");
  });

  it("counts syndicated copies once", () => {
    const s = coverageSummary({ partitions: done, reports: [report("a", "general", "wire-1"), report("b", "general", "wire-1"), report("c", "community")] });
    expect(s.originalReportCount).toBe(2);
  });

  it("counts a community outlet the same as a large outlet", () => {
    const s = coverageSummary({ partitions: done, reports: [report("c1", "community"), report("c2", "community"), report("c3", "community")] });
    expect(s.originalReportCount).toBe(3);
    expect(coverageGapAllowed(s)).toBe(false);
  });

  it("allows the gap label at 0, 1, 2 and blocks at 3", () => {
    const n = (k: number): CoverageInput => ({ partitions: done, reports: Array.from({ length: k }, (_, i) => report(`r${i}`, "general")) });
    expect(coverageGapAllowed(coverageSummary(n(0)))).toBe(true);
    expect(coverageGapAllowed(coverageSummary(n(2)))).toBe(true);
    expect(coverageGapAllowed(coverageSummary(n(3)))).toBe(false);
  });

  it("blocks the gap label when the pass failed even with zero reports", () => {
    const s = coverageSummary({ partitions: { general: "failed", community: "succeeded" }, reports: [] });
    expect(coverageGapAllowed(s)).toBe(false);
  });
});
