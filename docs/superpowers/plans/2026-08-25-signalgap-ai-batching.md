# SignalGap Evidence Pipeline Repair (unblocks checklist item 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the evidence stage actually work. The first live Milwaukee scan (2026-08-25) returned 294 real source results and produced **zero leads**. This plan fixes the three defects behind that — none of which is the one the first draft of this plan named.

**Status:** Task 1 is COMPLETE. Tasks 2–9 are NOT approved.

**Supersedes** the 2026-08-25 morning draft of this file, which was written before the measurement and before the Claude API reference was read. That draft recommended batches of 25; **a batch of 25 is measured at 195 s and breaches the 120 s timeout.** It would have shipped a bug.

**Linear:** MOO-736 (item 10) is blocked by this.

**Research:** `.superpowers/sdd/2026-08-25-signalgap-ai-batching/` — `task-1-report.md` (measurements), `research-anthropic.md`, `research-clustering.md`. Every number below traces to one of those.

---

## What is actually wrong — three defects, not one

Scan `k1781cvj03wmdd2bgz4ks2rzbh8d4ze8`, 2026-08-25. 13/13 searches succeeded, 0 failed, 294 real results stored, 13 of 120 budget used. Then:

### Defect 1 — `analyzeResults` cannot fit in one call

`convex/stages/evidence.ts:46` hands all 294 `sourceResultId`s to one model call. `analyzeResultsOutput` (`convex/ai/contracts.ts:52`) demands a rich item **per source**.

**Measured**, on the real 294:

| batch | wall-clock | output tokens | verdict |
| --- | --- | --- | --- |
| 5 | 33.5 s | 3,103 | ok |
| 10 | 55.7 s | 6,028 | ok |
| 25 | **195.5 s** | 22,230 | validates, but **breaches `TIMEOUT_MS = 120_000`** |
| 50 | **FAILED at 300.5 s** | — | `HTTP/2: "stream timeout after 300000"` — a transport ceiling, not our abort |

~600–890 output tokens and ~5.6–7.8 s **per source**. All 294 in one call ≈ 176k–261k output tokens ≈ **27–38 minutes**. It never had a chance.

**Corrections to earlier claims in this file's history, both verified in `node_modules`:**
- `max_tokens` is **not** unset. `@ai-sdk/anthropic` defaults it to the model ceiling — `maxOutputTokens: 128e3`. Truncation was never the bug.
- `@ai-sdk/anthropic` **does** expose Message Batches (`Experimental_BatchLanguageModelV4`, `dist/index.d.ts:1226`). It is still the wrong tool here — the AI SDK's batch path is **text-only** (no `responseFormat`), so adopting it means losing native structured output, and its SLA is "most within 1 hour, hard expiry 24 h", which is wrong for a scan an editor is watching.

### Defect 2 — the model's analysis is computed, paid for, and thrown away

`convex/slice.ts:77` — the production path (`convex/stages/evidence.ts:11` imports it, line 70 calls it) — builds clustering input as:

```ts
const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
```

**Every signal is empty.** The scan asked the model "which of these 294 are the same story?" while showing it 294 opaque IDs and nothing else. Meanwhile `runEvidenceStage` only ever reads `analyzed.ok`, a boolean (`evidence.ts:47,67,75,80`), and `persistAnalysis` stores only translations and a source-type suggestion. The entities and claims are discarded.

**The load-bearing measurement.** Same operation, same prompt, same schema, real data:

| clustering input | result |
| --- | --- |
| empty signals (what production sends) | **294 singletons — merged nothing** |
| real model-derived signals (40 sources) | **37 clusters, 3 correct merges** |

The merges are specific and right — *"Both reference the Asian Street Food Festival at Veterans Park organized by Ka Vang."* **Clustering is not broken. It is being fed nothing.** Cost of that comparison: $0.11.

### Defect 3 — the candidate fingerprint is a constant, so every cluster collapses into one candidate

`convex/candidates/form.ts:47` computes identity as `candidateFingerprint(cluster.entityKeys, beat)`, and `convex/slice.ts:92` passes a hardcoded `beat: "housing"`. `candidateFingerprint` (`fingerprint.ts:18-21`) is `` `${contentHash(sortedUniqueKeys)}:${beat}` ``.

With `entityKeys: []` that expression is **constant**. `formFromCluster` looks up `by_owner_fingerprint`, finds the candidate the first cluster made, and patches it — once per cluster. 294 clusters become **one candidate row carrying 294 sources**, whose `independentCategoryCount` treats the entire scan as evidence for a single story.

**Confidence, stated honestly: this is a code-path deduction, never observed.** The live scan died in clustering and never reached formation. It is the most dangerous defect here precisely because it does not crash — it produces one confident, well-formed, entirely fabricated lead.

**Why 443 tests missed all three.** Every test injects a fake `generate` and feeds a handful of sources. No test has ever run the real payload, and no test asserts that a scan of N sources yields more than one candidate.

---

## Global Constraints

Every task's requirements implicitly include this section.

### The product claim this defends

- AI suggests. **Transparent rules and a journalist decide what is credible.**
- AI may never set eligibility, a score, or the `Coverage gap` label.
- **Never weaken a locality, independence, coverage, evidence or citation rule to make the pipeline run.** A scan that finishes by seeing less is worse than one that fails loudly.
- **Never introduce a fabricated result to improve a demo.**

**Clustering decides which sources corroborate each other, which drives `independentCategoryCount`, which decides whether a lead qualifies.** An LLM freely making that call sits awkwardly against the claim above. Moving the bulk of that decision into deterministic, testable code is not only cheaper — it is more honest about what the product is.

### Invariants no task may break

- **`convex/candidates/evaluate.ts` remains the ONLY writer** of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`, `exclusionReasons`. Defended six times.
- **`runAiOperation` owns the retry loop, the schema-invalid rule and the model-run ledger.** New work adds calls **through** it, never around it.
- **Ledger honesty.** Every model call is its own `modelRuns` row with its own `idempotencyKey`. Do not write one row claiming to cover 294 sources when thirty calls did the work. A partial failure is reported as partial.
- **Cancellation.** `runEvidenceStage` re-checks `isCancelRequested` between model calls. More calls means more cancel checks, not fewer.
- **The injected `GenerateFn` test seam stays.** No unit test may reach a real model.

---

## Task 1: Measure before engineering — ✅ COMPLETE

`scripts/measure-ai-payload.ts`, report at `.superpowers/sdd/2026-08-25-signalgap-ai-batching/task-1-report.md`.

Delivered the batch table above, the empty-vs-populated clustering comparison, and the 300 s transport ceiling. Spend: about $1. **Its findings replaced the previous plan's central recommendation**, which is what a measurement task is for.

- [x] Done. Commit the script with the rest of Task 2.

---

## Task 2: Stop discarding the analysis

**Files:** `convex/schema.ts`, `convex/ai/analyzeResults.ts`.

The single commit that is unambiguously an improvement, is independently useful, and is a prerequisite for every option below.

- [ ] Persist the extracted entities and claim summary on `sourceResults` as new **optional** fields, so a re-run does not re-pay for extraction and so evidence, briefs and blocking can all read them.
- [ ] `persistAnalysis` keeps both existing rules exactly: a model suggestion may **not** overwrite a `sourceType` the deterministic layer already decided, and a translation sits **beside** the original, never over it.
- [ ] Tests: entities persist; a re-run does not duplicate; both existing rules still hold.

**Do not** wire these into clustering yet. On its own that makes the timeout **worse** — populated signals are a larger payload (65,408 vs 37,299 prompt chars, measured). Task 4 is where it becomes safe.

---

## Task 3: Make `analyzeResults` fit

**Files:** `convex/ai/provider.ts`, `convex/ai/analyzeResults.ts`, `convex/stages/evidence.ts`.

- [ ] **Stream it.** `generateObject` → `streamObject` in `defaultGenerate` (`provider.ts:57`). The `GenerateResponse` contract is unchanged (`.object` and `.usage` are promises), so `classifyError`, the ledger and the `GenerateFn` seam are untouched. **Verify `classifyError` still sees `NoObjectGeneratedError` through the streaming path** — the research flagged this as unverified and it is load-bearing for the retry rule.
- [ ] **Turn thinking down.** Adaptive thinking is silently ON for these calls, and we pay output rates for the model to reason about a mechanical extraction. Set effort explicitly to the lowest level that still validates, and **prove it still validates** — do not assume.
- [ ] **Batch by 10.** Not 25 (195 s, measured, breaches the timeout) and not 50 (hard transport failure at 300 s). Ten measured at 55.7 s leaves under 2× headroom on a slow day; if the implementer's own measurement disagrees, follow the measurement and say so.
- [ ] Bounded concurrency, not serial and not unbounded. Say why the ceiling was chosen.
- [ ] Cancellation honoured between batches. Partial success persists what succeeded and records the rest honestly.
- [ ] One `modelRuns` row per batch, `idempotencyKey` including the batch index.
- [ ] Tests: N sources yield N items across batches; a mid-run batch failure persists the others; cancellation stops remaining batches.

---

## Task 4: Fix the fingerprint collapse

**Files:** `convex/candidates/form.ts`, `convex/slice.ts`.

- [ ] A cluster with no distinguishing identity must **not** silently merge into a previous candidate. Decide the honest behaviour — reject the cluster, or derive identity from something real — and say what it costs.
- [ ] `convex/slice.ts:92`'s hardcoded `beat: "housing"` is half the constant. Address it or state plainly why it must stay.
- [ ] **A test that fails on `main`:** a scan of N clusters must produce more than one candidate. That single assertion would have caught this on day one, and nothing in 443 tests makes it.

**Found while fixing this, deferred deliberately, and carrying a deadline.** `candidateFingerprint` folds in `beat`, but `saveJudgment` (`convex/candidates/judgment.ts:57-64`) corrects `candidate.beat` a moment after formation and **never recomputes the fingerprint** — a correctable field welded into an immutable identity. Removing `beat` from the fingerprint is the real fix, and it was deferred because it rewrites every existing fingerprint.

**The deadline, which the original deferral did not state:** the bug is unreachable while `slice.ts` hardcodes `beat: "housing"` (the value never varies, so it contributes zero entropy) and **live immediately after that stops**. So removing `beat` from the fingerprint MUST land in the same change that stops hardcoding it. A decision doc that lands later ships the bug.

---

## Task 4b: A lead whose classification failed is filed under the wrong beat, forever

**Files:** `convex/slice.ts`, `convex/lib/validators.ts`, `convex/schema.ts` — scope to be decided when this is planned.

Found during Task 4's review and verified end to end there. **This is a live, user-visible mislabel, not a theoretical one.**

`convex/slice.ts` passes `beat: "housing"` to every `formFromCluster` call. `saveJudgment` (`convex/candidates/judgment.ts:57-64`) corrects it a moment later from the classifier. But if classification **fails** (`convex/slice.ts:116`), the correction never runs and the candidate keeps `beat: "housing"` permanently.

The feed filters on that column (`convex/candidates/list.ts`), so a transportation story whose classification failed sits in the housing filter forever, with nothing on the card saying the beat was never established.

- [ ] `candidates.beat` is `V.vBeat` — exactly `housing | transportation | culture` (`convex/lib/validators.ts:4`). There is **no** "unassigned" member, so formation cannot currently record "beat not yet known". Decide whether to add one, and what it costs — a new vocabulary member touches the schema, the feed filter, the labels and the fixtures.
- [ ] Whatever is chosen, **a card must never assert a beat the product never established.** The `no_beat_relevance` display wart carried from the feed plan is the same family of problem and should be settled with it.
- [ ] **This is the change that must also remove `beat` from `candidateFingerprint`** — see the deadline recorded under Task 4. The fingerprint bug is unreachable while the value never varies and live the moment it does.

---

## Task 5: Replace the 294-item clustering call with blocking and scoring

**Files:** new `convex/editorial/blocking.ts` (or similar), `convex/slice.ts`.

The measured 294-signal clustering call takes **238 s** against a 120 s timeout, and populated signals make it larger. Batching it is **forbidden** — a cluster can span any two of the 294, so batching would silently prevent cross-batch merges, which is the product's core function.

The canopy pattern removes the need instead of working around it:

```
1. BLOCK   (code) — inverted index on rare tokens from title+snippet, plus the entity keys
                    from Task 2. Produces candidate PAIRS.
2. SCORE   (code) — weighted overlap: shared rare tokens, entity keys, dates, host.
                    >= T_high -> link, no model. < T_low -> not the same story, no model.
3. (Task 6)       — only the band between the thresholds reaches a model.
4. GROUP   (code) — union-find over linked pairs.
5. SPLIT   (code) — independence.ts / formFromCluster, unchanged.
```

**Measured on the real 294:** all possible pairs = **43,071**. Blocking on rare shared tokens removes **97–99%** of them arithmetically.

- [ ] **Entity overlap alone is a recall net, not a decision — this was tested and it fails.** On 40 real analyzed signals it recovered **1 of the model's 3 merges**, and loosening to token overlap merged the *Asian Street Food Festival* with the *Freshwater Food & Wine Festival* on `food, festival`. Do not ship blocking as the whole system.
- [ ] Block on the **translated** title and snippet too. Cross-lingual pairs share few tokens and this is the most likely quiet failure.
- [ ] Both thresholds are named constants with a comment saying who owns them and how they were chosen.
- [ ] **Populate `entityKeys` on every cluster from `sourceResults.analysis.entityKeys`** (Task 2 persisted them). If the grouper does not, every cluster silently takes Task 4's source-id fallback, cross-scan continuity is gone product-wide, and **all seven of Task 4's tests still pass.** That is a quiet product failure, so it needs a tell: count the fallback identities on the scan, or note them in `failures`. Add the tell and a test for it.
- [ ] **Normalise before counting entity overlap.** Task 2 stores entity keys as the model wrote them; deduplication there is exact-string only, so `"Common Council"` and `"common council"` are two keys. Blocking must call `normalizeEntityKey` (`convex/candidates/fingerprint.ts`) before comparing.
- [ ] **Watch `claimSummary` quality.** Task 3 set `effort: "low"`, and on one 10-source sample claims fell 4 → 2 while entities rose 11 → 14. `claimSummary` is a clustering input. n=10 is under-powered, so this is a flag not a finding — but it is free to check against the cached real sources before tuning any threshold.

---

## Task 6: Adjudicate only the ambiguous band

**Files:** `convex/ai/` — a new operation, its schema, prompt and validator.

- [ ] One batched call over the ambiguous pairs only — measured to be order **50–200 pairs**, each a two-line payload. Small, fast, cheap.
- [ ] Register the new operation in `OPERATION_SCHEMAS` and `V.vModelOperation`.
- [ ] The model answers same-story yes/no **per pair**. It does not group, and it does not decide eligibility.

---

## Task 7: Prove it, with tests that can fail

**Files:** `tests/`.

- [ ] **The two objective packets that already exist become free unit tests.** `tests/fixtures/evaluation/cluster-distinct-01.json` (`mustNotMergeIntoOneCluster`) and `cluster-syndicated-01.json` (`mustMergeIntoOneCluster`) can only be checked with a paid call today. A deterministic blocking+scoring function makes them `vitest`. Neither has ever tested code.
- [ ] **A labeled pair set from the real 294.** `scripts/measure-ai-payload.ts` already cached the rows at `.eval-runs/measure/sources.json` — no deployment access, no paid call. Blocking narrows 43,071 pairs to 47. **Tarik labels those 47 in one sitting**, then assert precision and recall floors. Seed it with the traps the real data handed us:
  - **must NOT merge:** Asian Street Food Festival ↔ Freshwater Food & Wine Festival (shares `food`, `festival`)
  - **must NOT merge:** homeless-family sighting ↔ mayor's bike ride (shares `east`, `side`)
  - **must merge:** mayor's bike ride ↔ the bounce-house/bike-raffle festival at that same event — **zero shared entity keys**, the pair that fails if blocking is the whole system
  - **must merge:** the two Homes MKE reports (`South Side` vs `Homes MKE`)
- [ ] **Whole-scan canaries:** cluster count in a band (one cluster = the over-merge disaster; 294 = today's bug); largest cluster under a ceiling (guards union-find transitivity); candidate count > 1.

---

## Task 8: Re-run the live scan

- [ ] **Tarik authorises before this runs.** Up to 120 searches of ~970 remaining, plus model spend of roughly **$2–3** per scan (measured; batch size barely moves it — choose by latency, not price).
- [ ] Clear the orphan `scratch-look-*` rows and the feed fixture first, so the scan reads against a clean deployment.
- [ ] Record: searches used, leads formed, leads qualified, every failure by name, wall-clock, model spend.
- [ ] **The point is the leads, not the green check.** Trace one end to end and check every citation resolves. This is also the first honest test of whether the two-independent-category gate ever fires on real Milwaukee data.

---

## Task 9: Write it down

- [ ] Decision doc for the clustering architecture — options, costs, what was chosen, what was given up. **Leave "What actually happened" blank for Tarik.**
- [ ] Learning-log entry. The story is not "we hit a timeout" — it is that a pipeline can be green on 443 tests, cost real money, and never have run end to end.

---

## Self-Review

**Ship boundary.** Tasks 2–4 make the pipeline *honest* — it stops throwing away work and stops being able to invent a mega-lead. Tasks 5–7 make clustering *real*. If the hackathon clock forces a cut, 2–4 plus a raised clustering timeout is a defensible partial; **shipping 5 without 7 is not**, because untested thresholds silently change which leads qualify.

**Known gaps, named rather than hidden.**
- **294 is one sample.** A different news day could give 150 or 400. Choose batch size and thresholds so the *shape* is safe, not tuned to 294.
- **Whether all 294 deserve analysis is a product question this plan does not answer.** At most ten leads per scan can qualify. Filtering before analysis would change what the scan can see — a rule change, not an optimisation. Raised for Tarik, deliberately not decided.
- **The canopy trades recall for precision.** Two reports on the same zoning vote sharing no distinctive word are never compared. Against `main` this is not a loss — `main` catches nothing.
- **A pairwise system cannot see a whole partition.** Transitivity can chain two loose links into one wrong cluster. The max-cluster-size canary in Task 7 is the mitigation, not cleverness.
- **`TIMEOUT_MS` stays at 120 s.** If a correctly sized batch still needs longer, that is a finding with its own decision, not a quiet bump.
- **Nobody has confirmed Defect 3 in a live deployment.** Task 4's test should reproduce it on `main` first.
