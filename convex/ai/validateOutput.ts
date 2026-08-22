/**
 * The source-binding guard. Everything a model returns passes through here
 * before anything is written.
 *
 * The rule this file exists to enforce: a model may describe sources we gave it.
 * It may not invent one, invent a quotation, promote a claim to confirmed, or
 * smuggle an executable search back to us.
 *
 * One violation invalidates the WHOLE output. Partial merging is what would let
 * a fabricated citation reach an editor beside real ones.
 */

export type ValidationContext = {
  knownSourceIds: readonly string[];
  /** Verbatim text we stored for each source. A quotation must equal one of these. */
  excerptsBySourceId: Readonly<Record<string, readonly string[]>>;
  /** Sources the DETERMINISTIC layer already classified as confirming. */
  confirmedSourceIds?: readonly string[];
  /** Candidate ids we showed the model. A link to any other is an invention. */
  knownCandidateIds?: readonly string[];
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const ID_FIELD = "sourceResultId";
const IDS_FIELD = "sourceResultIds";
const EXCERPT_FIELDS = ["exactExcerpt", "quotation"] as const;
const CANDIDATE_ID_FIELDS = ["suggestedExistingCandidateId"] as const;

// translated field -> the original-language field that must accompany it.
const TRANSLATION_PAIRS: Record<string, string> = {
  translatedText: "originalLanguageText",
  translatedTitle: "originalTitle",
  translatedSnippet: "originalSnippet",
};

// A model asked for an INTENT must never hand back something executable.
// Colon-operators are how a search parameter would be smuggled through a
// plain-looking term, so they are rejected wherever they appear.
const URL_LIKE = /https?:\/\/|www\.|\b(?:site|inurl|intitle|filetype|cache|related|source|when|before|after)\s*:/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const citedIdsOf = (node: Record<string, unknown>): string[] => {
  const ids: string[] = [];
  const single = node[ID_FIELD];
  if (typeof single === "string") ids.push(single);
  const many = node[IDS_FIELD];
  if (Array.isArray(many)) for (const id of many) if (typeof id === "string") ids.push(id);
  return ids;
};

export function validateAgainstSources(output: unknown, context: ValidationContext): ValidationResult {
  const known = new Set(context.knownSourceIds);
  const confirmed = context.confirmedSourceIds === undefined ? undefined : new Set(context.confirmedSourceIds);
  const knownCandidates = context.knownCandidateIds === undefined ? undefined : new Set(context.knownCandidateIds);
  const errors: string[] = [];

  // `confirmedPath` is true once we are anywhere inside a `confirmedFacts` block,
  // so a nested citation cannot dodge the promotion check by sitting one level down.
  // `inheritedCited` carries the nearest enclosing citation down the tree. A claim
  // nested inside an analyzed result quotes THAT result — it does not repeat the id.
  const walk = (node: unknown, path: string, confirmedPath: boolean, inheritedCited: string[]): void => {
    if (typeof node === "string") {
      if (URL_LIKE.test(node)) errors.push(`${path}: contains an executable URL or search operator`);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`, confirmedPath, inheritedCited));
      return;
    }
    if (!isRecord(node)) return;

    const cited = citedIdsOf(node);
    const effectiveCited = cited.length > 0 ? cited : inheritedCited;
    for (const id of cited) {
      if (!known.has(id)) errors.push(`${path}: cites unknown source id "${id}"`);
    }

    if (confirmedPath && cited.length > 0) {
      for (const id of cited) {
        if (confirmed === undefined || !confirmed.has(id)) {
          errors.push(`${path}: confirmedFacts cites "${id}", which the rules did not classify as confirming`);
        }
      }
    }

    for (const field of EXCERPT_FIELDS) {
      const quoted = node[field];
      if (typeof quoted !== "string") continue;
      if (effectiveCited.length === 0) {
        errors.push(`${path}.${field}: a quotation with no cited source`);
        continue;
      }
      const allowed = effectiveCited.flatMap((id) => context.excerptsBySourceId[id] ?? []);
      if (!allowed.some((stored) => stored === quoted)) {
        errors.push(`${path}.${field}: does not exactly match any stored excerpt of its cited sources`);
      }
    }

    for (const field of CANDIDATE_ID_FIELDS) {
      const suggested = node[field];
      if (typeof suggested !== "string" || suggested.length === 0) continue;
      if (knownCandidates === undefined || !knownCandidates.has(suggested)) {
        errors.push(`${path}.${field}: suggests an unknown candidate id "${suggested}"`);
      }
    }

    for (const [translated, original] of Object.entries(TRANSLATION_PAIRS)) {
      const t = node[translated];
      if (typeof t !== "string" || t.length === 0) continue;
      const o = node[original];
      if (typeof o !== "string" || o.length === 0) {
        errors.push(`${path}.${translated}: a translation with no ${original} beside it`);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === ID_FIELD || key === IDS_FIELD) continue;
      walk(value, path ? `${path}.${key}` : key, confirmedPath || key === "confirmedFacts", effectiveCited);
    }
  };

  walk(output, "", false, []);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
