import { describe, expect, it } from "vitest";
import { unreadableVerdict } from "../../../convex/editorial/status";

describe("unreadableVerdict", () => {
  it("excludes the candidate and names the real cause", () => {
    const verdict = unreadableVerdict();
    expect(verdict.status).toBe("excluded");
    // The cause is that classification failed. "no judgment" names the
    // consequence, which is what made this lead vanish in the first place.
    expect(verdict.reasons).toEqual(["unreadable_evidence"]);
  });

  it("carries no score, because nothing was judged", () => {
    expect(unreadableVerdict().score).toBeNull();
  });

  it("cannot be a coverage gap", () => {
    // A gap is a claim about the ABSENCE of reporting. We did not read the
    // evidence, so we are in no position to claim anything about coverage.
    expect(unreadableVerdict().label).not.toBe("Coverage gap");
    expect(unreadableVerdict().coverage.passStatus).not.toBe("complete");
  });
});
