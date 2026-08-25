# Evidence pipeline research — 2026-08-25

Why the first live Milwaukee scan returned 294 real search results and produced **zero leads**, and what to do about it.

These three reports are the evidence behind every number in
`docs/superpowers/plans/2026-08-25-signalgap-ai-batching.md`. They are kept here, versioned, because they cost real money to produce and because the plan is only trustworthy if its numbers can be traced.

| File | What it is | Cost to produce |
| --- | --- | --- |
| `task-1-report.md` | Measurements against the real 294 results: batch sizes, wall-clock, tokens, and the empty-vs-populated clustering comparison | ~$1 in model calls |
| `research-anthropic.md` | How to call Claude correctly for ~300 independent structured extractions — streaming, batching, caching, the Message Batches API | no paid calls |
| `research-clustering.md` | How to group ~300 search results into stories — prior art, what our platform offers, and a tested verdict on the cheap approach | no paid calls |

## The three findings that mattered

1. **A batch of 25 is measured at 195 s and breaches `TIMEOUT_MS = 120_000`.** The first draft of the plan recommended 25. The measurement replaced the plan's central recommendation, which is what a measurement is for.

2. **Clustering is not broken — it is being fed nothing.** Same operation, same prompt, same schema: with the empty signals production sends, it merged nothing (294 singletons). With real model-derived signals, it found 3 correct merges out of 40. `convex/slice.ts:77` discards the analysis the pipeline just paid for.

3. **Entity overlap alone does not work, and this was tested rather than assumed.** On 40 real signals it recovered 1 of the model's 3 merges, and loosening it merged the Asian Street Food Festival with the Freshwater Food & Wine Festival on the shared words `food, festival`.

## Two claims in the original brief that were wrong

Both were corrected by research and re-verified in `node_modules`:

- **`max_tokens` is not unset.** `@ai-sdk/anthropic` defaults it to the model ceiling (`maxOutputTokens: 128e3`). Truncation was never the bug.
- **`@ai-sdk/anthropic` does expose Message Batches** (`Experimental_BatchLanguageModelV4`). It is still the wrong tool — the AI SDK's batch path is text-only, so it would cost us native structured output.

## Caveats carried forward

- **294 is one sample.** A different news day could return 150 or 400.
- **The fingerprint collapse (Defect 3 in the plan) has never been observed** — it is a code-path deduction. The live scan died in clustering and never reached candidate formation. A test should reproduce it on `main` before it is fixed.
- **Sonnet 5 pricing:** the two reports disagree on whether the $2/$10 introductory rate expires on 2026-08-31 or has become permanent. Low stakes at this spend, but `convex/ai/pricing.ts` carries $3/$15 and will overstate until that is settled.
