import { MAX_COVERAGE_REPORTS } from "../config/ruleset";
import { REQUIRED_COVERAGE_GROUPS } from "../config/coverageOutlets";
import type { CoverageInput } from "./types";

export type CoverageSummary = {
  passStatus: "pending" | "complete" | "failed";
  originalReportCount: number;
  countedReportIds: string[];
  groupsChecked: string[];
};

export function coverageSummary(input: CoverageInput): CoverageSummary {
  const statuses = REQUIRED_COVERAGE_GROUPS.map((g) => input.partitions[g]);
  const passStatus = statuses.some((s) => s === "failed") ? "failed" : statuses.every((s) => s === "succeeded") ? "complete" : "pending";

  const seen = new Set<string>();
  const countedReportIds = input.reports.filter((r) => {
    if (seen.has(r.independenceGroup)) return false;
    seen.add(r.independenceGroup);
    return true;
  }).map((r) => r.id);

  return {
    passStatus,
    originalReportCount: countedReportIds.length,
    countedReportIds,
    groupsChecked: REQUIRED_COVERAGE_GROUPS.filter((g) => input.partitions[g] === "succeeded"),
  };
}

export const coverageGapAllowed = (s: CoverageSummary) => s.passStatus === "complete" && s.originalReportCount <= MAX_COVERAGE_REPORTS;
