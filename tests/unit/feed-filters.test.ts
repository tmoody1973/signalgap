import { describe, expect, it } from "vitest";
import { vProductLabel } from "../../convex/lib/validators";
import { isLeadLabel } from "@/components/feed/feed-filters";
import { parseFeedFilters, feedFiltersToParams } from "@/lib/feed-filters";
import { PRODUCT_LABELS } from "@/lib/source-labels";

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

/**
 * `parseFeedFilters` validates a label against PRODUCT_LABELS; `listForScan`
 * argues against vProductLabel, which is a strict subset. `isLeadLabel` is the
 * guard across that gap, so the expectations are derived from the two
 * vocabularies rather than typed out — if either one changes, the test moves
 * with it instead of rotting.
 */
describe("isLeadLabel", () => {
  const serverLabels = vProductLabel.members.map((member) => member.value);
  const scanOnlyLabels = Object.values(PRODUCT_LABELS).filter(
    (label) => !serverLabels.includes(label as (typeof serverLabels)[number]),
  );

  it("accepts every label the server query will actually take", () => {
    for (const label of serverLabels) expect(isLeadLabel(label)).toBe(true);
  });

  it("rejects the scan-level labels that parse clean but the server would refuse", () => {
    // These describe a SCAN, not a lead. Each one survives parseFeedFilters and
    // would reach listForScan's own argument validator, which throws.
    expect(scanOnlyLabels).toEqual(["Incomplete scan", "Stopped early", "Outdated", "Saved copy"]);
    for (const label of scanOnlyLabels) {
      expect(parseFeedFilters(new URLSearchParams(`label=${label}`)).label).toBe(label);
      expect(isLeadLabel(label)).toBe(false);
    }
  });

  it("rejects an absent label and a made-up one", () => {
    expect(isLeadLabel(null)).toBe(false);
    expect(isLeadLabel("BREAKING")).toBe(false);
  });
});
