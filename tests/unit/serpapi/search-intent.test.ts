import { describe, expect, it } from "vitest";
import { validateSearchIntent } from "../../../convex/editorial/searchIntent";

const ctx = { now: 1_800_000_000_000, remainingForPurpose: 5 };

describe("validateSearchIntent", () => {
  it("accepts a known template and returns an approved spec", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "discovery", reason: "beat sweep" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.engine).toBe("google_news");
    expect(r.spec.location).toBe("Milwaukee, Wisconsin, United States");
    expect(r.spec.timeWindow).toBe("7d");
    expect(r.spec.query.length).toBeGreaterThan(0);
  });

  it("rejects an unknown template", () => {
    const r = validateSearchIntent({ templateId: "make-something-up", purpose: "discovery", reason: "x" }, ctx);
    expect(r).toEqual({ ok: false, reason: "unknown_template" });
  });

  it("rejects a purpose the template was not registered for", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "coverage", reason: "x" }, ctx);
    expect(r).toEqual({ ok: false, reason: "purpose_mismatch" });
  });

  it("rejects when the purpose has no budget left", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "discovery", reason: "x" }, { ...ctx, remainingForPurpose: 0 });
    expect(r).toEqual({ ok: false, reason: "budget_exhausted" });
  });

  it("rejects raw SerpApi parameters smuggled through entity terms", () => {
    const r = validateSearchIntent(
      { templateId: "news-housing-en-01", purpose: "discovery", reason: "x", entityTerms: ["&api_key=abc"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "raw_parameters" });
  });

  it("rejects a URL smuggled through entity terms", () => {
    const r = validateSearchIntent(
      { templateId: "news-housing-en-01", purpose: "discovery", reason: "x", entityTerms: ["https://example.com/x"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "raw_parameters" });
  });

  it("rejects an entity term naming a domain outside the approved sets", () => {
    const r = validateSearchIntent(
      { templateId: "official-housing-01", purpose: "discovery", reason: "x", entityTerms: ["site:example.com"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "unapproved_domain" });
  });

  it("rejects an empty entity term list that renders an empty query", () => {
    const r = validateSearchIntent({ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: [] }, ctx);
    expect(r).toEqual({ ok: false, reason: "empty_query" });
  });
});
