# Research: running ~300 structured extractions against Claude (SignalGap)

**Date:** 2026-08-25 · **Author:** research-anthropic (subagent) · **Status:** research only, no source file modified.

Every claim below is cited to a file I opened or a URL I fetched in this session. Where I could not
determine something, it says so in **What I could not determine**.

---

## TL;DR

**Smallest change that actually fixes this — three lines, no new dependency:**

1. **Split `analyzeResults` into batches of ~10–15 sources** (`convex/stages/evidence.ts:46`).
2. **Switch `defaultGenerate` from `generateObject` to `streamObject`** (`convex/ai/provider.ts:57`).
3. **Set `providerOptions.anthropic.effort: "low"`** — thinking is silently ON today and you are
   paying for it on a mechanical extraction task.

**Long-term shape:** the Message Batches API, which **is already supported by the packages you have
installed** — but it is a poor fit for the live scan path an editor is watching (SLA is "most within
1 hour", hard expiry at 24 hours). Keep it in mind for a future backfill/re-analysis job, not for this.

**These differ, and the small fix is the right one to ship now.**

**One correction to the task brief:** `@ai-sdk/anthropic` **does** expose Message Batches. See §1.

**One correction to the plan doc:** the plan is directionally right but under-researched in three
specific places. See §6.

---

## 0. What is actually wrong, verified

Facts I confirmed by reading the installed packages, not from memory:

| Fact | Evidence |
| --- | --- |
| `max_tokens` is **not** unset — the provider defaults it to the model ceiling | `node_modules/@ai-sdk/anthropic/dist/index.js:3897` — `const maxTokens = maxOutputTokens != null ? maxOutputTokens : maxOutputTokensForModel;` |
| For `claude-sonnet-5` that ceiling is **128,000** | same file, `getModelCapabilities`, line 5655–5658 (`claude-sonnet-5` → `maxOutputTokens: 128e3`) |
| So the request already sends `max_tokens: 128000`. **Truncation is not the bug.** | derived from the two rows above |
| `generateObject` on `claude-sonnet-5` uses **native** `output_config.format`, not a JSON tool wrapper | `dist/index.js:3817–3820` (`supportsStructuredOutput` && `structureOutputMode === "auto"` → `useStructuredOutput`), and `getModelCapabilities` sets `supportsStructuredOutput: true` for `claude-sonnet-5` (line 5657) |
| No `thinking` parameter is sent, because `generateObject` passes no `reasoning` | `dist/index.js:3867` — the thinking config is only built `if (isCustomReasoning(reasoning) && ...effort == null)` |
| On Claude Sonnet 5, **omitting `thinking` runs adaptive thinking** | `claude-api` skill, "Thinking & Effort (Quick Reference)" table, Sonnet 5 row: "Runs adaptive" |
| Nothing streams | `convex/ai/provider.ts:57` — `generateObject`, no `.stream` anywhere in `convex/ai/` |
| 3 attempts × 120 s = the observed 360,041 ms | `convex/ai/provider.ts:10-11,132` — `TIMEOUT_MS = 120_000`, `MAX_TRANSIENT_RETRIES = 2`, fresh `AbortSignal.timeout` per attempt |

**So the real shape of the failing request is:** one non-streaming call, 294 rich items,
`max_tokens: 128000`, adaptive thinking on, aborted at 120 s.

### The number that decides everything

`analyzeResultsOutput` (`convex/ai/contracts.ts:56-77`) demands, per source: 5 entity arrays, a
`dates` array, `claims[]` each with a verbatim `exactExcerpt`, `potentialHumanSources[]`, a `reason`
of up to 300 chars, and four title/snippet fields — two of which **echo the input verbatim**
(`originalTitle`, `originalSnippet`).

I estimate **~350 output tokens per item** (range 200–500). **This is an estimate, not a measurement**
— Task 1 of the plan exists to replace it. Sensitivity:

| est. out/item | total output for 294 | 1-call wall clock @60 tok/s | batch of 10 | batch of 15 | batch of 25 |
| --- | --- | --- | --- | --- | --- |
| 200 | 58,800 | ~16 min | 33 s | 50 s | 83 s |
| **350** | **102,900** | **~29 min** | **58 s** | **88 s** | **146 s** |
| 500 | 147,000 | ~41 min | 83 s | 125 s | 208 s |

**Read the "batch of 25" column against `TIMEOUT_MS = 120_000`.** At the middle estimate a batch of
25 *already breaches the timeout*. That is the concrete reason to recommend 10–15, not 25.

---

## 1. Message Batches API — the brief's premise is wrong, but the conclusion still holds

### It IS supported. The grep missed it.

The task brief says "`@ai-sdk/anthropic` exposes no Message Batches surface". That is not correct for
the version you have installed (`@ai-sdk/anthropic` 4.0.40, `ai` 7.0.76 — verified by reading
`node_modules/*/package.json`).

Evidence, all from files I opened:

- `node_modules/@ai-sdk/anthropic/dist/index.d.ts:1222-1232` — `AnthropicProvider`'s call signature
  and `.languageModel()` / `.chat()` / `.messages()` all return `Experimental_BatchLanguageModelV4`.
  **The `anthropic(modelId)` object already on `convex/ai/provider.ts:56` is a batch model.**
- `node_modules/@ai-sdk/anthropic/dist/index.js:5904` — `class AnthropicMessagesBatchLanguageModel`,
  implementing `experimental_doStartBatch`, `experimental_doGetBatchStatus`,
  `experimental_doGetBatchResults`, hitting `` `${baseURL}/messages/batches` `` (line 6037).
- `node_modules/ai/dist/index.d.ts:6218-6226` — `startTextBatch`, `getBatchStatus`, `getBatchResults`,
  exported at line 9442 as `experimental_startTextBatch`, `experimental_getBatchStatus`,
  `experimental_getBatchResults`.
- Documented usage, fetched via `ctx7 docs /vercel/ai`, sourced from
  `github.com/vercel/ai/blob/main/content/providers/01-ai-sdk-providers/05-anthropic.mdx`:

  ```ts
  import { anthropic } from '@ai-sdk/anthropic';
  import {
    experimental_getBatchResults as getBatchResults,
    experimental_getBatchStatus as getBatchStatus,
    experimental_startTextBatch as startTextBatch,
  } from 'ai';

  const batch = await startTextBatch({ model, requests: [{ id: 'first', prompt: '...' }] });
  let status = batch.status;
  while (status === 'pending') { await setTimeout(60_000); ({ status } = await getBatchStatus({ model, batch })); }
  for await (const item of getBatchResults({ model, batch })) { /* item.text */ }
  ```

**So no new dependency is needed to use batches.** `@anthropic-ai/sdk` is indeed not installed
(verified), but you would not need it.

### But there is a blocking limitation: the AI SDK's batch API is TEXT ONLY

This is the finding that kills batching for `analyzeResults` as currently written.

- `node_modules/ai/dist/index.d.ts:6148` — `type TextBatchRequest = Prompt & LanguageModelCallOptions & { id: string; providerOptions?: ProviderOptions }`.
- `node_modules/ai/dist/index.d.ts:523+` — `LanguageModelCallOptions` contains `maxOutputTokens`,
  `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`,
  `reasoning`. **It does not contain `responseFormat` and it does not contain `tools`.**
- There is **no `startObjectBatch`** — I grepped the whole `ai` export list (line 9442); the only
  batch entry points are the three text ones.
- The result type carries only `text`, `finishReason`, `usage`, `response`, `providerMetadata`
  (`ai/dist/index.d.ts:6180-6199`).

**Consequence:** going through `experimental_startTextBatch` means giving up `output_config.format`
— the native structured-output guarantee you have today — and going back to "please emit JSON" plus
hand-parsing. For a system whose entire premise is that the model's output is checked before it is
allowed to exist (`convex/ai/runOperation.ts:112-120`), that is a real downgrade, not a wash.

The Anthropic API itself has no such limitation: the official docs say a batch supports "nearly all
features available in the Messages API", excluding only `stream`, `speed`, `store`,
`previous_thread_event_id`, `cache_hint`, `context_hint`, `max_tokens: 0`, and
`research_preview_2026_02` (batch-processing doc, FAQ). Structured outputs are **not** on that
exclusion list. So the limitation is the AI SDK's, not Anthropic's — you would have to add
`@anthropic-ai/sdk` to get structured output *and* batching together.

### The latency SLA — this is the decisive argument

From `https://platform.claude.com/docs/en/build-with-claude/batch-processing`, quoted verbatim:

> "most batches finishing in less than 1 hour while reducing costs by 50%"

> "The system processes each batch as fast as possible, with most batches completing within 1 hour.
> You can access batch results when all messages have completed or after 24 hours, whichever comes
> first. **Batches expire if processing does not complete within 24 hours.**"

> "Rate limits apply … Additionally, processing may be slowed down based on current demand and your
> request volume. In that case, you may see more requests expiring after 24 hours."

Other confirmed facts from the same page:
- Limit: 100,000 requests or 256 MB per batch, whichever comes first.
- Results available 29 days after creation.
- **"Batch results can be returned in any order"** — key by `custom_id`, never by position.
- Prompt caching **does** work with batches: *"The Message Batches API supports prompt caching …
  cache hits are provided on a best-effort basis. Users typically experience cache hit rates ranging
  from 30% to 98%"*, and *"consider using the 1-hour cache duration … for better cache hit rates"*.
  (⚠️ A summarising pass over the *prompt-caching* page told me the opposite — that caching does not
  work with batches. That was wrong; it had conflated the `max_tokens: 0` pre-warming restriction
  with caching in general. I am citing the batch-processing page, which I read directly.)

**Verdict on latency:** "an editor is watching this scan" and "most batches finish within an hour,
some expire after 24" are incompatible. This is not a close call.

### Does the durable workflow rescue it?

Mechanically, yes — and I checked. `@convex-dev/workflow` 0.4.6 exposes `step.sleep(duration)`
(`node_modules/@convex-dev/workflow/dist/client/workflowContext.d.ts`, `sleep(duration: number, opts?)`).
So the shape submit → `step.sleep(60_000)` → poll → repeat is directly expressible in
`convex/scanWorkflow.ts` and would survive restarts.

**But durability solves the wrong problem.** The workflow can wait an hour; the editor who clicked
"scan" cannot. Making the pipeline durable across an hour-long batch turns a live newsroom tool into
a batch job with a notification. That is a product decision, not an optimisation — and it is exactly
the kind of change the plan's own constraint says not to make quietly.

### What adopting batches would break

If you did it anyway, here is the honest damage list, from reading the code:

| Thing | What happens |
| --- | --- |
| `runAiOperation`'s ledger (`convex/ai/runOperation.ts:53-126`) | Currently one row per call with a synchronous `durationMs`. A batch is submit-now / finish-later, so `modelRuns` needs a `submitted` state and a separate completion write. Not hard, but it is a schema change. |
| The `GenerateFn` test seam (`convex/ai/provider.ts:28`) | `GenerateFn` is `(args) => Promise<GenerateResponse>` — a single synchronous call. Batching does not fit behind it. You would need a second seam, and 443 tests inject the existing one. |
| Structured output validation (`convex/ai/contracts.ts`) | Lost via the AI SDK path (see above). `schema.safeParse` at `provider.ts:157` would go from "check a guaranteed-shaped object" to "parse arbitrary text, then check". |
| Cancellation (`convex/stages/evidence.ts:59-68`) | An editor cancelling mid-scan would need to `DELETE /v1/messages/batches/{id}` (cancel first), which nothing in the AI SDK's batch surface exposes — I found no cancel method on `AnthropicMessagesBatchLanguageModel`. You would be paying for work an editor already stopped. |
| Convex action limits | Fine either way. Convex-runtime actions get **30 minutes**, Node-runtime **10 minutes** (`docs.convex.dev/production/state/limits`). No `"use node"` exists anywhere in `convex/` (I grepped), so you are on the 30-minute runtime. |

**Recommendation on Q1: do not adopt Message Batches for the live scan path.** Note it in the
decision doc as the right tool for a future re-analysis/backfill job, where an hour is free.

---

## 2. Prompt caching — it saves you nothing here, and it would silently not work

Short answer: **the prefix is too short to cache, by a factor of about three.**

### The measurement

I reconstructed the exact system string `buildPrompt` produces for `analyzeResults`
(`convex/ai/prompts.ts:67-74` — `HOUSE_RULES` + `\n\n` + `OPERATION_INSTRUCTIONS.analyzeResults`):

- **1,434 characters.**
- At Anthropic's own rule of thumb — *"1 token is approximately 4 characters"*
  (`platform.claude.com/docs/en/about-claude/pricing`, FAQ) — that is **~360 tokens**.

### The minimum

> **"Claude Sonnet 5 requires a minimum of 1,024 tokens"** to be cacheable. *"Shorter prompts cannot
> be cached, even if marked with `cache_control`. Any requests to cache fewer than this number of
> tokens will be processed without caching, and no error is returned."*
> — `platform.claude.com/docs/en/build-with-claude/prompt-caching`

**360 < 1,024. It would fail silently.** You would need ~4,100 characters of system prompt to reach
the floor; you have 1,434. This conclusion is robust to tokenizer uncertainty — even at a very
generous 3 chars/token the prefix is only ~478 tokens.

### It would not be worth it even if it worked

Best case, batches of 12 calls, all cache hits at the 0.1× read multiplier
(`pricing` doc, prompt caching table: 5-minute write 1.25×, 1-hour write 2×, read 0.1×):

- 360 tokens × 12 calls = 4,320 input tokens.
- At Sonnet 5's $2/MTok that is **$0.0086 for the entire scan**. Caching would save a fraction of a cent.

### Would anything in `buildPrompt` invalidate the prefix? No — but there is a second blocker

I checked `buildPrompt` myself. The system string is
`` `${HOUSE_RULES}\n\n${OPERATION_INSTRUCTIONS[operation]}` `` — two module-level constants, no
timestamp, no ID, no `Date.now()`, no non-deterministic serialisation. **It is genuinely
byte-identical across calls**, exactly as the brief said. There is no silent invalidator.

But there is an independent blocker: **`generateObject({ system: "…" })` passes a bare string, and a
bare string has nowhere to hang `cache_control`.** The provider reads cache control from a system
*message's* `providerOptions` (`@ai-sdk/anthropic/dist/index.js:2466-2481` — it parses
`providerOptions` per system message and calls `validator.getCacheControl(providerOptions, { type: "system message", canCache: true })`).
To use it you would have to abandon `system`/`prompt` and construct
`messages: [{ role: "system", content, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }, …]`.

**Recommendation on Q2: skip prompt caching entirely, and write down why** (prefix is ~360 tokens
against a 1,024-token floor). It is a cheap-sounding idea that would cost a refactor and return
under a cent.

---

## 3. Streaming and `max_tokens` — you are failing for a *partly* dumber reason, but streaming alone is not enough

This is the question with the most useful answer, so I want to be precise rather than tidy.

### `max_tokens` is a red herring

Already covered in §0: the provider sends `max_tokens: 128000` because `maxOutputTokens` is unset and
it falls back to the model ceiling (`dist/index.js:3897`, `getModelCapabilities` line 5657). **You
are not being truncated. Setting `maxOutputTokens` would only make things worse.**

### Streaming is genuinely necessary — and genuinely insufficient

The `claude-api` skill is explicit that non-streaming is the wrong shape here:

> "**128K output tokens:** … Sonnet 5 … support up to 128K `max_tokens`, but the SDKs require
> streaming for values that large to avoid HTTP timeouts."

> "default to streaming for any request that may involve long input, long output, or high `max_tokens`
> — it prevents hitting request timeouts."

So yes — a non-streaming request with `max_tokens: 128000` is precisely the anti-pattern the
reference warns about, and *"The signal has been aborted"* is what that anti-pattern looks like.

**But streaming would not have made this scan work.** At the middle estimate the single call must
emit ~102,900 output tokens. Even at an optimistic 100 tok/s that is **~17 minutes**; at 60 tok/s,
**~29 minutes**. Streaming stops the abort; it does not make an editor wait 20 minutes for one stage,
and at the high end it brushes the 30-minute Convex action ceiling.

**Conclusion: streaming is a necessary fix that is not a sufficient one. Splitting is required. The
brief asked me to say plainly if the evidence pointed at a smaller fix — it points at a smaller fix
than *batching*, but not at a one-line fix.**

### The third lever nobody has noticed: thinking is on and you are paying for it

Adaptive thinking is running on every one of these calls (§0). For a mechanical
extract-what-is-literally-in-this-snippet task, that is spend and latency with little return. The
provider exposes the control (`@ai-sdk/anthropic/dist/index.d.ts:250-256` — `effort: "low" | "medium" | "high" | "xhigh" | "max"`),
and the skill recommends `low` "for subagents or simple tasks".

I recommend `effort: "low"` rather than `thinking: { type: "disabled" }`. The skill documents two
failure modes for disabled thinking (tool calls leaking into visible text, `<thinking>` tags leaking
into output) and says "Turning thinking on and lowering `effort` fixes both and still cuts cost."

### The whole small fix

```ts
// convex/ai/provider.ts — replace defaultGenerate
const defaultGenerate: GenerateFn = async ({ provider, modelId, system, prompt, schema, abortSignal }) => {
  if (provider === "openai") { /* unchanged generateObject path */ }
  const result = streamObject({
    model: anthropic(modelId), schema, system, prompt, abortSignal, maxRetries: 0,
    providerOptions: { anthropic: { effort: "low" } },
  });
  return {
    object: await result.object,
    usage: { inputTokens: (await result.usage)?.inputTokens, outputTokens: (await result.usage)?.outputTokens },
  };
};
```

`streamObject` is exported from `ai` (verified, `dist/index.d.ts:9442`) and its result exposes
`object: Promise<RESULT>` and `usage: Promise<LanguageModelUsage>`
(`ai/dist/index.d.ts:7535+`, lines 33 and 9 of that interface) — so the existing
`GenerateResponse` contract is unchanged and **`classifyError` / `safeParse` / the ledger / the test
seam all keep working untouched.**

⚠️ **One thing to verify with a test before trusting this:** that `await result.object` still
rejects with `NoObjectGeneratedError` when the model produces nothing parsable. `classifyError`
(`convex/ai/provider.ts:70`) depends on that, and the schema-invalid retry rule depends on
`classifyError`. I could not confirm the rejection type by reading types alone.

---

## 4. Structured output at scale — you already have the right primitive

`generateObject` + a Zod schema on `claude-sonnet-5` compiles to **native `output_config.format`** —
not a JSON tool, not prompt-and-pray. Verified at `@ai-sdk/anthropic/dist/index.js:3817-3820` plus
`getModelCapabilities` (`supportsStructuredOutput: true` for `claude-sonnet-5`, line 5657). This
matches the `claude-api` skill's guidance ("Use `output_config: {format: {...}}`"). **Do not change it.**

Notes on interactions:

- **With streaming:** `streamObject` uses the same `responseFormat` path, so native structured output
  survives the switch. This is the main reason `streamObject` beats `streamText` + manual parsing here.
- **With batching (AI SDK):** lost, as established in §1 — `LanguageModelCallOptions` has no
  `responseFormat`.
- **Strict tool use:** the skill's guidance is that strict tool use is for constraining *tool
  parameters*; `output_config.format` is the right primitive for constraining the *response*. You
  want the latter. No change.
- **Schema size:** worth knowing that the JSON schema is sent on every request. With 12–30 calls
  instead of 1 you pay for it 12–30 times. It is small relative to the source payload, and the cost
  table below already reflects the general effect of per-call overhead.

---

## 5. Cost arithmetic — a 294-source scan at Sonnet 5 rates

### Rates (fetched today from `platform.claude.com/docs/en/about-claude/pricing`)

| | Input | Output |
| --- | --- | --- |
| Claude Sonnet 5, standard | **$2 / MTok** | **$10 / MTok** |
| Claude Sonnet 5, Batch API | **$1 / MTok** | **$5 / MTok** |

**On the intro-pricing question the brief asked me to check — the answer is better than expected.**
Quoted verbatim from that page:

> "The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as
> introductory pricing through August 31, 2026, **is now the standard price**. The previously
> scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur."

So there is **no cliff on 1 September**. Any budgeting done against a feared $3/$15 can be revised
down permanently.

### The table

Assumptions, stated so they can be checked: 294 sources; **~140 input tokens/source** (the team
lead's measured ~7k input for 50 sources); **~360 tokens of system prompt per call** (measured, §2);
**~350 output tokens/item (ESTIMATE — the weakest number here)**.

| Strategy | Calls | Input tok | Output tok | Sync cost | Batch-API cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 call (today — never completes) | 1 | 41,520 | 102,900 | $1.11 | — |
| Batches of 50 | 6 | 43,320 | 102,900 | $1.12 | $0.56 |
| Batches of 25 | 12 | 45,480 | 102,900 | **$1.12** | $0.56 |
| **Batches of 10–15 (recommended)** | 20–30 | ~48,700 | 102,900 | **~$1.13** | ~$0.56 |
| 1 source per request | 294 | 147,000 | 102,900 | $1.32 | $0.66 |

**Three things this table says:**

1. **Splitting is nearly free.** Going from 1 call to 30 costs about **2 cents** more per scan,
   because output dominates and output is per-item regardless. There is no cost argument against
   fine-grained batches; pick the size by latency, not by price.
2. **The Batch API saves about $0.56 per scan.** Real, but for a tool running a handful of scans a
   day that is well under $50/month — and §1 showed the cost is an hour of latency, lost structured
   output, and no cancellation. **Not worth it here.**
3. **One-source-per-request is the only genuinely wasteful option**, because the 360-token system
   prompt gets repeated 294 times and input more than triples. Another reason to land on 10–15.

**Un-costed:** thinking tokens. Adaptive thinking is on today (§0) and its output tokens bill at the
$10/MTok output rate. Dropping to `effort: "low"` should cut this, but I have no measurement of how
much — Task 1 should record `outputTokens` with and without.

---

## 6. Assessment of the current plan (`docs/superpowers/plans/2026-08-25-signalgap-ai-batching.md`)

**The brief asked whether I agree it is under-researched. I partly agree.**

The plan's spine is right, and two of its judgements are better than most of what I found:

- **Task 1 (measure first) is correct and should not be cut.** The single weakest number in *my*
  report is output-tokens-per-item, and Task 1 is exactly the measurement that fixes it.
- **The `analyzeResults` vs `clusterSignals` distinction (lines 46-50) is the sharpest thing in the
  document** and I have nothing to add to it. Splitting an embarrassingly-parallel per-item
  extraction is safe; naively splitting a global clustering operation would silently destroy the
  product's core function. That analysis is right.
- **"Do not raise `TIMEOUT_MS` as the fix" (line 107) is right** — with one refinement below.

Three places where it is genuinely under-researched:

1. **It never considers streaming, and it never checks `max_tokens`.** The plan's root-cause section
   (line 29) correctly identifies output volume, then jumps straight to batching without asking why
   a 120-second non-streaming request was ever the right shape for a 128k-token generation. §3 is
   the missing analysis. Batching without streaming leaves the same anti-pattern in place at smaller
   scale.
2. **Its candidate batch sizes are too large, and it does not know that.** Task 1 proposes measuring
   5/10/25/50 (line 74) — fine — but Task 2 gives no guidance, and the sensitivity table in §0 shows
   **a batch of 25 breaches `TIMEOUT_MS` at the middle output estimate.** The plan risks measuring,
   picking 25 because it validated once, and shipping something that fails intermittently under a
   heavier news day. Recommend it state 10–15 as the prior, to be revised by measurement.
3. **It treats "add batching" as obviously meaning application-level chunking, and never evaluates
   the Message Batches API at all.** That turns out to be the right call — but for reasons the plan
   never states, and which took this whole document to establish. The decision doc (Task 5) should
   record *why* the 50%-cheaper option was rejected, or the question will be reopened in three months.

One refinement to line 138 (`TIMEOUT_MS` stays at 120 s): with `streamObject`, a 120-second cap on
the *whole* call is measuring the wrong thing — for a streaming request the meaningful timeout is
time-to-first-chunk plus an inter-chunk gap, and `ai` v7 exposes exactly that
(`TimeoutConfiguration` with `totalMs` / `stepMs` / `firstChunkMs`, `ai/dist/index.d.ts:588`).
That is a better answer than either keeping 120 s or bumping it.

---

## Recommendations, in the order I would do them

**Ship now (the honest small fix — no new dependency, no schema change, no new test seam):**

1. `convex/ai/provider.ts:57` — `generateObject` → `streamObject`, keeping the `GenerateResponse`
   contract identical. Add a test that a non-parsable output still rejects as `NoObjectGeneratedError`.
2. `convex/ai/provider.ts` — add `providerOptions: { anthropic: { effort: "low" } }` for the
   Anthropic path.
3. `convex/stages/evidence.ts:46` — split `sourceResultIds` into batches of **10–15**, bounded
   concurrency **4–8**, one `modelRuns` row per batch, cancellation checked between waves, partial
   success treated as a real outcome. (This is the plan's Task 2, unchanged, with a size prior.)
4. Run the plan's Task 1 measurement **against this new shape** and revise the batch size from data.

**Write down, do not build:**

5. A decision-doc entry recording that Message Batches was evaluated and rejected for the live path —
   50% cheaper, but "most batches within 1 hour / expiry at 24 hours" versus an editor watching a
   scan, plus loss of native structured output through the AI SDK and no cancellation path. Note it
   as the right tool for a future backfill.
6. A decision-doc entry recording that prompt caching was evaluated and rejected — the reusable
   prefix is ~360 tokens against Sonnet 5's 1,024-token floor, so it would fail silently and save
   under a cent.

**Do not do:**

7. Do not add `@anthropic-ai/sdk`. Nothing in this analysis requires it.
8. Do not set `maxOutputTokens`. It is already at the model ceiling and lowering it causes truncation.
9. Do not raise `TIMEOUT_MS`. Once streaming, replace it with `firstChunkMs`/`stepMs` instead.

---

## What I could NOT determine

Stated plainly, because a report that hides these is worse than useless.

1. **Actual output tokens per analyzed item.** My ~350 is an estimate from reading the schema, not a
   measurement. Every wall-clock figure and the whole cost table scale linearly with it. **This is
   the single most load-bearing unverified number in this document**, and the plan's Task 1 is the
   right way to settle it. I did not make any paid API call.
2. **Actual output throughput (tokens/second) for `claude-sonnet-5` on this workload.** I used
   60–100 tok/s as a band. I found no published figure and did not measure one. If real throughput
   is materially higher, the batch-size recommendation shifts up.
3. **How many output tokens adaptive thinking is currently adding.** I confirmed it is on; I could
   not quantify it. Measure `outputTokens` at `effort: "low"` versus the current default.
4. **Whether `await streamObject(...).object` rejects with `NoObjectGeneratedError`.** I read the
   type (`object: Promise<RESULT>`) but not the runtime rejection path. `classifyError`'s
   schema-invalid rule depends on it. Needs one test.
5. **Whether `analyzeResults` is genuinely the only failure.** `clusterSignals` also failed, and the
   plan (line 70) rightly notes it may have failed only because it inherited a stage that had already
   burned six minutes. Nothing in my analysis settles that — Task 1's second measurement does.
6. **Exact tokenizer count for the system prefix.** I used the documented ~4 chars/token heuristic
   rather than the `count_tokens` endpoint; reading the API key from `.env.local` was blocked by the
   permission classifier and I did not work around it. The conclusion (360 vs a 1,024 floor) holds
   with a ~3× margin, so the imprecision does not change it.
7. **Whether analysing all 294 sources is the right product call.** The plan raises this at line 137
   and deliberately leaves it for Tarik. I agree it should not be decided as an optimisation —
   filtering before analysis changes what the scan can see, which is a rule change. Flagging only,
   not deciding.
