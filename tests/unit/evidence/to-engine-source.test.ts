import { describe, expect, it } from "vitest";
import { defaultIndependenceGroup, signalCategoryFor, toEngineSource } from "../../../convex/candidates/toEngineSource";

const base = {
  sourceResultId: "src_1",
  sourceFamily: "news" as const,
  canonicalUrl: "https://jsonline.com/story/2026/rezoning",
  publisher: "Milwaukee Journal Sentinel",
  publishedAt: 1_700_000_000_000,
  isAccessible: true,
  role: "corroborating" as const,
  independenceGroupOverride: null,
  signalCategoryOverride: null,
  isPromotional: false,
};

describe("signalCategoryFor", () => {
  it("maps every source family the normalizers can emit", () => {
    expect(signalCategoryFor("news")).toBe("original_news");
    expect(signalCategoryFor("official")).toBe("official_record");
    expect(signalCategoryFor("event")).toBe("event");
    expect(signalCategoryFor("video")).toBe("video");
    expect(signalCategoryFor("map")).toBe("map");
    expect(signalCategoryFor("community_discussion")).toBe("community_discussion");
    expect(signalCategoryFor("public_web")).toBe("public_web");
    expect(signalCategoryFor("trend")).toBe("trend");
  });
});

describe("defaultIndependenceGroup", () => {
  it("groups by host, so two stories on one site are one lineage", () => {
    expect(defaultIndependenceGroup("https://jsonline.com/a", null))
      .toBe(defaultIndependenceGroup("https://jsonline.com/b", null));
  });

  it("ignores a www prefix", () => {
    expect(defaultIndependenceGroup("https://www.jsonline.com/a", null))
      .toBe(defaultIndependenceGroup("https://jsonline.com/b", null));
  });

  it("keeps two different outlets apart", () => {
    expect(defaultIndependenceGroup("https://jsonline.com/a", null))
      .not.toBe(defaultIndependenceGroup("https://tmj4.com/a", null));
  });

  it("falls back to the publisher when the URL will not parse", () => {
    expect(defaultIndependenceGroup("not a url", "Outlet A")).toBe("publisher:outlet a");
  });

  it("falls back to a shared bucket when there is nothing else", () => {
    expect(defaultIndependenceGroup("not a url", null)).toBe("ungrouped");
  });
});

describe("toEngineSource", () => {
  it("produces exactly the shape the rules engine takes", () => {
    expect(toEngineSource(base)).toEqual({
      id: "src_1",
      signalCategory: "original_news",
      role: "corroborating",
      independenceGroup: "host:jsonline.com",
      isAccessible: true,
      publishedAt: 1_700_000_000_000,
      isPromotional: false,
    });
  });

  it("lets an editor correction override the independence group", () => {
    expect(toEngineSource({ ...base, independenceGroupOverride: "press-release-250412" }).independenceGroup)
      .toBe("press-release-250412");
  });

  it("lets an editor correction override the signal category", () => {
    expect(toEngineSource({ ...base, signalCategoryOverride: "public_web" }).signalCategory).toBe("public_web");
  });

  it("omits publishedAt entirely when there is no date, rather than inventing one", () => {
    expect(toEngineSource({ ...base, publishedAt: undefined })).not.toHaveProperty("publishedAt");
  });

  it("carries an inaccessible source through instead of dropping it", () => {
    expect(toEngineSource({ ...base, isAccessible: false }).isAccessible).toBe(false);
  });
});
