export const COVERAGE_CATALOG_VERSION = "2026-08-21.1";

export const COVERAGE_OUTLETS = {
  general: [
    { name: "Milwaukee Journal Sentinel", domain: "jsonline.com" },
    { name: "WUWM", domain: "wuwm.com" },
    { name: "Wisconsin Public Radio", domain: "wpr.org" },
    { name: "Urban Milwaukee", domain: "urbanmilwaukee.com" },
    { name: "Wisconsin Watch", domain: "wisconsinwatch.org" },
    { name: "TMJ4", domain: "tmj4.com" },
    { name: "WISN 12", domain: "wisn.com" },
    { name: "FOX6", domain: "fox6now.com" },
    { name: "CBS 58", domain: "cbs58.com" },
    { name: "WTMJ", domain: "wtmj.com" },
    { name: "Radio Milwaukee", domain: "radiomilwaukee.org" },
    { name: "BizTimes Milwaukee", domain: "biztimes.com" },
  ],
  community: [
    { name: "Milwaukee Neighborhood News Service", domain: "milwaukeenns.org" },
    { name: "Milwaukee Courier", domain: "milwaukeecourier.com" },
    { name: "Milwaukee Community Journal", domain: "communityjournal.net" },
    { name: "101.7 The Truth", domain: "1017truth.com" },
    { name: "Wisconsin Muslim Journal", domain: "wisconsinmuslimjournal.org" },
    { name: "Spanish Journal", domain: "spanishjournal.com" },
    { name: "Wisconsin Latino News", domain: "wilatinonews.com" },
    { name: "El Conquistador", domain: "elconquistadornews.com" },
  ],
} as const;

export type CoverageGroup = keyof typeof COVERAGE_OUTLETS;
export const REQUIRED_COVERAGE_GROUPS: readonly CoverageGroup[] = ["general", "community"];

export function outletGroupForDomain(hostname: string): CoverageGroup | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const group of REQUIRED_COVERAGE_GROUPS) {
    if (COVERAGE_OUTLETS[group].some((o) => host === o.domain || host.endsWith(`.${o.domain}`))) return group;
  }
  return null;
}
