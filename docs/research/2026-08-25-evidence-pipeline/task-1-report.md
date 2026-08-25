# Task 1 — Measuring the real AI payload cost (MOO-736)

**Status:** in progress. This file is written as the measurements land, not at the end.

**What produced these numbers:** `scripts/measure-ai-payload.ts`. It imports
`buildPrompt` from `convex/ai/prompts.ts` and the `analyzeResultsOutput` /
`clusterSignalsOutput` schemas from `convex/ai/contracts.ts`, and calls the model
the same way `defaultGenerate` does (`convex/ai/provider.ts:55`):
`generateObject({ model: anthropic(modelId), schema, system, prompt, abortSignal, maxRetries: 0 })`.

**Deliberate differences from production, and only these two:**
1. The abort timeout is raised (default 900 s in the script) — the question is how
   long a call really takes, not whether it beats 120 s.
2. Nothing is written to Convex. No `modelRuns` row, no `persistAnalysis`. The
   script only reads.

**Model:** `claude-sonnet-5`, read from the deployment env (`AI_PRIMARY_MODEL`).
**Data:** the 294 real `sourceResults` rows of scan `k1781cvj03wmdd2bgz4ks2rzbh8d4ze8`,
fetched through `internal.sourceResults.idsForScan` and `internal.ai.analyzeResults.loadInput`.

---

## Finding before any model call: production clusters on EMPTY signals

`convex/slice.ts:77`:

```ts
const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
```

Every signal handed to `clusterSignals` today carries an empty `entityKeys` array
and an empty `claimSummary`. The live scan asked the model to group 294 opaque IDs
with **no content attached to any of them**. `analyzeResults` output is never fed
into clustering.

This is measured, not inferred: it is the code on `main`, and it is why the
294-signal clustering payload can be reproduced exactly with zero invention.

## Payload sizes (measured, no model call — `--dry-run`)

| Payload | n | system+prompt chars |
| --- | --- | --- |
| analyzeResults | 5 | 4,140 |
| analyzeResults | 10 | 6,813 |
| analyzeResults | 25 | 15,024 |
| analyzeResults | 50 | 27,386 |
| clusterSignals, as production sends it | 294 | 37,299 |
| clusterSignals, with populated signals | 294 | 65,408 |

All 294 source rows together are 123,723 bytes of JSON. **Input was never the
problem.** Roughly 7k tokens for a 50-source analyze batch.

`existingCandidates` in the deployment: **50** (measured, via
`internal.ai.clusterSignals.loadExistingCandidates`). The dry-run row above shows
0 because `--dry-run` skips that query; every real clustering call below carried
all 50.

---

## A. `analyzeResults` — MEASURED

All rows below are measured. Batches are **disjoint** slices of the 294 real
sources (0–5, 5–15, 15–40, 40–90), so each batch saw different real content and
the 90 analysed sources could feed the clustering measurement in section B.

| Batch | n | wall-clock | input tok | output tok | validated? | items / sources | **output tok / source** (derived) | **s / source** (derived) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analyze-05 | 5 | 33.5 s | 3,061 | 3,103 | yes | 5 / 5 | 621 | 6.71 |
| analyze-10 | 10 | 55.7 s | 4,215 | 6,028 | yes | 10 / 10 | 603 | 5.57 |

_(rows 25 and 50 pending — this file is updated as they land)_

Row 25 (measured): 195.5 s, 8,007 in, 22,230 out, validated, 25/25 items,
889 output tok/source, 7.82 s/source.

**A batch of 25 already blows through `TIMEOUT_MS = 120_000`.**

### Full section A table (measured)

| Batch | n | wall-clock | input tok | output tok | validated? | items / sources | out tok/source (derived) | s/source (derived) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| analyze-05 | 5 | 33.5 s | 3,061 | 3,103 | yes | 5 / 5 | 621 | 6.71 |
| analyze-10 | 10 | 55.7 s | 4,215 | 6,028 | yes | 10 / 10 | 603 | 5.57 |
| analyze-25 | 25 | 195.5 s | 8,007 | 22,230 | yes | 25 / 25 | 889 | 7.82 |
| analyze-50 | 50 | **FAILED at 300.5 s** | — | — | — | — | — | — |

**The 50-source failure, verbatim:**

```
AI_APICallError: Cannot connect to API: HTTP/2: "stream timeout after 300000"
```

That is **not** the script's abort signal (set to 900 s). It is a 300-second
HTTP/2 stream timeout in the fetch layer under Node 26. So a single
non-streaming `generateObject` call has a hard transport ceiling around 300 s,
below which any batch must finish. Production aborts at `TIMEOUT_MS = 120_000`
first, so this ceiling is never the thing production hits — but it caps how far
"just use a bigger batch" can ever go.

**Three things this section settles:**
1. Output really is ~600–890 tokens **per source**, and ~5.6–7.8 s **per source**.
   Extrapolated to 294 sources in one call: ~176k–261k output tokens and
   **27–38 minutes**. The plan's root-cause diagnosis is correct.
2. Cost per source scales with output, so it is roughly flat per source. Bigger
   batches save input tokens, not time.
3. **A batch of 25 takes 195 s and already exceeds `TIMEOUT_MS = 120_000`.**
   Only batches of 10 or fewer finish inside the production timeout, and 10 at
   55.7 s leaves under 2x headroom on a slow day.

---

## C. Projections for a full 294-source `analyzeResults`

**Pricing rate used:** `claude-sonnet-5` at **$3.00 / 1M input, $15.00 / 1M output**
— the list rate, and the rate already in `convex/ai/pricing.ts:6`.
**Flagged:** Sonnet 5 is currently under introductory pricing of **$2.00 / $10.00
per 1M through 2026-08-31**. Today is 2026-08-25, so real billing this week is at
the intro rate. Both columns are shown. `pricing.ts` will overstate spend until
2026-09-01, and will be correct from that date.

**All of section C is DERIVED, not measured.** The arithmetic:

- `calls = ceil(294 / b)`
- `total input tokens = calls × (measured input tokens for that batch)`
- `total output tokens = 294 × (measured output tokens ÷ b)`
- `serial wall-clock = calls × (measured wall-clock for that batch)`
- `cost = (input × rate_in + output × rate_out) / 1,000,000`

| batch | calls | input tok | output tok | serial | at conc. 4 | at conc. 6 | cost @ list | cost @ intro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 59 | 180,599 | 182,456 | 33.0 min | 8.2 min | 5.5 min | $3.28 | $2.19 |
| 10 | 30 | 126,450 | 177,223 | 27.8 min | 7.0 min | 4.6 min | $3.04 | $2.03 |
| 25 | 12 | 96,084 | 261,425 | 39.1 min | 9.8 min | 6.5 min | $4.21 | $2.81 |
| 50 | 6 | — | — | — | — | — | — | — |

Batch 50 has no row because the single measured call **failed** at the 300 s
transport ceiling. Projecting from a failure would be inventing a number.

**Confound, stated plainly.** The four batches were disjoint slices, so each saw
different real sources. Per-source output ranges 603–889 tokens across them, and
this design **cannot separate** "bigger batch makes the model write more per
source" from "those 25 sources simply had more in them." Treat 600–900 output
tokens per source as the honest range, not 603 vs 889 as a trend.

Derived input model, for sizing a batch that was not measured:
`input ≈ 1,700–1,900 base tokens + ~240 tokens per source`.

---

## B. `clusterSignals` — what was measured and what it proves

Three separate calls, because "cluster 294 signals" means three different things
depending on whether Task 2 has landed. Each is labelled for exactly what it is.

- **B1 `cluster-294-as-production`** — 294 signals with `entityKeys: []` and
  `claimSummary: ""`, plus the real (empty) `existingCandidates` list. This is
  **byte-for-byte what the failed live scan sent**, because `convex/slice.ts:77`
  builds signals that way today. Nothing is invented. **Proves:** whether the
  payload that actually failed can succeed at all with a raised timeout.
  **Does not prove:** anything about clustering quality, because the model is
  given no content to cluster on.
- **B2 `cluster-40-model-derived`** — 40 signals whose `entityKeys` and
  `claimSummary` came from the real `analyzeResults` output measured in section A.
  **Proves:** the real per-signal size and cost of a populated signal.
  **Does not prove:** behaviour at 294, because it is 40. (It is 40 and not 90
  because the 50-source analyze batch failed.)
- **B3 `cluster-294-populated`** — the 40 model-derived signals plus 254 built
  deterministically from the real title and snippet (capitalised runs from the
  title as entity keys, first 200 chars of the snippet as the claim summary).
  **Proves:** the wall-clock and token cost of a full-scale populated payload.
  **Does not prove:** cluster quality at scale — 254 of the 294 entity-key sets
  never came from a model, and the report must not be read as if they did.

### B1 — MEASURED: the exact production payload

| | value |
| --- | --- |
| signals | 294 (all with `entityKeys: []`, `claimSummary: ""`) |
| wall-clock | **238.5 s** |
| input tokens | 24,962 |
| output tokens | 27,089 |
| validated against `clusterSignalsOutput` | **yes** |
| clusters returned | **294** |

**Every one of those 294 clusters contains exactly one source.** Cluster-size
histogram: `{1: 294}`. The model's own similarity basis on the first cluster:

> "No claim text or entity data supplied; standalone signal"

Two conclusions, both measured:

1. **238.5 s is roughly double `TIMEOUT_MS = 120_000`.** The live scan's clustering
   call could not have finished, independently of anything `analyzeResults` did
   before it. It was not merely "inheriting a stage that had already burned six
   minutes" — the plan's open question at line 70 is now answered: **no**, this
   payload does not fit.
2. **Even with an unlimited timeout, this call clusters nothing.** It would have
   produced 294 single-source candidates. Because `convex/slice.ts:77` hands the
   model empty entity keys and empty claim summaries, the product's core
   function — noticing two outlets covering the same development — is currently
   switched off in code, before any timeout is involved. Fixing the timeout
   without fixing `slice.ts:77` would turn a loud failure into a silent one.

Cost of this single call: $0.48 at list, $0.32 at intro pricing (derived).

### B2 — MEASURED: 40 signals with model-derived entity keys and claims

| | value |
| --- | --- |
| signals | 40 (entity keys + claim summaries taken from the section A output) |
| wall-clock | **91.2 s** |
| input tokens | 10,133 |
| output tokens | 8,607 |
| validated | yes |
| clusters returned | **37** (sizes: 34 singletons, 3 pairs) |

Derived per signal: **2.28 s**, **253 input tokens**, **215 output tokens**.

The three merges, in the model's own words:

- "Both reference the Asian Street Food Festival at Veterans Park organized by Ka Vang"
- "Both describe the City's Homes MKE program selling renovated vacant houses to income-qualified families"
- "Mayor Cavalier Johnson's East Side bike ride event and its associated festival activities"

**This is the load-bearing comparison.** Same operation, same prompt, same schema:
with empty signals it merged **nothing** (294 of 294 singletons); with real
model-derived signals it merged **3 pairs out of 40**. Clustering is not broken —
it is being fed nothing.

Cost of this call: $0.16 at list, $0.11 at intro (derived).

### B3 — MEASURED: 294 populated signals

| | value |
| --- | --- |
| signals | 294 (40 model-derived + 254 deterministically built) |
| wall-clock | **248.6 s** |
| input tokens | 35,493 |
| output tokens | 15,999 |
| validated against `clusterSignalsOutput` | **yes** |
| clusters returned | **9** |
| **unique sources appearing in any cluster** | **22 of 294** |

Cluster sizes: `7, 5, 3, 2, 1, 1, 1, 1, 1`.

**272 of the 294 signals simply do not appear in the output, and the schema is
fine with that.** `clusterSignalsOutput` requires `clusters.min(1)` and each
cluster's `sourceResultIds.min(1)` — nothing requires every input signal to be
placed. So the model returned a schema-valid answer that silently discarded 92%
of the scan. No error, no validation failure, no ledger entry saying anything was
lost.

Compare the coverage directly, all measured:

| call | signals in | sources covered by output | coverage |
| --- | --- | --- | --- |
| B2 | 40 | 40 | **100%** |
| B3 | 294 | 22 | **7.5%** |

One more thing the output contains: a cluster whose `similarityBasis` is the
single word **`"placeholder"`**. `convex/slice.ts:93` uses
`cluster.similarityBasis.slice(0, 120)` as the candidate's working title, so that
cluster would have become a lead titled "placeholder". (No invented source IDs
were returned — checked all 9 clusters against the 294 real IDs — so
`validateAgainstSources` would have let all of this through.)

### What B answers, and what it does not

**Answered — the question the plan says Task 3 hinges on.** Does clustering 294
compact signals finish inside a normal timeout? **No, twice over:**

- As production sends it: **238.5 s**, ~2.0x `TIMEOUT_MS = 120_000`.
- Populated: **248.6 s**, ~2.1x `TIMEOUT_MS`.

And "finishing" would not have helped, because at 294 the answer covers 7.5% of
the input. **Option 1 of Task 3 ("it already fits") is ruled out on two
independent grounds: wall-clock and coverage.**

**Not answered — where the coverage cliff is.** I have two points, 40 (100%) and
294 (7.5%). I did not measure 100 or 150, so I cannot say whether coverage is fine
at 60 and collapses at 120, or degrades smoothly. Anyone choosing a clustering
batch size from this report needs that measurement first; I am not going to
interpolate between two points and present it as a threshold.

**Not answered — cluster quality at scale.** 254 of B3's 294 entity-key sets were
built by a regex over the title, not by a model. B3 is a valid measurement of
size and wall-clock. It is not evidence about how well real clustering would
group real entity keys at 294.

---

## Recommendations

### Batch size for `analyzeResults`: **10**

The number that justifies it: **55.7 s measured, against `TIMEOUT_MS = 120_000`.**
That is 2.2x headroom on a limit that must survive a slower day.

The alternatives, all measured:

- **25 takes 195.5 s** — 1.6x *over* the timeout. Every batch would fail. Not viable.
- **50 failed outright** at the 300 s transport ceiling. Not viable.
- **5 works** (33.5 s) but buys nothing: 59 calls instead of 30, 43% more input
  tokens (180,599 vs 126,450 derived), and *slower* end-to-end (33.0 vs 27.8 min
  serial, derived). More `modelRuns` rows for a worse result.

Batch 10 is also the choice that survives a different day's news volume, which the
plan's self-review asks for: at 10 sources the batch is 55.7 s regardless of
whether the scan returned 150 sources or 400 — only the number of batches moves.

**Concurrency: 4.** Derived: 30 batches ÷ 4 × 55.7 s = **7.0 minutes** for the
whole analyze step. **Flag for Task 2:** 7 minutes inside a single Convex action
is a real risk, and the plan's own self-review raises it. Confirm the action
limit before choosing serial-within-one-action; if it does not fit, the batches
belong in their own workflow steps.

### Clustering strategy: **not option 1. Option 2 (deterministic pre-grouping), with one measurement still owed.**

**Option 1 ("it already fits") is dead.** 238.5 s and 248.6 s are both about twice
the timeout, and the 294-signal call covered 22 of 294 sources.

**The single highest-value change is not batching at all — it is `convex/slice.ts:77`.**
Measured, same operation, same prompt, same schema:

| signals given to the model | clusters | merges |
| --- | --- | --- |
| 294 empty (`entityKeys: []`, `claimSummary: ""`) — what production sends | 294 | **0** |
| 40 with real model-derived keys and claims | 37 | **3** |

Wiring `analyzeResults` output into the clustering input is what makes clustering
do its job. Until that line changes, no batching strategy can produce a single
multi-source lead.

**Why option 2 over option 3, on the numbers:** grouping by entity-key overlap in
plain code is global by construction, so the cross-batch test the plan demands is
satisfiable by design rather than by hoping a second model pass catches the pair.
It also keeps every model call in the range where coverage was measured at 100%
(40 signals, 91.2 s) instead of the range where it measured 7.5%. And it matches
the product rule that deterministic code decides.

**What I cannot recommend with confidence, and will not fake:** the exact size at
which a model clustering call stops covering its input. Two data points, 40 and
294, do not locate that cliff. If the team prefers a model-batching approach
(option 3) over deterministic pre-grouping, measure coverage at 60, 100 and 150
first — that is one cheap script run against the same 294 sources.

---

## Money actually spent

All calls were on `claude-sonnet-5` via the real API. Seven calls, six billed
successfully, one failed at the transport layer.

| group | input tok | output tok | @ list ($3/$15) | @ intro ($2/$10) |
| --- | --- | --- | --- | --- |
| analyzeResults (3 successful) | 15,283 | 31,361 | $0.5163 | $0.3442 |
| clusterSignals (3 successful) | 70,588 | 51,695 | $0.9872 | $0.6581 |
| **total measured** | | | **$1.5035** | **$1.0023** |

**Plus one unmeasurable amount.** The failed 50-source call returned no usage
object, so its billing is unknown. Derived upper bound, from the observed
~114 output tokens/second at n=25 and the derived input model: ~13,800 input and
up to ~34,000 output tokens, so **at most ~$0.55 at list / ~$0.37 at intro**. It
may be far less; I cannot measure it and will not state a figure as if I could.

**Honest total: about $1.50 at list price, about $1.00 at the intro price actually
billed today, plus at most another $0.55 for the failed call.**

Raw artifacts (git-ignored): `.eval-runs/measure/`.

---

## What surprised me

1. **Clustering was never switched on.** `convex/slice.ts:77` hands the model
   `entityKeys: []` and `claimSummary: ""` for every signal. The whole plan is
   framed around clustering being too slow; measured, it is also being fed
   nothing. Fixing the timeout without fixing that line converts a loud failure
   into a silent one — 294 single-source leads instead of zero leads.
2. **A schema-valid answer can throw away 92% of the input.** B3 returned 9
   clusters covering 22 of 294 sources and passed `clusterSignalsOutput` and
   would have passed `validateAgainstSources`. Nothing in the contract requires
   an input signal to be placed anywhere. That is a gap worth its own decision,
   separate from batching.
3. **A candidate would have been titled "placeholder".** One returned cluster's
   `similarityBasis` is literally that word, and `slice.ts:93` uses it as the
   working title.
4. **There is a 300 s transport ceiling under the abort timeout.** The 50-source
   call died on `HTTP/2: "stream timeout after 300000"`, not on the script's
   900 s abort. Raising `TIMEOUT_MS` past 300 s would achieve nothing for a
   non-streaming call — a second reason not to treat a timeout bump as the fix.
5. **`convex/ai/pricing.ts` overstates spend this week.** Sonnet 5 is on
   introductory pricing of $2/$10 per 1M through 2026-08-31; `pricing.ts:6` uses
   $3/$15. It becomes correct on 2026-09-01, so this is a note, not a bug.

---

## Verification

`npm run check` — **passed, exit 0**, with this change in place: lint clean apart
from one pre-existing `import/no-anonymous-default-export` warning in
`convex/auth.config.ts` that this change does not touch; typecheck clean; full
test suite green.

**One honest caveat about a later re-run.** Running `npm run check` a second time
failed with four parse errors, all confined to `.next/dev/types/routes.d.ts` and
`.next/dev/types/validator.ts`. Those are Next.js *generated* files, they are
git-ignored, and the cause is a `next dev` server running concurrently
(PID 37021) that rewrites them while `next typegen` is also writing — the file on
disk contains a visibly duplicated fragment, i.e. it is torn mid-write. Zero
errors reference any file in this change. `npx tsc --noEmit | grep measure-ai-payload`
returns nothing. The failure is a local dev-server race, not a regression; it
clears when the dev server is stopped or restarted.

Nothing under `convex/` or `src/` was modified. The only new file is
`scripts/measure-ai-payload.ts`.
