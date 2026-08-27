import { describe, expect, it } from "vitest";
import { COVERAGE_OUTLETS } from "../../../convex/config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../../convex/config/officialDomains";
import {
  COVERAGE_TEMPLATE_IDS, DISCOVERY_TEMPLATE_IDS, ENRICHMENT_TEMPLATE_IDS, getTemplate, renderQuery,
} from "../../../convex/integrations/serpapi/queryCatalog";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const render = (id: string) => renderQuery(getTemplate(id as never)!, { now: NOW, terms: ["Bronzeville apartments"] });

describe("query catalog", () => {
  it("freezes exactly the 17 discovery template ids (decision 005: Events moved to enrichment; decision 010 added the sports beat)", () => {
    expect([...DISCOVERY_TEMPLATE_IDS]).toEqual([
      "trend-milwaukee-01",
      "news-housing-en-01", "news-transport-en-01", "news-culture-en-01", "news-sports-en-01",
      "reddit-housing-01", "reddit-transport-01", "reddit-culture-01", "reddit-sports-01",
      "search-housing-es-01", "search-transport-es-01", "search-culture-es-01", "search-sports-es-01",
      "official-housing-01", "official-transport-01", "official-culture-01", "official-sports-01",
    ]);
  });

  it("keeps the Google Events templates as enrichment only, absent from discovery (decision 005)", () => {
    expect([...ENRICHMENT_TEMPLATE_IDS]).toEqual(["events-housing-01", "events-transport-01", "events-culture-01", "events-sports-01"]);
    for (const id of ENRICHMENT_TEMPLATE_IDS) {
      expect(getTemplate(id)!.purposes).toEqual(["enrichment"]);
      expect(DISCOVERY_TEMPLATE_IDS).not.toContain(id);
    }
  });

  it("uses one engine per family", () => {
    expect(getTemplate("trend-milwaukee-01")!.engine).toBe("google_trends_trending_now");
    expect(getTemplate("news-housing-en-01")!.engine).toBe("google_news");
    expect(getTemplate("reddit-housing-01")!.engine).toBe("google");
    expect(getTemplate("search-housing-es-01")!.engine).toBe("google");
    expect(getTemplate("events-housing-01")!.engine).toBe("google_events");
    expect(getTemplate("official-housing-01")!.engine).toBe("google");
  });

  it("constrains reddit discovery to indexed r/milwaukee comments with a rolling date", () => {
    const q = render("reddit-housing-01");
    expect(q).toContain("site:reddit.com/r/milwaukee/comments/");
    expect(q).toMatch(/after:2026-08-15/);
  });

  it("marks the Spanish templates as Spanish and the English ones as English", () => {
    expect(getTemplate("search-housing-es-01")!.language).toBe("es");
    expect(getTemplate("news-housing-en-01")!.language).toBe("en");
    expect(render("search-housing-es-01")).toContain("vivienda");
  });

  it("puts every approved official domain in the official templates", () => {
    const q = render("official-housing-01");
    for (const domain of OFFICIAL_DOMAINS) expect(q).toContain(`site:${domain}`);
  });

  it("renders both coverage partitions over the whole frozen catalog, 30 days", () => {
    expect([...COVERAGE_TEMPLATE_IDS]).toEqual(["coverage-general-01", "coverage-community-01"]);
    const general = render("coverage-general-01");
    for (const o of COVERAGE_OUTLETS.general) expect(general).toContain(`site:${o.domain}`);
    const community = render("coverage-community-01");
    for (const o of COVERAGE_OUTLETS.community) expect(community).toContain(`site:${o.domain}`);
    expect(getTemplate("coverage-general-01")!.timeWindow).toBe("30d");
    expect(getTemplate("coverage-community-01")!.timeWindow).toBe("30d");
  });

  it("does not leak one partition's domains into the other", () => {
    const general = render("coverage-general-01");
    for (const o of COVERAGE_OUTLETS.community) expect(general).not.toContain(o.domain);
  });

  it("requires entity terms only where the template has a slot", () => {
    expect(getTemplate("news-housing-en-01")!.requiresTerms).toBe(false);
    expect(getTemplate("coverage-general-01")!.requiresTerms).toBe(true);
    expect(getTemplate("corroborate-entity-01")!.requiresTerms).toBe(true);
  });

  it("renders the news when: operator from the template's own timeWindow", () => {
    expect(render("news-housing-en-01")).toMatch(/ when:7d$/);
  });

  it("every discovery template runs in the 7-day window except the live trend feed", () => {
    for (const id of DISCOVERY_TEMPLATE_IDS) {
      const t = getTemplate(id)!;
      expect(t.timeWindow).toBe(id === "trend-milwaukee-01" ? "current" : "7d");
    }
  });

  it("official-record-entity-01 searches every official domain for a corroboration entity over 30 days", () => {
    const t = getTemplate("official-record-entity-01")!;
    expect(t.engine).toBe("google");
    expect(t.purposes).toContain("corroboration");
    expect(t.requiresTerms).toBe(true);
    expect(t.timeWindow).toBe("30d");
    const q = render("official-record-entity-01");
    for (const domain of OFFICIAL_DOMAINS) expect(q).toContain(`site:${domain}`);
    expect(q).toContain('"Bronzeville apartments"');
  });
});
