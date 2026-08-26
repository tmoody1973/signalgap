import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { GenerateFn } from "../../convex/ai/provider";
import type { Id } from "../../convex/_generated/dataModel";
import { runCoverageStage } from "../../convex/stages/coverage";
import { runEnrichmentStage } from "../../convex/stages/enrichment";
import { runEvidenceStage } from "../../convex/stages/evidence";
import { discoverySpecs, runDiscoveryStage } from "../../convex/stages/discovery";
import { SEARCH_BUDGET } from "../../convex/config/searchBudget";
import { DISCOVERY_TEMPLATE_IDS } from "../../convex/integrations/serpapi/queryCatalog";
import { runCandidateFinalization, runCandidateFormation, runSliceForScan } from "../../convex/slice";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { sliceModelAnswers } from "../fixtures/slice";
import { asUser, fakeFetch, seedFormedCandidate, seedSliceScan, seedUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;

describe("scan workflow", () => {
  it("startScan records the workflow it started", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // A scan with no workflowId is a row nobody is executing. That is exactly
    // the state item 8 exists to remove.
    expect(scan?.workflowId).toEqual(expect.any(String));
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);
  });

  it("refuses a second live scan for the same owner", async () => {
    const t = setup();
    await seedUser(t);
    await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "owner").mutation(api.scans.startScan, {}))
      .rejects.toThrow(/already running/);
  });

  it("cancel marks the scan and leaves the workflow id in place for audit", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.cancelRequestedAt).toEqual(expect.any(Number));
    // Cancelling does NOT erase which workflow ran. An editor asking "what
    // happened to my scan" needs the id to still be there.
    expect(scan?.workflowId).toEqual(expect.any(String));
  });

  it("a stranger cannot cancel someone else's scan", async () => {
    const t = setup();
    await seedUser(t);
    await t.run(async (ctx) => ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW }));
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await expect(asUser(t, "stranger").mutation(api.scans.cancel, { scanId }))
      .rejects.toThrow();
  });
});

describe("scan state transitions", () => {
  it("setStage moves queued to running the first time and records the stage", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.status).toBe("running");
    expect(scan?.stage).toBe("coverage");
  });

  it("recordFailure appends once per purpose+code, not once per occurrence", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.scans.recordFailure, {
        scanId, purpose: "coverage", code: "http_429", message: "rate limited",
      });
    }
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "discovery", code: "http_429", message: "rate limited",
    });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Three rate-limited coverage calls are ONE thing an editor needs told,
    // not three. A different purpose is a different thing.
    expect(scan?.failureSummaries).toHaveLength(2);
    expect(scan?.failureSummaries.map((f) => f.purpose).sort()).toEqual(["coverage", "discovery"]);
  });

  it("finalize with no failures completes the scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.completedAt).toEqual(expect.any(Number));
  });

  it("finalize with named failures ends partial, not completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "http_500", message: "upstream error",
    });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("partial");
  });

  it("finalize NEVER turns a cancelled scan into a completed one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const { status } = await t.mutation(internal.scans.finalize, { scanId });
    expect(status).toBe("canceled");
  });

  it("finalize is safe to call twice and does not move a terminal scan", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const first = await t.mutation(internal.scans.finalize, { scanId });
    const firstCompletedAt = (await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt;
    await t.mutation(internal.scans.recordFailure, {
      scanId, purpose: "coverage", code: "late", message: "arrived after finalize",
    });
    const second = await t.mutation(internal.scans.finalize, { scanId });

    expect(first.status).toBe("completed");
    // A late failure cannot rewrite history. The scan already ended.
    expect(second.status).toBe("completed");
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.completedAt).toBe(firstCompletedAt);
  });

  it("cancelling leaves the scan terminal, so the owner can start another one", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Cancelling the workflow means the workflow will never reach its own
    // finalize. If cancel does not finalize, this scan sits queued forever and
    // startScan's duplicate guard locks the owner out permanently.
    expect(scan?.status).toBe("canceled");
    expect(scan?.completedAt).toEqual(expect.any(Number));

    await expect(asUser(t, "owner").mutation(api.scans.startScan, {})).resolves.toEqual(expect.any(String));
  });

  it("a terminal scan's summary is frozen — late writes cannot change it", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    // A search that was reserved before the scan ended, but is still
    // in-flight (a real HTTP call cannot be aborted) when it does.
    const lateSpec = {
      templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
      query: "Milwaukee housing when:7d", location: "Milwaukee, Wisconsin, United States",
      language: "en", timeWindow: "7d",
    } as const;
    const reserved = await t.mutation(internal.searchRuns.reserve, { scanId, spec: lateSpec });
    const { runId } = reserved as { runId: Id<"searchRuns"> };
    await t.mutation(internal.searchRuns.markRunning, { runId, parameters: {} });

    await t.mutation(internal.scans.finalize, { scanId });
    const atFinalize = await t.run(async (ctx) => ctx.db.get(scanId));

    // The in-flight search resolves AFTER the scan is already terminal.
    await t.mutation(internal.searchRuns.complete, { runId, resultCount: 0, durationMs: 1 });
    // Other late writes arriving after the scan ended must not change the summary either.
    await t.mutation(internal.scans.recordFailure, { scanId, purpose: "coverage", code: "late", message: "arrived after the scan ended" });
    await t.mutation(internal.scans.setCandidateCounts, { scanId, eligibleCount: 9, excludedCount: 9, processingCount: 9 });

    const after = await t.run(async (ctx) => ctx.db.get(scanId));
    // Without the guard, a failure appended after finalize would leave a scan
    // reading "completed" with a failure under it and no Incomplete scan label.
    expect(after!.failureSummaries).toEqual(atFinalize!.failureSummaries);
    expect(after!.eligibleCount).toBe(atFinalize!.eligibleCount);
    // The counter must not move after finalize...
    expect(after!.searchesSucceeded).toBe(atFinalize!.searchesSucceeded);
    expect(after!.status).toBe("completed");

    // ...but the run row itself IS the audit trail, so it must still reach a
    // real terminal status rather than being stranded at "running" forever.
    const lateRun = await t.run(async (ctx) => ctx.db.get(runId));
    expect(lateRun?.status).toBe("succeeded");
  });
});

describe("discovery stage", () => {
  it("renders exactly the 13 frozen templates, once each", () => {
    const specs = discoverySpecs(NOW);
    expect(specs).toHaveLength(13);
    expect(specs.map((s) => s.templateId).sort()).toEqual([...DISCOVERY_TEMPLATE_IDS].sort());
    // Decision 005: Google Events is enrichment now, and must not reappear here.
    expect(specs.some((s) => s.engine === "google_events")).toBe(false);
    for (const spec of specs) {
      expect(spec.purpose).toBe("discovery");
      expect(spec.query.trim().length).toBeGreaterThan(0);
    }
  });

  it("every rendered query is unique, so no two runs share an idempotency key", () => {
    const queries = discoverySpecs(NOW).map((s) => `${s.templateId}|${s.query}`);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("executes all 13 and reserves 13, not 16", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.executed).toBe(13);
    expect(outcome.canceled).toBe(false);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // 16 is the budget CEILING. Spending 13 is the point of decision 005.
    expect(scan?.searchesReserved).toBe(13);
  });

  it("stops before the next search once cancellation is requested", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }),
    );

    expect(outcome.canceled).toBe(true);
    expect(outcome.executed).toBe(0);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    // Not one paid call after the editor said stop.
    expect(scan?.searchesReserved).toBe(0);
  });

  it("a failing search is named on the scan and does not stop the other twelve", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    const failOnSpanish = (async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams.get("q") ?? "";
      if (q.includes("vivienda")) return new Response("upstream boom", { status: 500 });
      return new Response(JSON.stringify({ search_metadata: { id: "x", status: "Success" }, organic_results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const outcome = await t.action(async (ctx) =>
      runDiscoveryStage(ctx, { scanId, now: NOW }, { fetchImpl: failOnSpanish, sleep: async () => {} }),
    );

    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    expect(outcome.succeeded).toBeGreaterThanOrEqual(11);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.failureSummaries.some((f) => f.purpose === "discovery")).toBe(true);
  });

  it("running the stage twice reuses completed runs and reserves nothing new", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});
    const opts = { fetchImpl: fakeFetch(), sleep: async () => {} };

    await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));
    const afterFirst = (await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved;
    const second = await t.action(async (ctx) => runDiscoveryStage(ctx, { scanId, now: NOW }, opts));

    // Resuming a workflow after a restart must not re-buy searches we own.
    expect((await t.run(async (ctx) => ctx.db.get(scanId)))?.searchesReserved).toBe(afterFirst);
    expect(second.skipped).toBe(13);
    expect(second.executed).toBe(0);
  });
});

describe("slice split at the coverage boundary", () => {
  beforeEach(() => {
    process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
    process.env.AI_FALLBACK_ENABLED = "false";
  });

  it("formation stops before evaluation, so coverage can run in between", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);

    const formed = await t.action(async (ctx) => runCandidateFormation(ctx, { scanId, sourceResultIds: sourceIds }, model));
    if (!formed.ok) throw new Error(formed.reason);

    expect(formed.candidates.length).toBeGreaterThan(0);
    const candidate = await t.run(async (ctx) => ctx.db.get(formed.candidates[0].candidateId));
    // Formation writes membership, judgment and the snapshot. It writes NO
    // verdict — status stays at its insert value until the rules run.
    expect(candidate?.status).toBe("processing");
    expect(candidate?.scoreTotal).toBeUndefined();
    expect(candidate?.exclusionReasons).toBeUndefined();
  });

  it("finalization writes the verdict and then the brief, in that order", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);
    const formed = await t.action(async (ctx) => runCandidateFormation(ctx, { scanId, sourceResultIds: sourceIds }, model));
    if (!formed.ok) throw new Error(formed.reason);
    const candidateId = formed.candidates[0].candidateId;

    // Spy on the brief call specifically: read the candidate's live status the
    // instant that generate call fires. If evaluate had not already run, status
    // would still read "processing" — so this fails if the order ever reverses.
    let statusWhenBriefGenerateFired: string | undefined;
    const spyModel: GenerateFn = async (args) => {
      const isBrief = !/Group the supplied signals/.test(args.system) && !/suggest how each piece of evidence/.test(args.system);
      if (isBrief) {
        const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
        statusWhenBriefGenerateFired = candidate?.status;
      }
      return await model(args);
    };

    const outcome = await t.action(async (ctx) =>
      runCandidateFinalization(ctx, { scanId, candidateId, now: NOW }, spyModel),
    );

    expect(outcome.status).toMatch(/eligible|excluded/);
    const candidate = await t.run(async (ctx) => ctx.db.get(candidateId));
    expect(candidate?.status).toBe(outcome.status);
    // The brief is generated against a settled verdict, never a provisional one.
    if (outcome.briefId) {
      const brief = await t.run(async (ctx) => ctx.db.get(outcome.briefId!));
      expect(brief?.version).toBe(1);
    }
    expect(statusWhenBriefGenerateFired).not.toBe("processing");
    expect(statusWhenBriefGenerateFired).toMatch(/eligible|excluded/);
  });

  it("a lead the AI could not read is excluded with an honest reason, not left invisible", async () => {
    const t = setup();
    const { scanId, sourceIds, ids } = await seedSliceScan(t);
    const answers = sliceModelAnswers(ids);
    // The classify answer cites a source id we never showed the model — the
    // source-binding guard (convex/ai/validateOutput.ts) invalidates the WHOLE
    // output for that, so this deterministically fails classification without
    // depending on any particular malformed shape.
    const brokenClassify: GenerateFn = async ({ system }) => {
      if (/Group the supplied signals/.test(system)) return { object: answers.clusterSignals, usage: {} };
      if (/suggest how each piece of evidence/.test(system)) {
        return {
          object: { ...answers.classifyEvidence, items: [{ ...answers.classifyEvidence.items[0], sourceResultIds: ["not-a-real-source-id"] }] },
          usage: {},
        };
      }
      return { object: answers.generateBrief, usage: {} };
    };

    const outcome = await t.action(async (ctx) =>
      runSliceForScan(ctx, { scanId, sourceResultIds: sourceIds, now: NOW }, brokenClassify));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(1);
    const [candidate] = outcome.candidates;

    expect(candidate.failures.some((f) => f.startsWith("classify:"))).toBe(true);
    expect(candidate.status).toBe("excluded");
    // Still no brief — there was no evidence to cite.
    expect(candidate.briefId).toBeNull();

    const dbCandidate = await t.run(async (ctx) => ctx.db.get(candidate.candidateId));
    // This was the bug: a candidate with no judgment used to stay at
    // "processing" forever, invisible in both the feed and the exclusions
    // list. It now gets the rules engine's own honest verdict.
    expect(dbCandidate?.status).toBe("excluded");
    expect(dbCandidate?.exclusionReasons).toEqual(["unreadable_evidence"]);
    expect(dbCandidate?.latestBriefVersion).toBeUndefined();
  });

  it("runEvidenceStage keeps a classify failure in candidates, marked not ready for a brief", async () => {
    const t = setup();
    const { scanId, sourceIds, ids } = await seedSliceScan(t);
    const answers = sliceModelAnswers(ids);
    // Same fixture as the test above, driven through the workflow's own
    // evidence stage instead of the combined runSliceForScan path — this is
    // what proves `readyForVerdict` (convex/stages/evidence.ts) survives on
    // the candidate rather than filtering it out, since nothing at the type
    // level stops a future refactor from dropping it.
    const brokenClassify: GenerateFn = async ({ system }) => {
      if (/Group the supplied signals/.test(system)) return { object: answers.clusterSignals, usage: {} };
      if (/suggest how each piece of evidence/.test(system)) {
        return {
          object: { ...answers.classifyEvidence, items: [{ ...answers.classifyEvidence.items[0], sourceResultIds: ["not-a-real-source-id"] }] },
          usage: {},
        };
      }
      return { object: answers.generateBrief, usage: {} };
    };

    const evidence = await t.action(async (ctx) =>
      runEvidenceStage(ctx, { scanId, sourceResultIds: sourceIds }, brokenClassify));

    expect(evidence.candidates).toHaveLength(1);
    expect(evidence.candidates[0].readyForVerdict).toBe(false);
  });

  it("runEvidenceStage keeps a healthy candidate in candidates, marked ready for a brief", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);

    // The other direction: a wrongly-set flag (e.g. inverted) must not make a
    // healthy, verdict-ready candidate lose its brief.
    const evidence = await t.action(async (ctx) =>
      runEvidenceStage(ctx, { scanId, sourceResultIds: sourceIds }, model));

    expect(evidence.candidates).toHaveLength(1);
    expect(evidence.candidates[0].readyForVerdict).toBe(true);
  });

  it("stops classifying further clusters once shouldContinue turns false, mid-formation", async () => {
    // final-review.md I2: `runClassifyEvidence` runs once PER CLUSTER, so a
    // single check at the top of `runEvidenceStage` leaves an unbounded number
    // of model calls behind it. This proves the per-cluster check in
    // `runCandidateFormation`'s loop itself, the way the enrichment stage's
    // "stops before planning once cancellation is requested" test proves its
    // own per-candidate check — a model call before the second cluster is what
    // this fix removes.
    const t = setup();
    const ownerId = await seedUser(t);
    const { scanId, sourceIdA, sourceIdB } = await t.run(async (ctx) => {
      const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
      const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
      const base = {
        scanId, searchRunId, ownerId,
        engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
        originalLanguage: "en", discoveredAt: NOW, isAccessible: true,
      };
      const sourceIdA = await ctx.db.insert("sourceResults", {
        ...base, canonicalKey: "cluster-a", canonicalUrl: "https://jsonline.com/cluster-a",
        originalUrl: "https://jsonline.com/cluster-a", title: "Cluster A story", snippet: "s-a", contentHash: "h-a",
      });
      const sourceIdB = await ctx.db.insert("sourceResults", {
        ...base, canonicalKey: "cluster-b", canonicalUrl: "https://jsonline.com/cluster-b",
        originalUrl: "https://jsonline.com/cluster-b", title: "Cluster B story", snippet: "s-b", contentHash: "h-b",
      });
      return { scanId, sourceIdA, sourceIdB };
    });

    let classifyCalls = 0;
    const model: GenerateFn = async ({ system, prompt }) => {
      if (/Group the supplied signals/.test(system)) {
        return {
          object: {
            clusters: [
              { sourceResultIds: [sourceIdA], similarityBasis: "Cluster A on its own.", entityKeys: ["a"], suggestedExistingCandidateId: null },
              { sourceResultIds: [sourceIdB], similarityBasis: "Cluster B on its own.", entityKeys: ["b"], suggestedExistingCandidateId: null },
            ],
          },
          usage: {},
        };
      }
      if (/suggest how each piece of evidence/.test(system)) {
        classifyCalls++;
        const cited = /"sourceResultId":\s*"([^"]+)"/.exec(prompt)?.[1] ?? sourceIdA;
        return {
          object: {
            beatSuggestion: "housing", localityBandSuggestion: "area_city_consequence",
            relevanceBandSuggestion: "policy_service_change",
            flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
            items: [{
              sourceResultIds: [cited], kind: "unverified_signal" as const,
              claimText: "A test claim about this cluster.", exactExcerpt: null,
              originalLanguageText: null, translatedText: null,
              sourceTypeSuggestion: "secondary" as const, independenceGroupSuggestion: null,
              relationship: "supports" as const, milwaukeeConnection: "Milwaukee test connection.",
              accessibilityConcern: false, repeatsPressRelease: false, reason: "test reason",
            }],
          },
          usage: {},
        };
      }
      if (/do these two describe the SAME underlying story/.test(system)) {
        // The ambiguous band is adjudicated once, before the cluster loop. Every
        // pair gets a no, so grouping is exactly what the deterministic score said.
        const ids = [...prompt.matchAll(/"pairId":\s*"([^"]+)"/g)].map((m) => m[1]);
        return { object: { verdicts: ids.map((pairId) => ({ pairId, sameStory: false, reason: "Different stories." })) }, usage: {} };
      }
      throw new Error("unexpected prompt in cancellation test");
    };

    // A fake, not the real scan-status plumbing. Two checks run before the first
    // cluster is classified: one guarding the ambiguous-band adjudication call
    // (an editor who cancelled must not pay for it) and one at the top of the
    // cluster loop. So this returns true for those two and false from then on.
    // What it proves is that the loop CALLS this between clusters and stops when
    // told to — `convex/stages/evidence.ts` wires the real check (the same
    // `getForWorkflow` every other stage uses).
    let shouldContinueCalls = 0;
    const shouldContinue = async () => { shouldContinueCalls++; return shouldContinueCalls <= 2; };

    const formed = await t.action(async (ctx) =>
      runCandidateFormation(ctx, { scanId, sourceResultIds: [sourceIdA, sourceIdB] }, model, shouldContinue));

    expect(formed.ok).toBe(true);
    if (!formed.ok) return;
    expect(formed.candidates).toHaveLength(1);
    expect(classifyCalls).toBe(1);
  });

  it("a healthy candidate still reaches finalization and comes back with a real verdict", async () => {
    const t = setup();
    const { scanId, sourceIds, model } = await seedSliceScan(t);

    const outcome = await t.action(async (ctx) =>
      runSliceForScan(ctx, { scanId, sourceResultIds: sourceIds, now: NOW }, model));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(1);
    const [candidate] = outcome.candidates;
    // A wrongly-set readyForVerdict marker would make a healthy candidate
    // vanish from the feed with an unearned "excluded" instead of a verdict.
    expect(candidate.failures).toEqual([]);
    expect(candidate.status).toMatch(/eligible|excluded/);
    expect(candidate.briefId).not.toBeNull();
  });
});

const planAnswer = (intents: unknown[]) => ({ intents });

function planningModel(intents: unknown[]): GenerateFn {
  return async () => ({ object: planAnswer(intents), usage: { inputTokens: 10, outputTokens: 5 } });
}

describe("enrichment stage", () => {
  it("executes an intent the validator approved", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "confirm the approval", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.accepted).toBe(1);
    expect(outcome.executed).toBe(1);
    const runs = await t.run(async (ctx) =>
      ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId).eq("purpose", "corroboration")).collect());
    expect(runs).toHaveLength(1);
  });

  it("refuses an intent carrying operators and executes nothing", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    // "lang:es" is a colon operator the output-level URL/operator guard in
    // validateAgainstSources does not name (it only lists site/inurl/intitle/
    // filetype/cache/related/source/when/before/after), so this reaches
    // validateSearchIntent's own strict character allowlist, which rejects any
    // colon regardless of which word precedes it — the allowlist cannot be
    // out-argued by an operator nobody thought to name.
    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "x", entityTerms: ["lang:es"] }]),
    ));

    // The model asked. The validator said no. Nothing was bought.
    expect(outcome.rejected).toBe(1);
    expect(outcome.executed).toBe(0);
  });

  it("refuses an unknown template id", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "invented-template-99", purpose: "corroboration", desiredSourceFamily: "news", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.rejected).toBe(1);
    expect(outcome.executed).toBe(0);
  });

  it("a scan with no budget left plans nothing at all", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    // Push the scan to the ceiling before planning.
    await t.run(async (ctx) => ctx.db.patch(scanId, { searchesReserved: 120 }));

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.executed).toBe(0);
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("passes the REAL remaining budget, so a model asking for three corroborations with one slot left gets at most one", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    // One slot left of the hard cap — well under the static corroboration
    // allocation of 20. If the stage passed SEARCH_BUDGET.corroboration
    // straight through instead of Math.min-ing it against scan.remaining, all
    // three of these would be accepted.
    await t.run(async (ctx) => ctx.db.patch(scanId, { searchesReserved: SEARCH_BUDGET.hardCap - 1 }));

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([
        { templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "first", entityTerms: ["Metcalfe Park"] },
        { templateId: "official-record-entity-01", purpose: "corroboration", desiredSourceFamily: "official", reason: "second", entityTerms: ["Metcalfe Park"] },
        { templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "third", entityTerms: ["Sherman Park"] },
      ]),
    ));

    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(2);
    expect(outcome.executed).toBeLessThanOrEqual(1);
  });

  it("stops before planning once cancellation is requested", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);
    await asUser(t, "owner").mutation(api.scans.cancel, { scanId });
    // seedFormedCandidate's own classify/cluster calls already wrote modelRuns
    // rows, so the assertion below has to be a delta, not an absolute zero.
    const modelRunsBefore = await t.run(async (ctx) => ctx.db.query("modelRuns").collect());

    const outcome = await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: fakeFetch(), sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    expect(outcome.canceled).toBe(true);
    expect(outcome.plannedFor).toBe(0);
    // A model call is money too. Cancellation stops it before the boundary.
    const modelRunsAfter = await t.run(async (ctx) => ctx.db.query("modelRuns").collect());
    expect(modelRunsAfter).toHaveLength(modelRunsBefore.length);
  });
});

describe("full lifecycle", () => {
  it("walks all four public stages and ends completed", async () => {
    const t = setup();
    await seedUser(t);
    const scanId = await asUser(t, "owner").mutation(api.scans.startScan, {});

    // convex-test does not execute the workflow component, so the lifecycle is
    // driven here in the same order the handler drives it. What this proves is
    // the ORDER and the state transitions; Step 8 proves the real workflow runs.
    await t.mutation(internal.scans.setStage, { scanId, stage: "discovery" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "evidence" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "coverage" });
    await t.mutation(internal.scans.setStage, { scanId, stage: "briefs" });
    const { status } = await t.mutation(internal.scans.finalize, { scanId });

    expect(status).toBe("completed");
    const scan = await t.run(async (ctx) => ctx.db.get(scanId));
    expect(scan?.stage).toBe("briefs");
    // succeeded + failed can never exceed what was authorised.
    expect(scan!.searchesSucceeded + scan!.searchesFailed).toBeLessThanOrEqual(scan!.searchesReserved);
  });

  it("coverage is reserved before any enrichment search", async () => {
    // final-review.md I3: helpers.ts freezes Date.now() (vi.useFakeTimers()),
    // so every `reservedAt` in this test is the SAME number — comparing them
    // cannot tell order apart. Instead, snapshot how many coverage runs exist
    // the instant the FIRST enrichment search actually fires.
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const t = setup();
    const { scanId, candidateId } = await seedFormedCandidate(t);

    await t.action(async (ctx) => runCoverageStage(ctx, { scanId, candidateIds: [candidateId], now: NOW }, { fetchImpl: fakeFetch(), sleep: async () => {} }));

    let coverageRunsAtFirstEnrichmentSearch: number | null = null;
    const countingFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      if (coverageRunsAtFirstEnrichmentSearch === null) {
        const runs = await t.run(async (ctx) =>
          ctx.db.query("searchRuns").withIndex("by_scan_status", (q) => q.eq("scanId", scanId)).collect());
        coverageRunsAtFirstEnrichmentSearch = runs.filter((r) => r.purpose === "coverage").length;
      }
      return fakeFetch()(input);
    }) as typeof fetch;

    await t.action(async (ctx) => runEnrichmentStage(
      ctx, { scanId, candidateIds: [candidateId], now: NOW },
      { fetchImpl: countingFetch, sleep: async () => {} },
      planningModel([{ templateId: "corroborate-entity-01", purpose: "corroboration", desiredSourceFamily: "news", reason: "x", entityTerms: ["Metcalfe Park"] }]),
    ));

    // spec.md > Search budget: "Required coverage capacity is reserved before
    // optional Maps or YouTube enrichment." Both coverage partitions (general,
    // community) must already exist before the first enrichment search fires.
    expect(coverageRunsAtFirstEnrichmentSearch).toBe(2);
  });
});
