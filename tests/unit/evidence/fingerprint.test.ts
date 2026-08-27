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
    expect(candidateFingerprint(["Harambee", "rezoning"]))
      .toBe(candidateFingerprint(["rezoning", "Harambee"]));
  });

  it("ignores duplicates", () => {
    expect(candidateFingerprint(["Harambee", "Harambee", "rezoning"]))
      .toBe(candidateFingerprint(["Harambee", "rezoning"]));
  });

  it("separates two stories that do not share their entities", () => {
    expect(candidateFingerprint(["Harambee"])).not.toBe(candidateFingerprint(["Bay View"]));
  });

  it("takes no beat at all, so a corrected beat cannot change an identity", () => {
    // Task 4b. The beat used to be half of this string, and `saveJudgment`
    // corrects the beat a moment after formation without ever recomputing the
    // fingerprint. Identity is entity keys only; anything correctable inside it
    // breaks cross-scan continuity the moment it is corrected.
    expect(candidateFingerprint.length).toBe(1);
    expect(candidateFingerprint(["Harambee"])).toMatch(/^[0-9a-f]{8}$/);
  });

  it("drops empty keys instead of letting them change the identity", () => {
    expect(candidateFingerprint(["Harambee", "  "])).toBe(candidateFingerprint(["Harambee"]));
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
    expect(candidateFingerprint(clusterIdentityKeys([], ["src1"])))
      .not.toBe(candidateFingerprint(clusterIdentityKeys([], ["src2"])));
  });

  it("refuses a cluster with nothing to identify it, rather than returning the constant", () => {
    // `candidateFingerprint([])` is the constant this whole helper exists
    // to keep unreachable. form.ts guards it one file away; this keeps the
    // helper honest for the next caller.
    expect(() => clusterIdentityKeys([], [])).toThrow(/no identity/);
    expect(() => clusterIdentityKeys(["Harambee"], [])).toThrow(/no identity/);
  });

  it("gives the same entity-less cluster the same fingerprint on a re-run", () => {
    expect(candidateFingerprint(clusterIdentityKeys([], ["src1", "src2"])))
      .toBe(candidateFingerprint(clusterIdentityKeys([], ["src2", "src1"])));
  });
});
