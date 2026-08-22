import { describe, expect, it } from "vitest";
import { BEAT_TEXT, PRODUCT_LABELS, STAGE_TEXT, labelTone } from "@/lib/source-labels";

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

  it("names the three beats", () => {
    expect(BEAT_TEXT.housing).toBe("Housing and neighborhood development");
    expect(BEAT_TEXT.transportation).toBe("Transportation and access");
    expect(BEAT_TEXT.culture).toBe("Arts, culture, and neighborhood life");
  });

  it("gives every label a tone", () => {
    for (const label of Object.values(PRODUCT_LABELS)) {
      expect(["neutral", "caution", "conflict", "positive"]).toContain(labelTone(label));
    }
  });
});
