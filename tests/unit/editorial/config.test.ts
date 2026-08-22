import { describe, expect, it } from "vitest";
import { BEATS } from "../../../convex/config/beats";
import { COVERAGE_OUTLETS, REQUIRED_COVERAGE_GROUPS, outletGroupForDomain } from "../../../convex/config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../../convex/config/officialDomains";

describe("editorial config", () => {
  it("has exactly three beats", () => {
    expect(Object.keys(BEATS)).toEqual(["housing", "transportation", "culture"]);
  });
  it("requires both coverage groups", () => {
    expect(REQUIRED_COVERAGE_GROUPS).toEqual(["general", "community"]);
    expect(COVERAGE_OUTLETS.general.length).toBeGreaterThanOrEqual(12);
    expect(COVERAGE_OUTLETS.community.length).toBeGreaterThanOrEqual(7);
  });
  it("maps a community domain to its group", () => {
    expect(outletGroupForDomain("milwaukeenns.org")).toBe("community");
    expect(outletGroupForDomain("www.jsonline.com")).toBe("general");
    expect(outletGroupForDomain("nytimes.com")).toBeNull();
  });
  it("lists official domains", () => {
    expect(OFFICIAL_DOMAINS).toContain("city.milwaukee.gov");
  });
});
