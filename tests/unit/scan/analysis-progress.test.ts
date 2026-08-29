import { describe, expect, it } from "vitest";
import { analysisProgressText } from "@/lib/analysis-progress";

/**
 * The gap this closes: a live scan spends its whole search budget in the first
 * minute, then reads every source it found — 380 of them on 2026-08-29 — before
 * a single lead exists. For that entire stretch the panel showed
 * "17 of 120 searches used" and "0 ready · 0 did not qualify · 0 still working",
 * and neither number moved. Tarik cancelled a working scan at 3.1 minutes
 * because the screen gave him no way to tell it apart from a dead one.
 */
describe("analysisProgressText", () => {
  it("says nothing before the reading stage has started", () => {
    // No total yet means analysis has not begun; inventing "0 of 0" would be
    // a progress bar for work that is not happening.
    expect(analysisProgressText(undefined, undefined)).toBeNull();
    expect(analysisProgressText(0, 0)).toBeNull();
  });

  it("counts sources read against the total while reading", () => {
    expect(analysisProgressText(200, 380)).toBe("Read 200 of 380 sources");
    expect(analysisProgressText(0, 380)).toBe("Read 0 of 380 sources");
  });

  it("names the NEXT step once every source is read", () => {
    // The second dead zone: reading is done, leads do not exist yet, and
    // clustering has nothing to count. Saying what happens next beats a
    // number that has stopped.
    expect(analysisProgressText(380, 380)).toBe("Read all 380 sources · grouping them into leads");
  });

  it("never reports more read than exist", () => {
    // A batch that answers twice, or a retry, must not produce "390 of 380".
    expect(analysisProgressText(390, 380)).toBe("Read all 380 sources · grouping them into leads");
  });

  it("treats a missing analysed count as none read yet, not as an error", () => {
    expect(analysisProgressText(undefined, 380)).toBe("Read 0 of 380 sources");
  });
});
