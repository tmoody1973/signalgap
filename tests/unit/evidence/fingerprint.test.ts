import { describe, expect, it } from "vitest";
import { candidateFingerprint, normalizeEntityKey } from "../../../convex/candidates/fingerprint";

describe("normalizeEntityKey", () => {
  it("lowercases, trims, and collapses inner whitespace", () => {
    expect(normalizeEntityKey("  Harambee   Neighborhood ")).toBe("harambee neighborhood");
  });

  it("strips accents so a Spanish and English mention of one place agree", () => {
    expect(normalizeEntityKey("rezonificación")).toBe("rezonificacion");
  });

  it("drops punctuation that carries no meaning", () => {
    expect(normalizeEntityKey("N. 3rd St.")).toBe("n 3rd st");
  });

  it("returns the empty string for whitespace only", () => {
    expect(normalizeEntityKey("   ")).toBe("");
  });
});

describe("candidateFingerprint", () => {
  it("is stable no matter what order the entity keys arrive in", () => {
    expect(candidateFingerprint(["Harambee", "rezoning"], "housing"))
      .toBe(candidateFingerprint(["rezoning", "Harambee"], "housing"));
  });

  it("ignores duplicates", () => {
    expect(candidateFingerprint(["Harambee", "Harambee", "rezoning"], "housing"))
      .toBe(candidateFingerprint(["Harambee", "rezoning"], "housing"));
  });

  it("separates two stories that share a beat but not their entities", () => {
    expect(candidateFingerprint(["Harambee"], "housing"))
      .not.toBe(candidateFingerprint(["Bay View"], "housing"));
  });

  it("separates the same entities on different beats", () => {
    expect(candidateFingerprint(["Harambee"], "housing"))
      .not.toBe(candidateFingerprint(["Harambee"], "culture"));
  });

  it("treats a null beat as its own bucket rather than throwing", () => {
    expect(candidateFingerprint(["Harambee"], null)).toMatch(/^[0-9a-f]{8}:/);
  });

  it("drops empty keys instead of letting them change the identity", () => {
    expect(candidateFingerprint(["Harambee", "  "], "housing"))
      .toBe(candidateFingerprint(["Harambee"], "housing"));
  });
});
