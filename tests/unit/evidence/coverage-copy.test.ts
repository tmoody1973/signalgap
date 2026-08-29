import { describe, expect, it } from "vitest";
import { coverageCheckText } from "@/lib/coverage-copy";

/**
 * The two outlet boxes used to read "Checked · nothing found" for EVERY
 * completed check, including the ones that found something. On the saved demo
 * that put "Checked · nothing found" directly above "2 original reports found"
 * and a list of three articles — the screen contradicting itself twice in one
 * section, in the one place the product claims an absence of reporting.
 *
 * The server sends an aggregate count only; it does not say which partition a
 * report came from. So a box may never claim a per-outlet number. It reports
 * that the partition was checked, and the count stays in the sentence above it.
 */
describe("coverageCheckText", () => {
  it("says nothing was found only when nothing was found", () => {
    expect(coverageCheckText("complete", 0)).toBe("Checked · nothing found");
  });

  it("never claims nothing was found when reports exist", () => {
    for (const count of [1, 2, 30]) {
      const text = coverageCheckText("complete", count);
      expect(text).not.toMatch(/nothing found/);
      expect(text).toBe("Checked");
    }
  });

  it("does not invent a per-outlet number the server never sent", () => {
    // The aggregate is 2, but neither box knows whether it found 0, 1 or 2.
    expect(coverageCheckText("complete", 2)).not.toMatch(/\d/);
  });

  it("distinguishes a check that failed from one that found nothing", () => {
    // The whole point of the section: "we looked and found nothing" and "we do
    // not know" must never read the same.
    expect(coverageCheckText("failed", 0)).toBe("Did not finish");
    expect(coverageCheckText("failed", 0)).not.toMatch(/nothing found/);
  });

  it("distinguishes a check that has not run yet", () => {
    expect(coverageCheckText("pending", 0)).toBe("Not run yet");
    expect(coverageCheckText("pending", 0)).not.toMatch(/nothing found/);
  });
});
