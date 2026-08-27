import { describe, expect, it } from "vitest";
import { vProductLabel } from "../../convex/lib/validators";
import { BEAT_TEXT, PRODUCT_LABELS, STAGE_TEXT, beatText, labelTone } from "@/lib/source-labels";

describe("source labels", () => {
  it("uses the exact PRD label text", () => {
    expect(Object.values(PRODUCT_LABELS)).toEqual([
      "Worth a look",
      "Unverified tip",
      "Coverage gap",
      "Conflicting reports",
      "Needs a recheck",
      "No longer qualifies",
      "Incomplete scan",
      "Stopped early",
      "Outdated",
      "Saved copy",
    ]);
  });

  it("maps stages to user-facing text", () => {
    expect(STAGE_TEXT).toEqual({
      discovery: "Discovering signals",
      evidence: "Checking local evidence",
      coverage: "Reviewing existing coverage",
      briefs: "Preparing leads",
    });
  });

  it("names the four beats", () => {
    expect(BEAT_TEXT.housing).toBe("Housing and neighborhood development");
    expect(BEAT_TEXT.transportation).toBe("Transportation and access");
    expect(BEAT_TEXT.culture).toBe("Arts, culture, and neighborhood life");
    expect(BEAT_TEXT.sports).toBe("Sports, venues, and recreation");
  });

  it("says so plainly when no beat was ever established, rather than naming one", () => {
    // `candidates.beat` is absent until the classifier establishes it. A card
    // that fell back to any of the three would assert a judgment the product
    // never made — the exact defect Task 4b exists to close.
    expect(beatText(undefined)).toBe("Beat not established");
    expect(beatText("transportation")).toBe("Transportation and access");
  });

  it("gives every label a tone", () => {
    for (const label of Object.values(PRODUCT_LABELS)) {
      expect(["neutral", "caution", "conflict", "positive"]).toContain(labelTone(label));
    }
  });

  it("keeps every convex vProductLabel literal a member of PRODUCT_LABELS — a rename must fail here, not at runtime", () => {
    const productLabels = Object.values(PRODUCT_LABELS);
    for (const member of vProductLabel.members) {
      expect(productLabels).toContain(member.value);
    }
  });
});
