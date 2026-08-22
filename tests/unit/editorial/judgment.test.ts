import { describe, expect, it } from "vitest";
import { deterministicLocality, resolveJudgment } from "../../../convex/editorial/judgment";

describe("deterministicLocality — decision 004's deterministic path", () => {
  it("returns direct_city with basis deterministic when an official Milwaukee domain is among the sources", () => {
    const judged = deterministicLocality(["example.com", "city.milwaukee.gov"]);
    expect(judged).not.toBeNull();
    expect(judged?.value).toBe("direct_city");
    expect(judged?.basis).toBe("deterministic");
    expect(judged?.reason).toContain("city.milwaukee.gov");
  });

  it("matches a subdomain of an official domain", () => {
    expect(deterministicLocality(["records.city.milwaukee.gov"])?.value).toBe("direct_city");
  });

  it("ignores case and a www prefix", () => {
    expect(deterministicLocality(["WWW.County.Milwaukee.GOV"])?.value).toBe("direct_city");
  });

  it("returns null when no source is on an official domain", () => {
    expect(deterministicLocality(["jsonline.com", "reddit.com"])).toBeNull();
  });

  it("returns null for no sources at all", () => {
    expect(deterministicLocality([])).toBeNull();
  });

  it("is not fooled by an official domain appearing as a subdomain of somewhere else", () => {
    expect(deterministicLocality(["city.milwaukee.gov.evil.com"])).toBeNull();
  });
});

describe("resolveJudgment — editor beats AI beats rule, and the basis always travels", () => {
  const rule = { value: "direct_city" as const, basis: "deterministic" as const, reason: "official domain" };

  it("uses the deterministic answer and ignores the AI suggestion", () => {
    const judged = resolveJudgment(rule, "none" as const, null, "the model thought it was out of town");
    expect(judged).toEqual(rule);
  });

  it("uses the AI suggestion when no rule applies", () => {
    const judged = resolveJudgment(null, "county_city_effect" as const, null, "county budget affects city services");
    expect(judged).toEqual({
      value: "county_city_effect",
      basis: "ai_suggested",
      reason: "county budget affects city services",
    });
  });

  it("lets an editor override the deterministic answer", () => {
    const judged = resolveJudgment(rule, "none" as const, "area_city_consequence" as const, "model reason");
    expect(judged?.value).toBe("area_city_consequence");
    expect(judged?.basis).toBe("editor");
  });

  it("lets an editor override an AI suggestion", () => {
    const judged = resolveJudgment(null, "none" as const, "direct_city" as const, "model reason");
    expect(judged?.basis).toBe("editor");
  });

  it("returns null when nothing set the field", () => {
    expect(resolveJudgment(null, null, null, "")).toBeNull();
  });

  it("never returns a value without a basis", () => {
    const cases = [
      resolveJudgment(rule, null, null, ""),
      resolveJudgment(null, "none" as const, null, "r"),
      resolveJudgment(null, null, "none" as const, ""),
    ];
    for (const judged of cases) {
      expect(judged).not.toBeNull();
      expect(["deterministic", "ai_suggested", "editor"]).toContain(judged?.basis);
    }
  });
});
