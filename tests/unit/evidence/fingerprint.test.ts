import { describe, expect, it } from "vitest";
import { candidateFingerprint, clusterIdentityKeys, normalizeEntityKey } from "../../../convex/candidates/fingerprint";

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

describe("clusterIdentityKeys", () => {
  it("uses the entity keys when the cluster has any", () => {
    expect(clusterIdentityKeys(["Harambee"], ["src1", "src2"])).toEqual(["Harambee"]);
  });

  it("falls back to the cluster's own source ids when it has none", () => {
    expect(clusterIdentityKeys([], ["src1", "src2"])).toEqual(["src1", "src2"]);
  });

  it("treats blank-ish entity keys as none, because candidateFingerprint drops them", () => {
    expect(clusterIdentityKeys(["  ", "!!"], ["src1"])).toEqual(["src1"]);
  });

  it("gives two entity-less clusters different fingerprints", () => {
    expect(candidateFingerprint(clusterIdentityKeys([], ["src1"]), "housing"))
      .not.toBe(candidateFingerprint(clusterIdentityKeys([], ["src2"]), "housing"));
  });

  it("gives the same entity-less cluster the same fingerprint on a re-run", () => {
    expect(candidateFingerprint(clusterIdentityKeys([], ["src1", "src2"]), "housing"))
      .toBe(candidateFingerprint(clusterIdentityKeys([], ["src2", "src1"]), "housing"));
  });
});
