import { getTemplate, renderQuery } from "../integrations/serpapi/queryCatalog";
import { MILWAUKEE_LOCATION, type SearchIntent, type SearchSpec } from "../integrations/serpapi/contracts";

export type IntentRejection =
  | "unknown_template" | "purpose_mismatch" | "empty_query"
  | "window_too_wide" | "raw_parameters" | "budget_exhausted" | "unapproved_domain";

export type IntentResult = { ok: true; spec: SearchSpec } | { ok: false; reason: IntentRejection };

export type IntentContext = { now: number; remainingForPurpose: number };

// A model may supply plain search words only. Everything else is rejected, not
// sanitised: an allowlist cannot be out-argued by an operator we failed to imagine.
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const CONTROL = /[\x00-\x1F\x7F]/;
const ALLOWED_TERM = /^[\p{L}\p{N} .,'’\-&/]{1,80}$/u;
const MAX_ENTITY_TERMS = 8;

const normalizeTerm = (term: string) => term.normalize("NFKC").replace(ZERO_WIDTH, "").trim();

export function validateSearchIntent(intent: SearchIntent, ctx: IntentContext): IntentResult {
  const template = getTemplate(intent.templateId);
  if (!template) return { ok: false, reason: "unknown_template" };
  if (!template.purposes.includes(intent.purpose)) return { ok: false, reason: "purpose_mismatch" };
  if (ctx.remainingForPurpose <= 0) return { ok: false, reason: "budget_exhausted" };

  const rawTerms = intent.entityTerms ?? [];
  if (rawTerms.length > MAX_ENTITY_TERMS) return { ok: false, reason: "raw_parameters" };

  // Normalized (not raw) terms are what get checked AND what get rendered into the
  // query — NFKC folds tricks like a fullwidth "site：" colon back to ASCII "site:"
  // so the domain check below still catches it.
  const terms = rawTerms.map(normalizeTerm);
  for (const term of terms) {
    if (CONTROL.test(term)) return { ok: false, reason: "raw_parameters" };
    if (/\bsite:/i.test(term)) return { ok: false, reason: "unapproved_domain" };
    if (!ALLOWED_TERM.test(term)) return { ok: false, reason: "raw_parameters" };
  }
  if (template.requiresTerms && terms.length === 0) return { ok: false, reason: "empty_query" };

  const query = renderQuery(template, { now: ctx.now, terms });
  if (query.trim().length === 0) return { ok: false, reason: "empty_query" };

  const windowRank = { current: 0, "7d": 1, "30d": 2 } as const;
  // ponytail: unreachable with today's catalog — every template's own timeWindow
  // already fits inside its purposes' maxWindowForPurpose. Guards a future template
  // whose declared window exceeds what a purpose is allowed to see.
  if (windowRank[template.timeWindow] > windowRank[template.maxWindowForPurpose[intent.purpose] ?? template.timeWindow]) {
    return { ok: false, reason: "window_too_wide" };
  }

  return {
    ok: true,
    spec: {
      templateId: template.id,
      engine: template.engine,
      purpose: intent.purpose,
      query,
      location: MILWAUKEE_LOCATION,
      language: template.language,
      timeWindow: template.timeWindow,
      candidateId: intent.candidateId,
    },
  };
}
