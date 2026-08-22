import { describe, expect, it } from "vitest";
import type { AiOperation } from "../../../convex/ai/provider";
import { PROMPT_VERSION, buildPrompt } from "../../../convex/ai/prompts";

const OPERATIONS: AiOperation[] = ["analyzeResults", "clusterSignals", "classifyEvidence", "planFollowUp", "generateBrief"];

describe("buildPrompt", () => {
  it("states the non-negotiables to every operation", () => {
    for (const operation of OPERATIONS) {
      const { system } = buildPrompt(operation, {});
      expect(system).toMatch(/you never decide/i);
      expect(system).toMatch(/never invent an ID/i);
      expect(system).toMatch(/never invent a quotation/i);
      expect(system).toMatch(/never write a URL/i);
    }
  });

  it("gives each operation its own instructions", () => {
    const systems = OPERATIONS.map((o) => buildPrompt(o, {}).system);
    expect(new Set(systems).size).toBe(OPERATIONS.length);
  });

  it("tells generateBrief it may not promote a claim to confirmed", () => {
    expect(buildPrompt("generateBrief", {}).system).toMatch(/Do not promote anything/i);
  });

  it("tells classifyEvidence it may not suggest a confirmed fact", () => {
    expect(buildPrompt("classifyEvidence", {}).system).toMatch(/may NOT suggest that anything is a confirmed fact/);
  });

  it("passes the input through as JSON so IDs survive verbatim", () => {
    const { prompt } = buildPrompt("analyzeResults", { sources: [{ sourceResultId: "src_a" }] });
    expect(prompt).toContain('"sourceResultId": "src_a"');
  });

  it("stamps the prompt version that gets stored on the model run", () => {
    expect(buildPrompt("analyzeResults", {}).promptVersion).toBe(PROMPT_VERSION);
  });
});
