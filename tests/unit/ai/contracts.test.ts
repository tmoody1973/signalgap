import { describe, expect, it } from "vitest";
import {
  MAX_CLAIM, MAX_INTERVIEW_QUESTION, MAX_REASON, OPERATION_SCHEMAS,
  classifyEvidenceOutput, generateBriefOutput, planFollowUpOutput, stripNulls,
} from "../../../convex/ai/contracts";

const validClassifyItem = {
  sourceResultIds: ["src_a"],
  kind: "unverified_signal" as const,
  claimText: "The board is scheduled to vote on the rezoning.",
  exactExcerpt: null,
  originalLanguageText: null,
  translatedText: null,
  sourceTypeSuggestion: "secondary" as const,
  independenceGroupSuggestion: null,
  relationship: "supports" as const,
  milwaukeeConnection: "The parcel is in Milwaukee's Harambee neighborhood.",
  accessibilityConcern: false,
  repeatsPressRelease: false,
  reason: "One local outlet reported the agenda item.",
};

const validClassify = {
  beatSuggestion: "housing" as const,
  localityBandSuggestion: "direct_city" as const,
  relevanceBandSuggestion: "policy_service_change" as const,
  flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
  items: [validClassifyItem],
};

describe("operation schemas", () => {
  it("covers exactly the five approved operations", () => {
    expect(Object.keys(OPERATION_SCHEMAS).sort()).toEqual([
      "analyzeResults", "classifyEvidence", "clusterSignals", "generateBrief", "planFollowUp",
    ]);
  });

  it("accepts a well-formed classifyEvidence output", () => {
    expect(classifyEvidenceOutput.safeParse(validClassify).success).toBe(true);
  });
});

describe("the model cannot mark a fact confirmed", () => {
  it("rejects confirmed_fact as a suggested evidence kind", () => {
    const out = { ...validClassify, items: [{ ...validClassifyItem, kind: "confirmed_fact" }] };
    expect(classifyEvidenceOutput.safeParse(out).success).toBe(false);
  });

  it("rejects any evidence kind outside the four suggestible ones", () => {
    const out = { ...validClassify, items: [{ ...validClassifyItem, kind: "definitely_true" }] };
    expect(classifyEvidenceOutput.safeParse(out).success).toBe(false);
  });
});

describe("enum fields only accept the schema's literals", () => {
  it("rejects an unknown locality band", () => {
    expect(classifyEvidenceOutput.safeParse({ ...validClassify, localityBandSuggestion: "somewhat_local" }).success).toBe(false);
  });

  it("rejects an unknown beat", () => {
    expect(classifyEvidenceOutput.safeParse({ ...validClassify, beatSuggestion: "sports" }).success).toBe(false);
  });

  it("rejects an unknown search purpose", () => {
    const out = { intents: [{ templateId: "t", purpose: "reconnaissance", desiredSourceFamily: "news", entityTerms: [], reason: "r" }] };
    expect(planFollowUpOutput.safeParse(out).success).toBe(false);
  });
});

describe("length ceilings", () => {
  it("rejects a claim over the limit and accepts one at it", () => {
    const atLimit = { ...validClassify, items: [{ ...validClassifyItem, claimText: "x".repeat(MAX_CLAIM) }] };
    const over = { ...validClassify, items: [{ ...validClassifyItem, claimText: "x".repeat(MAX_CLAIM + 1) }] };
    expect(classifyEvidenceOutput.safeParse(atLimit).success).toBe(true);
    expect(classifyEvidenceOutput.safeParse(over).success).toBe(false);
  });

  it("rejects a reason over the limit", () => {
    const over = { ...validClassify, items: [{ ...validClassifyItem, reason: "x".repeat(MAX_REASON + 1) }] };
    expect(classifyEvidenceOutput.safeParse(over).success).toBe(false);
  });

  it("rejects an interview question over the limit", () => {
    const brief = {
      reportingQuestion: "q", whySurfaced: "w",
      confirmedFacts: [], unverifiedClaims: [], conflicts: [], existingCoverage: [], potentialHumanSources: [],
      interviewQuestions: ["x".repeat(MAX_INTERVIEW_QUESTION + 1)],
    };
    expect(generateBriefOutput.safeParse(brief).success).toBe(false);
  });
});

describe("a source-bound block must actually be bound", () => {
  it("rejects a confirmed fact citing no source", () => {
    const brief = {
      reportingQuestion: "q", whySurfaced: "w",
      confirmedFacts: [{ text: "t", sourceResultIds: [], exactExcerpt: null }],
      unverifiedClaims: [], conflicts: [], existingCoverage: [], potentialHumanSources: [],
      interviewQuestions: [],
    };
    expect(generateBriefOutput.safeParse(brief).success).toBe(false);
  });

  it("rejects a cluster with no member result", () => {
    const out = { clusters: [{ sourceResultIds: [], similarityBasis: "b", entityKeys: [], suggestedExistingCandidateId: null }] };
    expect(OPERATION_SCHEMAS.clusterSignals.output.safeParse(out).success).toBe(false);
  });
});

describe("planFollowUp output has no place to put an executable search", () => {
  it("has no url or parameters field on an intent", () => {
    const out = {
      intents: [{
        templateId: "official-record-entity-01", purpose: "corroboration", desiredSourceFamily: "official",
        entityTerms: ["Harambee"], reason: "need the official record",
        url: "https://serpapi.com/search?q=x", parameters: { q: "x" },
      }],
    };
    const parsed = planFollowUpOutput.safeParse(out);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Zod strips what the schema does not declare, so the smuggled fields never survive.
    expect(parsed.data.intents[0]).not.toHaveProperty("url");
    expect(parsed.data.intents[0]).not.toHaveProperty("parameters");
  });
});

describe("stripNulls", () => {
  it("drops nulls so Convex optionals work, and leaves everything else alone", () => {
    expect(stripNulls({ a: 1, b: null, c: { d: null, e: "x" }, f: [{ g: null, h: 2 }] }))
      .toEqual({ a: 1, c: { e: "x" }, f: [{ h: 2 }] });
  });

  it("does not drop false, zero, or the empty string", () => {
    expect(stripNulls({ a: false, b: 0, c: "" })).toEqual({ a: false, b: 0, c: "" });
  });
});
