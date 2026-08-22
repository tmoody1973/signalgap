export const OFFICIAL_DOMAINS = [
  "city.milwaukee.gov",
  "milwaukee.legistar.com",
  "county.milwaukee.gov",
  "milwaukee.granicus.com",
  "mps.milwaukee.k12.wi.us",
  "wisconsinpublicnotices.org",
  "ridemcts.com",
] as const;

export const isOfficialDomain = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
};
