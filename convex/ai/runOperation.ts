import type { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { contentHash } from "../integrations/serpapi/canonical";
import { buildPrompt } from "./prompts";
import type { AiOperation, GenerateFn } from "./provider";
import { generateStructured } from "./provider";
import type { ValidationContext } from "./validateOutput";
import { validateAgainstSources } from "./validateOutput";

/**
 * The one path every AI operation takes: log the run, ask the model, check the
 * answer against the sources we supplied, then either persist or store a failure.
 *
 * Nothing here decides anything. It only decides whether the model's answer is
 * allowed to exist.
 */

export type RunAiOperationArgs<T> = {
  scanId: Id<"scans">;
  candidateId?: Id<"candidates">;
  operation: AiOperation;
  input: unknown;
  outputSchema: z.ZodType<T>;
  schemaVersion: string;
  validation: ValidationContext;
  /** Injected in tests so no test reaches a real model. */
  generate?: GenerateFn;
};

export type RunAiOperationResult<T> =
  | { ok: true; value: T; modelRunId: Id<"modelRuns"> }
  | { ok: false; reason: "invalid_output" | "provider_error" | "scan_not_found"; errors: string[]; modelRunId?: Id<"modelRuns"> };

export async function runAiOperation<T>(
  ctx: ActionCtx,
  args: RunAiOperationArgs<T>,
): Promise<RunAiOperationResult<T>> {
  const { scanId, candidateId, operation, input, outputSchema, schemaVersion, validation, generate } = args;

  const primaryModel = process.env.AI_PRIMARY_MODEL;
  if (!primaryModel) return { ok: false, reason: "provider_error", errors: ["AI_PRIMARY_MODEL is not configured"] };

  const { system, prompt, promptVersion } = buildPrompt(operation, input);
  const inputSnapshotHash = contentHash([JSON.stringify(input)]);

  const created = await ctx.runMutation(internal.modelRuns.create, {
    scanId, candidateId, operation,
    provider: "anthropic", modelId: primaryModel,
    promptVersion, schemaVersion, inputSnapshotHash, attempt: 1,
  });
  if ("rejected" in created) return { ok: false, reason: "scan_not_found", errors: ["scan not found"] };
  const primaryRunId = created.runId;

  const outcome = await generateStructured<T>({
    operation, schema: outputSchema, schemaVersion, promptVersion,
    system, prompt, inputSnapshotHash, generate,
  });

  // A fallback attempt is a different model answering the same question, so it
  // gets its own row linked back to the primary. Two models' answers are never
  // merged, and the record has to show which one produced what shipped.
  let runId = primaryRunId;
  if (outcome.usedFallback) {
    await ctx.runMutation(internal.modelRuns.invalidate, {
      runId: primaryRunId, status: "invalid",
      validationErrors: ["the primary model returned two schema-invalid outputs"],
      durationMs: outcome.durationMs,
    });
    const fallbackRun = await ctx.runMutation(internal.modelRuns.create, {
      scanId, candidateId, operation,
      provider: outcome.provider, modelId: outcome.modelId,
      promptVersion, schemaVersion, inputSnapshotHash, attempt: outcome.attempts,
      fallbackFromRunId: primaryRunId,
      fallbackReason: "two schema-invalid outputs on the primary model",
    });
    if ("rejected" in fallbackRun) return { ok: false, reason: "scan_not_found", errors: ["scan not found"] };
    runId = fallbackRun.runId;
  }

  if (!outcome.ok) {
    await ctx.runMutation(internal.modelRuns.invalidate, {
      runId,
      status: outcome.failure === "invalid_output" ? "invalid" : "failed",
      validationErrors: outcome.validationErrors,
      durationMs: outcome.durationMs,
    });
    return { ok: false, reason: outcome.failure, errors: outcome.validationErrors, modelRunId: runId };
  }

  // The schema said the shape is right. This says the CONTENT is ours: real
  // source IDs, real quotations, nothing promoted, no URL smuggled back.
  const bound = validateAgainstSources(outcome.value, validation);
  if (!bound.ok) {
    await ctx.runMutation(internal.modelRuns.invalidate, {
      runId, status: "invalid", validationErrors: bound.errors, durationMs: outcome.durationMs,
      inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
    });
    return { ok: false, reason: "invalid_output", errors: bound.errors, modelRunId: runId };
  }

  await ctx.runMutation(internal.modelRuns.complete, {
    runId, durationMs: outcome.durationMs,
    inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
  });
  return { ok: true, value: outcome.value, modelRunId: runId };
}
