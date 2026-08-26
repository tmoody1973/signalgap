import { NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyError, streamStructuredObject } from "../../../convex/ai/provider";

/**
 * The load-bearing pin for Task 3a.
 *
 * `defaultGenerate` moved from `generateObject` to `streamObject`. The whole
 * retry rule in `generateStructured` rests on ONE claim the research flagged as
 * unverified: that `await streamObject(...).object` still rejects with
 * `NoObjectGeneratedError` when the model emits nothing parsable. If it rejects
 * with anything else, `classifyError` returns "fatal" instead of "invalid", the
 * schema-invalid retry never fires, and a broken prompt fails on the first try
 * with the wrong reason in the ledger.
 *
 * No real model is reached: `MockLanguageModelV4` is the AI SDK's own test double.
 */

const schema = z.object({ headline: z.string() });

const textStream = (chunks: string[]) =>
  convertArrayToReadableStream([
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "1" },
    ...chunks.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
    { type: "text-end" as const, id: "1" },
    {
      type: "finish" as const,
      finishReason: { unified: "stop" as const, raw: "end_turn" },
      // LanguageModelV4 NESTS usage: `{ inputTokens: { total } }`, not a flat
      // number. A mock emitting flat numbers reports no usage at all, silently,
      // which would make the usage assertion below pass for the wrong reason.
      usage: {
        inputTokens: { total: 11, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 7, text: undefined, reasoning: undefined },
      },
    },
  ]);

const modelEmitting = (chunks: string[]) =>
  new MockLanguageModelV4({ doStream: async () => ({ stream: textStream(chunks) }) });

const run = (chunks: string[], model = modelEmitting(chunks)) => ({
  model,
  result: streamStructuredObject(model, {
    schema, system: "sys", prompt: "user", abortSignal: AbortSignal.timeout(5_000),
  }),
});

describe("streamStructuredObject", () => {
  it("returns the object and the usage, so GenerateResponse is unchanged", async () => {
    const { result } = run(['{"headline":', '"a vote"}']);
    await expect(result).resolves.toEqual({
      object: { headline: "a vote" },
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it("REJECTS WITH NoObjectGeneratedError when the stream is not parsable", async () => {
    const { result } = run(["this is not json at all"]);
    await expect(result).rejects.toSatisfy((e: unknown) => NoObjectGeneratedError.isInstance(e));
  });

  it("classifyError still calls that 'invalid', which is what the retry rule reads", async () => {
    const { result } = run(["not json"]);
    const error = await result.then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    expect(classifyError(error)).toBe("invalid");
  });

  it("a stream whose JSON does not fit the schema also rejects as invalid", async () => {
    const { result } = run(['{"headline":42}']);
    const error = await result.then(() => null, (e: unknown) => e);
    expect(classifyError(error)).toBe("invalid");
  });

  it("sends effort:low so we stop paying output rates for adaptive thinking", async () => {
    const { model, result } = run(['{"headline":"x"}']);
    await result;
    expect(model.doStreamCalls[0].providerOptions).toEqual({ anthropic: { effort: "low" } });
  });
});
