import { contentHash } from "../integrations/serpapi/canonical";

/**
 * A candidate's identity has to survive across scans, or "this lead appeared
 * again on Tuesday" is not a thing we can say. It is built from normalized
 * entity keys plus the beat — never from a title, which rewords constantly.
 */
export function normalizeEntityKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents: rezonificación -> rezonificacion
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation carries no identity
    .replace(/\s+/g, " ")
    .trim();
}

export function candidateFingerprint(entityKeys: string[], beat: string | null): string {
  const keys = [...new Set(entityKeys.map(normalizeEntityKey).filter((k) => k.length > 0))].sort();
  return `${contentHash(keys)}:${beat ?? "unassigned"}`;
}
