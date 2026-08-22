export type Entry = Record<string, unknown>;

export const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

// Never guesses at relative phrasing ("2 hours ago", "4 days ago") — Date.parse
// returns NaN for those and we omit publishedAt rather than invent a timestamp.
export const parseDate = (v: unknown): number | undefined => {
  const s = asString(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
};
