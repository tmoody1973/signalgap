# Grouping ~300 search results into stories — research and recommendation

**Scope:** research only. No source file was modified. Sibling document:
`task-1-report.md` (cost measurement, same directory) — this one reuses its run
artifacts rather than repeating its paid calls.

**Rule followed throughout:** every external claim below names the file I read or
the URL I fetched. Nothing is cited from memory. Where I could not establish
something, it is in **What I could not determine** at the end.

---

## 0. What is actually broken, verified locally

The trigger finding is confirmed, and it is worse than "clustering is low
quality".

`convex/slice.ts:77` builds the clustering input as:

```ts
const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
```

`runAnalyzeResults` *does* return entities and claims (`convex/ai/contracts.ts:52-80`,
`analyzeResultsOutput.items[].entities` / `.claims`), and
`convex/stages/evidence.ts:46` holds that whole return value in a local named
`analyzed` — then reads only `analyzed.ok` at lines 47, 67, 75 and 80.
`persistAnalysis` (`convex/ai/analyzeResults.ts:42-75`) writes translations and a
source-type suggestion and nothing else. The entities and claims are extracted,
paid for, and dropped on the floor in the same function.

### What that costs, measured on the real 294

From the run artifacts in `.eval-runs/measure/` (produced by
`scripts/measure-ai-payload.ts` against scan `k1781cvj03wmdd2bgz4ks2rzbh8d4ze8`),
counted with a throwaway script, not by eye:

| Run | signals in | clusters out | clusters with >1 member | largest cluster | clusters carrying entity keys | prior-candidate links suggested | cost | wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cluster-294-as-production.json` (empty signals, exactly what prod sends) | 294 | **294** | **0** | 1 | **0** | **0** | $0.48 | 238 s |
| `cluster-40-model-derived.json` (real entity keys + claim summaries) | 40 | 37 | 3 | 2 | 29 | 8 | $0.16 | 91 s |

Every one of the 294 clusters carries the `similarityBasis`
`"No claim text or entity data supplied; standalone signal"`. The model said, in
its own output, that it had nothing to cluster on.

### The second-order failure nobody has named yet

`convex/candidates/form.ts:47` computes the candidate identity as
`candidateFingerprint(cluster.entityKeys, beat)`, and `convex/slice.ts:92` passes
a hardcoded `beat: "housing"`. `candidateFingerprint`
(`convex/candidates/fingerprint.ts:18-21`) is
`` `${contentHash(sortedUniqueKeys)}:${beat}` ``.

With `entityKeys: []` on every cluster, that expression is a **constant**. So
`formFromCluster` looks up `by_owner_fingerprint`, finds the candidate the first
cluster created, and patches it — 294 times. The code path turns 294 clusters into
**one candidate row with 294 `candidateSources`**, and that one row's
`independentCategoryCount` is whatever you get when every result in the scan is
treated as evidence for the same story.

I could not observe this in the deployment: the 50 most recently updated
candidates (`internal.ai.clusterSignals.loadExistingCandidates`, read live) are all
seeded — 30 with `fixture-*` fingerprints, 20 with `scratch-look-*`. Scan
`k1781…` produced no candidates at all, which is consistent with the measured
238 s clustering call blowing through the 120 s `TIMEOUT_MS` in
`convex/ai/provider.ts:12`. So: the collapse is a code-path deduction, and the
live scan never got far enough to demonstrate it.

**Conclusion: clustering has never run end to end.** Treat everything below as
designing it for the first time, not tuning it.

---

## 1. What the established way to do this is

This is a well-studied problem with a standard shape. Four bodies of work matter.

**Topic Detection and Tracking (TDT).** A DARPA-sponsored line of work on
"finding and following new events in a stream of broadcast news stories", whose
tasks include first story detection and event clustering — "organize a collection
of news media into clusters of stories that pertain to the same real-world event".
Classic IR clustering with a similarity threshold was found to work for it.
([search results and the linked Springer chapter / NIST evaluation overview](https://link.springer.com/chapter/10.1007/0-306-47019-5_4),
[NIST TDT evaluation overview](https://www.nist.gov/publications/topic-detection-and-tracking-evaluation-overview))
The relevant lesson: our problem is *event clustering*, not topic clustering.
Two articles about housing are not the same story; two articles about the same
zoning vote are.

**Blocking, from record linkage.** "Blocking attempts to restrict comparisons to
just those records for which one or more particularly discriminating identifiers
agree", used "because this can be a very computationally demanding task", with an
explicit tradeoff: it has "the effect of increasing the positive predictive value
(precision) at the expense of sensitivity (recall)".
([Wikipedia — Record linkage](https://en.wikipedia.org/wiki/Record_linkage), fetched)

**Canopy clustering** (McCallum, Nigam & Ungar 2000, *Efficient Clustering of High
Dimensional Data Sets with Application to Reference Matching*). Two distance
metrics: "an approximate and fast distance metric" to form loose canopies, then "a
more accurate and slow distance metric" inside them. Two thresholds T₁ > T₂; a
point may sit in several canopies. Purpose: "to speed up clustering operations on
large data sets, where using another algorithm directly may be impractical".
([Wikipedia — Canopy clustering algorithm](https://en.wikipedia.org/wiki/Canopy_clustering_algorithm), fetched)

**MinHash / LSH for near-duplicates.** Estimates Jaccard similarity of shingle
sets by hashing; "initially used in the AltaVista search engine to detect
duplicate web pages and eliminate them from search results" (Broder, 1997).
([Wikipedia — MinHash](https://en.wikipedia.org/wiki/MinHash), fetched)

**What a modern system actually looks like.** *Event-Driven News Stream Clustering
using Entity-Aware Contextual Embeddings* (EACL 2021, arXiv 2101.11059): an online
streaming k-means variant that "aggregates document-cluster similarity along
multiple representations and makes the clustering decision using a neural
classifier", combining **sparse and dense** features, with entities enhancing
rather than replacing dense embeddings.
([arXiv 2101.11059](https://arxiv.org/abs/2101.11059), fetched)

**The shape everyone converges on:** cheap recall-oriented candidate generation
(blocking / canopies / LSH) → expensive precision-oriented pairwise scoring →
transitive grouping. Nobody hands 300 documents to one oracle and asks for the
partition. That is the architecture we do not have.

### Does entity overlap alone do the job? I tested it on our data. **No.**

Union-find over the 40 real analyzed signals in
`.eval-runs/measure/analyzed-signals.json`, normalized with the same function as
`convex/candidates/fingerprint.ts`:

| rule | groups | merges found | of the model's 3 merges recovered | merges the model did not make |
| --- | --- | --- | --- | --- |
| share ≥1 whole entity key | 37 | 3 | **1** | 2 |
| share ≥2 whole entity keys | 40 | 0 | 0 | 0 |

Two of the model's three merges share **no entity key at all**:

- "each house will sell for approximately $125,000…" (keys: `South Side`) vs
  "Homes MKE's goals include selling, renovating…" (keys: `Homes MKE`, `City of Milwaukee`).
- the mayor's slow-roll bike ride (keys: `Cavalier Johnson`, `East Side`, `City of Milwaukee`)
  vs the festival bounce house / bike raffle at that same event (keys: `Common Council`).

And loosening to token-level overlap immediately over-merges: at ≥2 shared entity
tokens the **Asian Street Food Festival** gets joined to the **Freshwater Food &
Wine Festival** on `food, festival`, and a homeless-family sighting gets joined to
the mayor's bike ride on `east, side`.

So entity overlap is a **recall net, not a decision**. That is precisely the role
blocking plays in the literature, and it is the reason the recommendation below is
two-stage rather than "just use the entity keys".

---

## 2. What our platform already gives us

**Convex vector search exists and is real** (not just a type). Fetched via
`ctx7` from `/llmstxt/convex_dev_llms-full_txt`, which sources
`https://docs.convex.dev/vector-search` and `https://docs.convex.dev/production/state/limits`:

- Declared in the schema: `.vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["cuisine"] })`; the vector field must be `v.array(v.float64())`.
- Queried **only inside an action**: `await ctx.vectorSearch(table, index, { vector, limit, filter })`, returning `{ _id, _score }` pairs (`_score` in −1…1) — you then `runQuery` to fetch the documents.
- Limits: 4 vector indexes per table (counting toward 32 indexes per table), 16 filter fields per index, `limit` 1–256 (default 10), one query vector per search.
- **Dimension range is stated inconsistently in the docs I fetched:** the API reference for `vectorIndex` says "must be between 2 and 2048"; the limits page says "between 2 and 4096". Both are Convex docs. 1536 is safely inside both, so this does not block anything, but do not design against 3072 without checking.
- Search storage and query usage are billed as a tier shared between text and vector indexes, "measured in query-GBs per month" — the fetched docs give no per-unit dollar figure, so I have no cost number for it.

**Producing an embedding from inside a Convex action needs no new dependency.**
`ai@^7.0.76` and `@ai-sdk/openai@^4.0.45` are already in `package.json`, the `ai`
package exports `embed` / `embedMany` (`node_modules/ai/dist/index.d.ts:419-485`),
and `OPENAI_API_KEY` is already a documented deployment variable
(`.env.example`, and `convex/ai/provider.ts:57` already constructs `openai(modelId)`
for the fallback path). Cost of embedding **all 294 sources' titles + snippets**
(28,269 characters ≈ 7,100 tokens) at `text-embedding-3-small`'s
$0.02 / 1M tokens ([OpenAI pricing](https://developers.openai.com/api/docs/pricing),
fetched): **$0.00014.** Embeddings are free at our scale.

**But `ctx.vectorSearch` is the wrong tool for within-scan clustering,** and this
is the non-obvious part. It is a *top-K nearest-neighbour query against a stored
corpus*. Clustering 294 items with it means writing 294 embedding rows, then making
294 separate `vectorSearch` calls inside an action. The alternative — hold 294
vectors in memory in the same action and compute 43,071 cosine similarities — is a
few milliseconds of arithmetic and zero storage.

Where the vector index genuinely earns its keep is the **other** clustering
question this codebase has: `suggestedExistingCandidateId`.
`loadExistingCandidates` (`convex/ai/clusterSignals.ts:10-27`) currently takes the
50 most recent candidates and puts all of them in the prompt. That is exactly a
top-K similarity lookup over a growing persistent corpus, and it is exactly what
`ctx.vectorSearch` is built for. Note this collides with `docs/hackathon-build/spec.md:35`
("Non-goals: A vector database…") and `spec.md:633` ("No embeddings or vector
database are used"), so adopting it is a spec amendment and a decision record, not
an implementation detail.

---

## 3. Recommended architecture

**Canopy: deterministic blocking → deterministic pair scoring → an LLM only in the
ambiguous band.**

```
0. exact dedup            — already done at ingest (canonicalKey, sourceResults.by_scan_canonical)
1. BLOCK      (code)      — inverted index on rare tokens from title+snippet, plus entity keys
                            from analyzeResults. Produces candidate PAIRS.
2. SCORE      (code)      — weighted overlap: shared rare tokens, shared entity keys, shared
                            dates, same host. Two thresholds, T_high and T_low.
                              score >= T_high  -> link, no model involved
                              score <  T_low   -> not the same story, no model involved
                              in between       -> stage 3
3. ADJUDICATE (AI)        — ONE batched call. Input is the ambiguous pairs only, each with its
                            two claim summaries. Output: same-story yes/no per pair.
4. GROUP      (code)      — union-find over linked pairs -> clusters.
5. SPLIT      (code)      — independence.ts / formFromCluster, unchanged.
```

### Why the pair count makes this trivially affordable — measured on the real 294

An inverted index over rare tokens (document frequency ≤ N) of the actual 294
titles + snippets:

| rare-token cutoff | candidate pairs with ≥1 shared rare token | with ≥2 | with ≥3 |
| --- | --- | --- | --- |
| df ≤ 3 | 409 | 47 | 20 |
| df ≤ 5 | 734 | 97 | 48 |
| df ≤ 8 | 1,148 | 188 | 64 |
| df ≤ 15 | 1,947 | 327 | 123 |

All possible pairs: **43,071**. Blocking removes 97–99% of them with arithmetic.
After scoring, the band that reaches a model is a subset of the ≥2-shared-token
column — order **50 to 200 pairs**, each a two-line payload. That is one small,
fast, cheap call, against $0.48 / 238 s today.

**This dissolves the batching problem rather than solving it.** The model never
sees 294 items, so there is nothing to split into batches, and no cross-batch
merge problem to invent. If the current AI-batching work is only needed to make
the 294-item call fit, this replaces it.

### What is deterministic and what is a suggestion

| Step | Who decides | Auditable as |
| --- | --- | --- |
| Blocking keys, rare-token cutoff | **code** | pure function, unit-testable |
| Pair score and the two thresholds | **code** | pure function, tunable constants in `convex/editorial/` |
| Auto-link above T_high, auto-reject below T_low | **code** | the model cannot override either |
| Same-story verdict for pairs between the thresholds | **AI suggests** | recorded per pair with the score that put it in the band |
| Transitive grouping | **code** | union-find |
| Independence split, signal category, fingerprint | **code**, already | `independence.ts`, `toEngineSource.ts`, `fingerprint.ts` |

Map that against `CLAUDE.md`'s non-negotiable — *"AI suggests; deterministic code
in `convex/editorial/` decides eligibility, labels, scores"*. Today the model is
handed 294 items and asked for the whole partition, and that partition drives
`independentCategoryCount`, which drives eligibility. Under this design the model
can only move a pair **inside a bounded band the code chose**. It cannot merge
what the score rejected and cannot split what the score accepted. The blocking and
scoring functions belong in `convex/editorial/`, where the rest of the deciding
code lives.

It also satisfies the second non-negotiable, *never weaken independence to fill
the feed*: nothing here merges or splits to hit a batch size, because there is no
batch size.

### What this costs and what it gives up — honestly

**Costs:**
- Real new code: a blocking index, a pair scorer, a union-find, and a new AI
  operation (pair adjudication) with its own schema, prompt, and validator. This
  is a day or two, not an afternoon.
- Two thresholds that need tuning against labeled data. Tuning knobs are
  liabilities until someone owns them.
- A new `modelRuns` operation to add to the registry (`convex/ai/contracts.ts:OPERATION_SCHEMAS`)
  and the `V.vModelOperation` validator.

**What it gives up:**
- **Recall on stories that share no rare token.** Blocking's known tradeoff —
  precision up, recall down (Record linkage, cited above). Two reports on the same
  zoning vote that share no distinctive word are never compared, and the model
  never gets a chance to spot it. Today's design would in principle catch that;
  in practice today's design catches nothing, so this is a real loss only against
  the fixed version, not against `main`.
- **Cross-lingual pairs.** A Spanish and an English report of the same story share
  few tokens. The entity-key channel helps (proper nouns survive translation), and
  `analyzeResults` already writes `translatedTitle` / `translatedSnippet`
  (`convex/ai/analyzeResults.ts:63-66`) — block on the translated text too. This
  needs its own test case; it is the most likely quiet failure.
- **A whole-partition view.** A pairwise system cannot say "these seven are the
  same rolling story"; it says six pairwise yeses and lets union-find infer it.
  Transitivity can chain two loose links into one wrong cluster. Mitigation is a
  max-cluster-size canary (see §5), not cleverness.

**Where embeddings fit — later, and not via the vector index.** If entity keys and
rare tokens miss too much (the "Homes MKE" case above suggests they will), add
cosine similarity over `text-embedding-3-small` vectors as a **third blocking
channel**, computed in-memory in the same action. $0.00014 per scan, deterministic
given the embedding, one more threshold. Use `ctx.vectorSearch` and a stored
`vectorIndex` for the **cross-scan** `suggestedExistingCandidateId` problem — that
is a persistent top-K lookup and is what the index is actually for.

---

## 4. The smallest honest first step

**Yes — persisting the entities and feeding them to the existing clustering call
is a real improvement, and it ships this week. But shipped alone it will still
time out.**

What it is: `runEvidenceStage` already has the analysis in hand
(`convex/stages/evidence.ts:46`). Pass `analyzed.analysis.items` into
`runCandidateFormation`, and build the signals at `convex/slice.ts:77` from it
instead of from empty strings — `entityKeys` from the five entity arrays,
`claimSummary` from the first claim. Persist the entities on `sourceResults` (a new
optional field) so a re-run does not re-pay for extraction.

What it demonstrably fixes, from the measured runs:
- 294 singleton clusters → real clusters (37 from 40 signals, 3 merges, largest cluster 2).
- Non-empty `entityKeys` on 29 of 37 clusters → the fingerprint constant collapse
  in §0 goes away and candidates get distinct identities.
- 8 of 37 clusters propose a link to a prior candidate, which is `spec.md:631`'s
  "suggested links to prior candidates" working for the first time.

**Its ceiling, stated plainly:** the 294-signal call was measured at **238 s**, and
`convex/ai/provider.ts:12` aborts at **120 s**. Populated signals make the payload
*larger* (65,408 vs 37,299 prompt chars, per `task-1-report.md`), so this step on
its own makes the timeout worse, not better. It is honest only if shipped with
something that stops 294 items going into one call — which is either the batching
work already in flight, or stage 1 of §3, which removes the need for it.

`// ponytail:` if you want one commit that is unambiguously an improvement, it is
"stop discarding the entities" — persist them on `sourceResults`. That is
independently useful (evidence, briefs, blocking all want them), cannot regress
anything, and is a prerequisite for every option in §3.

---

## 5. How we would know it works

Clustering quality tests rot into tautologies. Three checks that can actually fail,
in increasing cost.

**(a) The two objective packets that already exist, run against the deterministic
layer instead of the model.** `tests/fixtures/evaluation/cluster-distinct-01.json`
encodes `mustNotMergeIntoOneCluster` for a Sherman Park retrospective vs a Public
Works Committee meeting; `cluster-syndicated-01.json` encodes
`mustMergeIntoOneCluster` for the same story under two publishers. Today these can
only be checked with a paid call. A pure blocking + scoring function makes them a
free `vitest` unit test. Both currently exercise the model's judgment; neither has
ever tested code.

**(b) A labeled pair set drawn from the real 294 — the check I would build.**
`scripts/measure-ai-payload.ts` already caches the 294 real rows of scan
`k1781cvj03wmdd2bgz4ks2rzbh8d4ze8` at `.eval-runs/measure/sources.json`, so the
data is on disk and needs no deployment access and no paid call. The blocking pass
above narrows 43,071 pairs to 47 (df ≤ 3, ≥2 shared rare tokens). **Have Tarik
label those 47 pairs same/different — one sitting.** Then assert precision and
recall floors against that file. It fails the moment thresholds drift.

Seed it with the traps the real data already handed us, so it is not a
rubber stamp:
- **Must not merge:** Asian Street Food Festival ↔ Freshwater Food & Wine
  Festival (shares `food`, `festival`).
- **Must not merge:** homeless-family sighting ↔ mayor's bike ride (shares
  `east`, `side`).
- **Must merge:** the mayor's bike ride ↔ the bounce-house/bike-raffle festival
  at that same event — the pair with **zero** shared entity keys. This is the one
  that fails if blocking is the whole system, and it is the reason stage 3 exists.
- **Must merge:** the two Homes MKE reports (`South Side` vs `Homes MKE`).

**(c) Two whole-scan canaries, cheap and blunt.** Run formation over the 294 and
assert:
- **cluster count in a band** (say 150–280). One cluster means the over-merge
  disaster; 294 means today's bug.
- **largest cluster ≤ some ceiling** (say 8). This is the specific guard against
  union-find transitivity chaining, and it is the assertion that would have caught
  the fingerprint collapse in §0 on day one.
- **candidate count > 1 for a scan of 294 sources.** Trivial, and it fails today.

What none of these measure is whether a cluster is a *story a journalist would
recognize*. That needs a person. §(b) is the cheapest honest version of it.

---

## What I could not determine

- **Whether the fingerprint collapse in §0 actually happened in the deployment.**
  Deduced from `form.ts:47` + `fingerprint.ts:18` + `slice.ts:92`, not observed.
  The 50 most recently updated candidates are all seeded fixtures; scan `k1781…`
  produced none, so there was nothing to inspect.
- **Convex vector search dollar cost.** The fetched docs say storage is tiered by
  plan and queries are billed in query-GBs/month, with no per-unit figure and no
  free-tier allowance stated in what I read.
- **Convex's actual maximum vector dimension.** The API reference says 2048, the
  limits page says 4096. Both are Convex docs, both fetched today.
- **Whether Anthropic offers an embeddings endpoint.** The bundled `claude-api`
  skill enumerates the API surface (Messages, Batches, Files, Token Counting,
  Models) and lists no embeddings endpoint, but does not say one does not exist.
  I did not verify against live Anthropic docs. It does not change the
  recommendation — `@ai-sdk/openai` and `OPENAI_API_KEY` are already wired.
- **What Google News actually does in production.** I found the academic lineage
  (TDT, and EACL 2021 for a current system) but no primary source describing a
  production aggregator's pipeline. Do not let anyone cite "this is what Google
  News does" from this document.
- **Recall of the blocking stage on the full 294.** I measured how many *pairs*
  survive blocking, and I measured entity-overlap recall against the model's own
  3 merges on 40 signals. I did not measure recall against ground truth, because
  no ground truth exists yet. That is what §5(b) is for.

## Sources

- `https://docs.convex.dev/vector-search`, `https://docs.convex.dev/production/state/limits`, `https://docs.convex.dev/api/interfaces/server.VectorSearchQuery` — fetched via `npx ctx7@latest docs /llmstxt/convex_dev_llms-full_txt`
- [Wikipedia — Canopy clustering algorithm](https://en.wikipedia.org/wiki/Canopy_clustering_algorithm) (McCallum, Nigam & Ungar 2000)
- [Wikipedia — Record linkage](https://en.wikipedia.org/wiki/Record_linkage) (blocking; Fellegi–Sunter)
- [Wikipedia — MinHash](https://en.wikipedia.org/wiki/MinHash) (Broder 1997, AltaVista)
- [arXiv 2101.11059 — Event-Driven News Stream Clustering using Entity-Aware Contextual Embeddings](https://arxiv.org/abs/2101.11059) (EACL 2021)
- [Springer — Topic Detection and Tracking: Event Clustering as a Basis for First Story Detection](https://link.springer.com/chapter/10.1007/0-306-47019-5_4); [NIST — TDT Evaluation Overview](https://www.nist.gov/publications/topic-detection-and-tracking-evaluation-overview)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) — `text-embedding-3-small` $0.02 / 1M tokens
- Bundled `claude-api` skill, Current Models table — Sonnet 5 $3.00 / $15.00 per 1M ($2.00 / $10.00 intro through 2026-08-31)
- Repo: `convex/slice.ts`, `convex/stages/evidence.ts`, `convex/ai/{clusterSignals,contracts,analyzeResults,prompts,provider}.ts`, `convex/candidates/{form,fingerprint,toEngineSource}.ts`, `convex/editorial/{independence,types}.ts`, `convex/schema.ts`, `docs/hackathon-build/spec.md`, `CLAUDE.md`, `scripts/measure-ai-payload.ts`
- Run artifacts: `.eval-runs/measure/{sources,analyzed-signals,cluster-294-as-production,cluster-40-model-derived,results}.json`
</content>
</invoke>
