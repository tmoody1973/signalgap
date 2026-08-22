import { describe, expect, it } from "vitest";
import { independenceSummary } from "../../../convex/editorial/independence";
import type { EngineSource } from "../../../convex/editorial/types";

const src = (id: string, signalCategory: EngineSource["signalCategory"], independenceGroup = id): EngineSource =>
  ({ id, signalCategory, independenceGroup, isAccessible: true, isPromotional: false });

describe("independenceSummary", () => {
  it("counts distinct confirming categories", () => {
    const s = independenceSummary([src("a", "official_record"), src("b", "original_news")]);
    expect(s.independentCategoryCount).toBe(2);
    expect(s.hasPrimary).toBe(true);
  });

  it("collapses same independence group to one", () => {
    const s = independenceSummary([src("a", "original_news", "release-1"), src("b", "original_news", "release-1"), src("c", "public_web", "release-1")]);
    expect(s.independentCategoryCount).toBe(1);
    expect(s.groups).toHaveLength(1);
  });

  it("reddit, trend, and map never confirm", () => {
    const s = independenceSummary([src("r", "community_discussion"), src("t", "trend"), src("m", "map")]);
    expect(s.independentCategoryCount).toBe(0);
    expect(s.nonConfirmingSourceIds).toEqual(["r", "t", "m"]);
  });

  it("reddit plus one news story is one category", () => {
    const s = independenceSummary([src("r", "community_discussion"), src("n", "original_news")]);
    expect(s.independentCategoryCount).toBe(1);
  });

  it("ignores inaccessible sources", () => {
    const s = independenceSummary([src("a", "official_record"), { ...src("b", "original_news"), isAccessible: false }]);
    expect(s.independentCategoryCount).toBe(1);
  });
});
