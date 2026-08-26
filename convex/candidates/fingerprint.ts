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

/**
 * What a cluster is identified BY.
 *
 * Entity keys when it has any — that is what survives across scans. When it has
 * none, its own member ids stand in. They must: `candidateFingerprint([], beat)`
 * is a CONSTANT, so without this every entity-less cluster would find the first
 * one's candidate on `by_owner_fingerprint` and patch it, turning a whole scan
 * into a single fabricated lead. Ids are unique per cluster, so nothing merges
 * by accident; the cost is that such a candidate can never match a prior scan's.
 *
 * Blank-ish entity keys count as none — `candidateFingerprint` drops them, so
 * `["  "]` would otherwise reach the same constant.
 */
export function clusterIdentityKeys(entityKeys: string[], sourceResultIds: string[]): string[] {
  const keys = entityKeys.filter((k) => normalizeEntityKey(k).length > 0);
  return keys.length > 0 ? keys : sourceResultIds;
}

export function candidateFingerprint(entityKeys: string[], beat: string | null): string {
  const keys = [...new Set(entityKeys.map(normalizeEntityKey).filter((k) => k.length > 0))].sort();
  return `${contentHash(keys)}:${beat ?? "unassigned"}`;
}
