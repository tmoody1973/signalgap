import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject, NoObjectGeneratedError } from "ai";
import type { z } from "zod";

export type AiOperation = "analyzeResults" | "clusterSignals" | "classifyEvidence" | "planFollowUp" | "generateBrief";

export type AiProvider = "anthropic" | "openai";

const TIMEOUT_MS = 120_000;
const MAX_TRANSIENT_RETRIES = 2;

export type GenerateArgs = {
  provider: AiProvider;
  modelId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<unknown>;
  abortSignal: AbortSignal;
};

export type GenerateResponse = {
  object: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
};

/** One call to one provider. Injected in tests so no unit test ever reaches a model. */
export type GenerateFn = (args: GenerateArgs) => Promise<GenerateResponse>;

export type GenerateStructuredArgs<T> = {
  operation: AiOperation;
  schema: z.ZodType<T>;
  schemaVersion: string;
  promptVersion: string;
  system: string;
  prompt: string;
  inputSnapshotHash: string;
  /** Injected in tests; defaults to the AI SDK generateObject. */
  generate?: GenerateFn;
};

export type GenerateOutcome<T> =
  | {
      ok: true; value: T; provider: AiProvider; modelId: string; attempts: number;
      usedFallback: boolean; usage: { inputTokens?: number; outputTokens?: number }; durationMs: number;
    }
  | {
      ok: false; failure: "invalid_output" | "provider_error"; validationErrors: string[];
      provider: AiProvider; modelId: string; attempts: number; usedFallback: boolean; durationMs: number;
    };

// The AI SDK has its own retry loop, but the schema-invalid rule and the
// fallback rule live here and have to be the SAME code the unit tests exercise.
// So maxRetries is 0 and this loop owns every attempt.
const defaultGenerate: GenerateFn = async ({ provider, modelId, system, prompt, schema, abortSignal }) => {
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);
  const result = await generateObject({ model, schema, system, prompt, abortSignal, maxRetries: 0 });
  return {
    object: result.object,
    usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens },
  };
};

type ErrorKind = "transient" | "invalid" | "fatal";

// A model that returned no parsable object is an OUTPUT problem, not a network
// problem — it must consume the one schema-invalid retry, never the transient
// budget, or a broken prompt would quietly cost three calls instead of two.
export function classifyError(error: unknown): ErrorKind {
  if (NoObjectGeneratedError.isInstance?.(error)) return "invalid";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "transient";
  const status = (error as { statusCode?: number; status?: number })?.statusCode
    ?? (error as { status?: number })?.status;
  if (typeof status === "number") return status === 429 || status >= 500 ? "transient" : "fatal";
  // No status at all is a fetch/network failure in practice.
  if (error instanceof TypeError) return "transient";
  return "fatal";
}

const fallbackEnabled = () => process.env.AI_FALLBACK_ENABLED === "true";

export async function generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<GenerateOutcome<T>> {
  const { schema, system, prompt, generate = defaultGenerate } = args;
  const startedAt = Date.now();

  const primaryModel = process.env.AI_PRIMARY_MODEL;
  if (!primaryModel) {
    return {
      ok: false, failure: "provider_error", validationErrors: ["AI_PRIMARY_MODEL is not set"],
      provider: "anthropic", modelId: "", attempts: 0, usedFallback: false, durationMs: 0,
    };
  }

  let provider: AiProvider = "anthropic";
  let modelId = primaryModel;
  let usedFallback = false;
  let attempts = 0;
  let transientRetries = 0;
  let invalidRetryUsed = false;
  let validationErrors: string[] = [];

  const elapsed = () => Date.now() - startedAt;

  const failure = (kind: "invalid_output" | "provider_error"): GenerateOutcome<T> => ({
    ok: false, failure: kind, validationErrors, provider, modelId, attempts, usedFallback,
    durationMs: elapsed(),
  });

  // Two invalid outputs on the primary earn one attempt on the fallback, on the
  // condition that it is enabled AND configured. Outputs are never merged: the
  // fallback attempt either produces the whole value or the call fails.
  const switchToFallback = (): boolean => {
    if (usedFallback || !fallbackEnabled()) return false;
    const fallbackModel = process.env.AI_FALLBACK_MODEL;
    if (!fallbackModel) return false;
    provider = "openai";
    modelId = fallbackModel;
    usedFallback = true;
    invalidRetryUsed = false;
    transientRetries = 0;
    return true;
  };

  // Bounded by construction: every path through the loop either returns, or
  // consumes one of the finite retry budgets.
  for (;;) {
    attempts++;
    let response: GenerateResponse;
    try {
      response = await generate({
        provider, modelId, system, prompt, schema: schema as z.ZodType<unknown>,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const kind = classifyError(error);
      if (kind === "transient") {
        if (transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          continue;
        }
        validationErrors = [error instanceof Error ? error.message : String(error)];
        return failure("provider_error");
      }
      if (kind === "fatal") {
        validationErrors = [error instanceof Error ? error.message : String(error)];
        return failure("provider_error");
      }
      validationErrors = [error instanceof Error ? error.message : String(error)];
      if (!invalidRetryUsed) {
        invalidRetryUsed = true;
        continue;
      }
      if (switchToFallback()) continue;
      return failure("invalid_output");
    }

    const parsed = schema.safeParse(response.object);
    if (parsed.success) {
      return {
        ok: true, value: parsed.data, provider, modelId, attempts, usedFallback,
        usage: response.usage, durationMs: elapsed(),
      };
    }

    validationErrors = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    if (!invalidRetryUsed) {
      invalidRetryUsed = true;
      continue;
    }
    if (switchToFallback()) continue;
    return failure("invalid_output");
  }
}
