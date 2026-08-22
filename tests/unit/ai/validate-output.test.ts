import { describe, expect, it } from "vitest";
import { validateAgainstSources } from "../../../convex/ai/validateOutput";

const KNOWN = ["src_a", "src_b", "src_c"];
const EXCERPTS = {
  src_a: ["The board voted 9-4 to approve the rezoning.", "Second stored excerpt from A."],
  src_b: ["Riders reported 40-minute waits on the 30X."],
  src_c: [],
};

const ctx = { knownSourceIds: KNOWN, excerptsBySourceId: EXCERPTS };

describe("validateAgainstSources — rule 1: every cited ID was supplied", () => {
  it("accepts an output that cites only supplied IDs", () => {
    const out = { items: [{ sourceResultIds: ["src_a", "src_b"], claimText: "x" }] };
    expect(validateAgainstSources(out, ctx)).toEqual({ ok: true });
  });

  it("rejects the ENTIRE output when one ID is unknown", () => {
    const out = {
      items: [
        { sourceResultIds: ["src_a"], claimText: "fine" },
        { sourceResultIds: ["src_a", "src_INVENTED"], claimText: "bad" },
      ],
    };
    const result = validateAgainstSources(out, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("src_INVENTED");
  });

  it("checks the singular sourceResultId field too", () => {
    const result = validateAgainstSources({ items: [{ sourceResultId: "src_nope" }] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("finds unknown IDs nested arbitrarily deep", () => {
    const out = { a: { b: [{ c: { sourceResultIds: ["src_ghost"] } }] } };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });
});

describe("validateAgainstSources — rule 2: a quotation matches a stored excerpt exactly", () => {
  it("accepts an exact character-for-character match from a cited source", () => {
    const out = {
      items: [{ sourceResultIds: ["src_a"], exactExcerpt: "The board voted 9-4 to approve the rezoning." }],
    };
    expect(validateAgainstSources(out, ctx)).toEqual({ ok: true });
  });

  it("rejects a quotation that differs by a single character", () => {
    const out = {
      items: [{ sourceResultIds: ["src_a"], exactExcerpt: "The board voted 9–4 to approve the rezoning." }],
    };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("rejects a quotation that is real but belongs to a source this block did not cite", () => {
    const out = {
      items: [{ sourceResultIds: ["src_a"], exactExcerpt: "Riders reported 40-minute waits on the 30X." }],
    };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("allows a null quotation", () => {
    expect(validateAgainstSources({ items: [{ sourceResultIds: ["src_a"], exactExcerpt: null }] }, ctx)).toEqual({ ok: true });
  });

  it("rejects a quotation on a block that cites no source at all", () => {
    expect(validateAgainstSources({ items: [{ exactExcerpt: "anything" }] }, ctx).ok).toBe(false);
  });
});

describe("validateAgainstSources — rule 4: the model cannot promote a fact to confirmed", () => {
  const confirmedCtx = { ...ctx, confirmedSourceIds: ["src_a"] };

  it("accepts a confirmedFacts block citing only deterministically confirmed sources", () => {
    const out = { confirmedFacts: [{ text: "t", sourceResultIds: ["src_a"] }] };
    expect(validateAgainstSources(out, confirmedCtx)).toEqual({ ok: true });
  });

  it("rejects a confirmedFacts block citing a source the rules never confirmed", () => {
    const out = { confirmedFacts: [{ text: "t", sourceResultIds: ["src_a", "src_b"] }] };
    const result = validateAgainstSources(out, confirmedCtx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("src_b");
  });

  it("rejects any confirmedFacts block when no source was confirmed", () => {
    const out = { confirmedFacts: [{ text: "t", sourceResultIds: ["src_a"] }] };
    expect(validateAgainstSources(out, { ...ctx, confirmedSourceIds: [] }).ok).toBe(false);
  });

  it("leaves unverifiedClaims alone — those may cite any supplied source", () => {
    const out = { unverifiedClaims: [{ text: "t", sourceResultIds: ["src_b"] }] };
    expect(validateAgainstSources(out, confirmedCtx)).toEqual({ ok: true });
  });
});

describe("validateAgainstSources — rule 5: no translation without its original", () => {
  it("accepts a translation beside its original", () => {
    const out = { items: [{ sourceResultIds: ["src_a"], originalLanguageText: "Se aprobó.", translatedText: "It was approved." }] };
    expect(validateAgainstSources(out, ctx)).toEqual({ ok: true });
  });

  it("rejects a translation with no original", () => {
    const out = { items: [{ sourceResultIds: ["src_a"], originalLanguageText: null, translatedText: "It was approved." }] };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("rejects a translated title with no original title", () => {
    const out = { items: [{ sourceResultIds: ["src_a"], translatedTitle: "Approved" }] };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("accepts an original with no translation", () => {
    const out = { items: [{ sourceResultIds: ["src_a"], originalLanguageText: "Se aprobó.", translatedText: null }] };
    expect(validateAgainstSources(out, ctx)).toEqual({ ok: true });
  });
});

describe("validateAgainstSources — no executable URL may appear anywhere", () => {
  it("rejects a URL hidden in a reason string", () => {
    const out = { intents: [{ reason: "check https://serpapi.com/search?q=x" }] };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("rejects a bare search operator that would smuggle a parameter", () => {
    const out = { intents: [{ entityTerms: ["site:example.com"] }] };
    expect(validateAgainstSources(out, ctx).ok).toBe(false);
  });

  it("reports every problem it found, not just the first", () => {
    const out = { items: [{ sourceResultIds: ["src_x", "src_y"] }] };
    const result = validateAgainstSources(out, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });
});
