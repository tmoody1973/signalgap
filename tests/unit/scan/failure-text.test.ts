import { describe, expect, it } from "vitest";
import { FAILURE_TEXT, failureText } from "@/lib/failure-text";

/**
 * The scan panel names its failures, which is the right instinct. It named
 * them in code -- "batch 5 invalid_output", "brief: invalid_output" -- which
 * a reporter reads as "this product is broken". These are the translations.
 */
describe("failureText", () => {
  it("writes newsroom English, never a code", () => {
    for (const text of Object.values(FAILURE_TEXT)) {
      expect(text).not.toMatch(/_/);
      expect(text).toMatch(/[.]$/);
      expect(text[0]).toEqual(text[0].toUpperCase());
    }
  });

  it("covers every code the pipeline records on a scan", () => {
    // Grepped from convex/ on 2026-08-30. A new code with no sentence falls
    // back to its raw message (next test), so this list is a floor, not a gate.
    for (const code of [
      "serpapi_error", "analyze_failed", "cluster_failed", "adjudicate_failed",
      "adjudicate_capped", "over_merged", "candidate_step_failed",
      "coverage_partition_failed", "plan_failed",
    ]) {
      expect(FAILURE_TEXT[code]).toBeDefined();
    }
  });

  it("puts the English first and keeps the original as detail", () => {
    const out = failureText("analyze_failed", "2 of 29 analyze batches failed: batch 5 invalid_output");
    expect(out.headline).toBe(FAILURE_TEXT.analyze_failed);
    expect(out.detail).toBe("2 of 29 analyze batches failed: batch 5 invalid_output");
  });

  it("falls back to the raw message for a code it does not know", () => {
    // Never a blank line. A future code reaching an old client shows its
    // message, not nothing.
    const out = failureText("brand_new_code", "something specific happened");
    expect(out.headline).toBe("something specific happened");
    expect(out.detail).toBeNull();
  });
});
