import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { SEARCH_BUDGET } from "../config/searchBudget";
import { validateSearchIntent, type IntentRejection } from "../editorial/searchIntent";
import type { SearchPurpose, SearchSpec } from "../integrations/serpapi/contracts";
import { SCHEMA_VERSION, planFollowUpOutput, type PlanFollowUpOutput } from "./contracts";
import type { GenerateFn } from "./provider";
import { runAiOperation } from "./runOperation";

/**
 * The model proposes INTENTS. It never proposes a search.
 *
 * An intent names a frozen template id and plain entity terms. There is no field
 * for a URL and no field for a SerpApi parameter, so there is nothing to sanitise
 * — `validateSearchIntent` either maps the intent onto an approved template or
 * rejects it with a reason. Both outcomes are returned, because being able to
 * show the rejection is the point.
 */

export type PlannedIntent =
  | { accepted: true; templateId: string; purpose: SearchPurpose; reason: string; spec: SearchSpec }
  | { accepted: false; templateId: string; purpose: SearchPurpose; reason: string; rejection: IntentRejection };

export type PlanArgs = {
  scanId: Id<"scans">;
  candidateId: Id<"candidates">;
  beat: "housing" | "transportation" | "culture" | null;
  gaps: string[];
  priorTemplateIds: string[];
  remainingBudget?: { discovery: number; coverage: number; corroboration: number; enrichment: number };
  now?: number;
};

export type PlanOutcome =
  | { ok: true; intents: PlannedIntent[]; accepted: number; rejected: number; modelRunId: Id<"modelRuns"> }
  | { ok: false; reason: string; errors: string[] };

const DEFAULT_BUDGET = {
  discovery: SEARCH_BUDGET.discovery, coverage: SEARCH_BUDGET.coverage,
  corroboration: SEARCH_BUDGET.corroboration, enrichment: SEARCH_BUDGET.enrichment,
};

export async function runPlanFollowUp(
  ctx: ActionCtx,
  { scanId, candidateId, beat, gaps, priorTemplateIds, remainingBudget = DEFAULT_BUDGET, now = Date.now() }: PlanArgs,
  generate?: GenerateFn,
): Promise<PlanOutcome> {
  const input = { candidateId: candidateId as string, beat, gaps, priorTemplateIds, remainingBudget };

  const result = await runAiOperation<PlanFollowUpOutput>(ctx, {
    scanId, candidateId, operation: "planFollowUp", input,
    outputSchema: planFollowUpOutput, schemaVersion: SCHEMA_VERSION,
    // No sources are supplied to this operation, so nothing may be cited. The URL
    // and operator guard inside validateAgainstSources still applies to every
    // string, which is what catches an intent carrying https:// or api_key=.
    validation: { knownSourceIds: [], excerptsBySourceId: {} },
    generate,
  });
  if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };

  // A purpose's remaining budget shrinks as intents in this batch are accepted,
  // so a model asking for six corroborations when two are left gets two.
  const remaining = { ...remainingBudget };
  const intents: PlannedIntent[] = result.value.intents.map((intent) => {
    const validated = validateSearchIntent(
      { templateId: intent.templateId, purpose: intent.purpose, reason: intent.reason, candidateId, entityTerms: intent.entityTerms },
      { now, remainingForPurpose: remaining[intent.purpose] ?? 0 },
    );
    if (!validated.ok) {
      return { accepted: false, templateId: intent.templateId, purpose: intent.purpose, reason: intent.reason, rejection: validated.reason };
    }
    remaining[intent.purpose] = (remaining[intent.purpose] ?? 0) - 1;
    return { accepted: true, templateId: intent.templateId, purpose: intent.purpose, reason: intent.reason, spec: validated.spec };
  });

  return {
    ok: true,
    intents,
    accepted: intents.filter((i) => i.accepted).length,
    rejected: intents.filter((i) => !i.accepted).length,
    modelRunId: result.modelRunId,
  };
}

export const plan = internalAction({
  args: {
    scanId: v.id("scans"),
    candidateId: v.id("candidates"),
    beat: v.union(v.literal("housing"), v.literal("transportation"), v.literal("culture"), v.null()),
    gaps: v.array(v.string()),
    priorTemplateIds: v.array(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true), modelRunId: v.id("modelRuns"),
      accepted: v.number(), rejected: v.number(),
      // The rejected ones travel too — an editor seeing what the model asked for
      // and was refused is the demonstration that the boundary exists.
      log: v.array(v.object({
        accepted: v.boolean(), templateId: v.string(), purpose: v.string(),
        reason: v.string(), rejection: v.optional(v.string()),
      })),
    }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const outcome = await runPlanFollowUp(ctx, args);
    if (!outcome.ok) return { ok: false as const, reason: outcome.reason, errors: outcome.errors };
    return {
      ok: true as const, modelRunId: outcome.modelRunId,
      accepted: outcome.accepted, rejected: outcome.rejected,
      log: outcome.intents.map((i) => ({
        accepted: i.accepted, templateId: i.templateId, purpose: i.purpose, reason: i.reason,
        rejection: i.accepted ? undefined : i.rejection,
      })),
    };
  },
});
