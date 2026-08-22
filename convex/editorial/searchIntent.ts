import { getTemplate, renderQuery, type TemplateId } from "../integrations/serpapi/queryCatalog";
import { MILWAUKEE_LOCATION, type SearchIntent, type SearchSpec } from "../integrations/serpapi/contracts";

export type IntentRejection =
  | "unknown_template" | "purpose_mismatch" | "empty_query"
  | "window_too_wide" | "raw_parameters" | "budget_exhausted" | "unapproved_domain";

export type IntentResult = { ok: true; spec: SearchSpec } | { ok: false; reason: IntentRejection };

export type IntentContext = { now: number; remainingForPurpose: number };

// A model may only supply plain search words. Anything that looks like a URL, a
// query-string parameter, or an operator we did not put in the template is a
// deterministic rejection — not a sanitisation.
const FORBIDDEN_TERM = /[?&=]|https?:\/\/|\bsite:|\binurl:|\bafter:|\bbefore:|[<>]/i;

export function validateSearchIntent(intent: SearchIntent, ctx: IntentContext): IntentResult {
  const template = getTemplate(intent.templateId as TemplateId);
  if (!template) return { ok: false, reason: "unknown_template" };
  if (!template.purposes.includes(intent.purpose)) return { ok: false, reason: "purpose_mismatch" };
  if (ctx.remainingForPurpose <= 0) return { ok: false, reason: "budget_exhausted" };

  const terms = intent.entityTerms ?? [];
  for (const term of terms) {
    if (FORBIDDEN_TERM.test(term)) {
      return { ok: false, reason: term.includes("site:") ? "unapproved_domain" : "raw_parameters" };
    }
  }
  if (template.requiresTerms && terms.length === 0) return { ok: false, reason: "empty_query" };

  const query = renderQuery(template, { now: ctx.now, terms });
  if (query.trim().length === 0) return { ok: false, reason: "empty_query" };

  const windowRank = { current: 0, "7d": 1, "30d": 2 } as const;
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
