import { describe, expect, it } from "vitest";
import { parseFeedFilters, feedFiltersToParams } from "@/lib/feed-filters";

describe("feed filters", () => {
  it("defaults to the eligible view with no filters", () => {
    expect(parseFeedFilters(new URLSearchParams())).toEqual({
      view: "eligible",
      beat: null,
      label: null,
      disposition: null,
    });
  });

  it("round-trips every filter", () => {
    const filters = {
      view: "excluded",
      beat: "housing",
      label: "Coverage gap",
      disposition: "monitoring",
    } as const;
    expect(parseFeedFilters(feedFiltersToParams(filters))).toEqual(filters);
  });

  it("drops a value that is not in the vocabulary rather than trusting it", () => {
    // The input is a URL a person can type. An unknown beat must not reach the
    // query as a filter that silently matches nothing.
    const params = new URLSearchParams("beat=sports&label=BREAKING&view=everything");
    expect(parseFeedFilters(params)).toEqual({
      view: "eligible",
      beat: null,
      label: null,
      disposition: null,
    });
  });

  it("omits null filters from the params, so a clean view has a clean URL", () => {
    const params = feedFiltersToParams({
      view: "eligible",
      beat: null,
      label: null,
      disposition: null,
    });
    expect(params.toString()).toBe("");
  });

  it("survives the round trip a browser address bar actually performs", () => {
    const filters = {
      view: "excluded",
      beat: "housing",
      label: "Coverage gap",
      disposition: "monitoring",
    } as const;
    // Through the STRING, not the object — this is what a shared link is.
    const asUrl = feedFiltersToParams(filters).toString();
    expect(parseFeedFilters(new URLSearchParams(asUrl))).toEqual(filters);
  });

  it("accepts either encoding of a label with a space", () => {
    // A link pasted from one client may arrive %20-encoded and from another +-encoded.
    expect(parseFeedFilters(new URLSearchParams("label=Coverage%20gap")).label).toBe("Coverage gap");
    expect(parseFeedFilters(new URLSearchParams("label=Coverage+gap")).label).toBe("Coverage gap");
  });
});
