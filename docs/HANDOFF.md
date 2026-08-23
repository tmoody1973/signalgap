# SignalGap — session handoff

**Last updated:** 2026-08-23, 09:15 CDT.
**Purpose:** everything a fresh Claude session needs to pick this up without re-deriving it. Read this, then `docs/hackathon-build/spec.md`.

---

## 0. START HERE — the one thing blocking

**Item 7 is code-complete and waiting at REVIEW PAUSE 2. Tarik has not reviewed it yet.**

He was handed a link to one lead and asked for "looks good" or "fix X". Nothing had come back when this session ended.

To put it in front of him again:

```bash
set -a; . ./.env.local; set +a
npx convex dev --once                 # deploy first — codegen alone does not
npm run dev                           # leave running
CLERK_ID=$(curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/users?email_address=$E2E_CLERK_EMAIL" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
npx convex run internal.testing.seedSliceFixture "{\"clerkUserId\":\"$CLERK_ID\"}"
# open http://localhost:3000/leads/<the candidateId it prints>
```

**Do not start item 8 until he accepts.** Resume condition, from `checklist.md`: *source traceability and uncertainty presentation accepted*.

**Keep instructions to Tarik short.** He asked "what am I supposed to do" after a long reply. Three steps and a yes/no is the right size.

### The open product question he still owes an answer to

The review lead is **real captured Milwaukee data** (Metcalfe Park Liberation Hub, August 2026). **Three independent Milwaukee outlets** covered it — Journal Sentinel, Urban Milwaukee, Business Journals — plus an r/milwaukee thread.

**SignalGap says it does not qualify, and shows no score.** Three outlets are three independence *groups* but only one *category* (`original_news`), and `MIN_INDEPENDENT_CATEGORIES` is 2. No official record naming the project appears in the captured official-domain payload, so none is attached — inventing that link is the fabrication the product refuses.

So: **is the two-independent-category gate too strict when three newsrooms have already covered something?** That is a product decision for Tarik, not a bug to quietly fix. Do not loosen the rule without his explicit call, and if he changes it, it needs a decision doc.

---

## 1. What SignalGap is

An editorial lead-discovery workspace for small Milwaukee newsrooms. It searches the public web through SerpApi, uses AI to connect and explain related signals, applies **deterministic rules** to decide what qualifies, and hands a human editor a source-linked reporting brief. Built for the SerpApi "Best AI Use Case" hackathon.

The central claim, which every decision defends: **SerpApi gives it live eyes. AI connects and interprets. Transparent rules and a journalist decide what is credible.** AI may never set eligibility, a score, or the `Coverage gap` label.

---

## 2. Where the work lives

| Thing | Where |
| --- | --- |
| Repo (public) | https://github.com/tmoody1973/signalgap |
| Linear project | https://linear.app/moodyco/project/signalgap-hackathon-mvp-bb9da1e41e47 |
| Approved spec / PRD / scope / checklist | `docs/hackathon-build/` |
| Decision log | `docs/decisions/` (001–006 so far) |
| Design canvas (evidence view) | https://claude.ai/code/artifact/ac8addbb-0610-461d-bddf-ee1ee62491d1 — sources in `design/` |
| Learning log | `docs/LEARNING-LOG.md` |
| Plans | `docs/superpowers/plans/` |
| Convex dev deployment | `dev:handsome-lapwing-832` |

**Linear issues map 1:1 to the 12 checklist items.** MOO-727 … MOO-738.

---

## 3. Status

| Item | Linear | State |
| --- | --- | --- |
| 1. Repo + CI foundation | MOO-727 | **Done** |
| 2. Design system + shell | MOO-728 | **Done** — Review Pause 1 approved by Tarik |
| 3. Clerk–Convex auth + data model | MOO-729 | **Done** |
| 4. Deterministic rules engine | MOO-730 | **Done** |
| 5. SerpApi adapter | MOO-731 | **Done** — all 8 plan tasks complete, CI green (run 32604066171) |
| 6. AI contracts | MOO-732 | **Done** — all 7 plan tasks complete, 39/39 evaluation checks, CI green |
| 7. Evidence-to-brief slice | MOO-733 | **Code-complete, AWAITING REVIEW PAUSE 2** — see section 0 |
| 8–12 | MOO-734…738 | Not planned yet |

355 unit/integration tests, 2 opt-in live tests, plus 22 Playwright tests, all green. CI runs typecheck + lint + tests + build on every push.

---

## 4. How the work is being done

**Process:** the `superpowers:subagent-driven-development` skill. For each task: a fresh implementer subagent works from an extracted task brief; the controller (main session) then dispatches an independent reviewer against the diff; findings go into a fix loop; each task ends with a commit.

**The ledger is the memory.** `.superpowers/sdd/<plan-name>/progress.md` holds the pre-flight scan, every ruling, and per-task completion lines. It is git-ignored scratch — **if you are resuming, read it first.** Rulings are numbered and each states what it costs if wrong.

**Tracking:** `linear-build` skill. Each issue carries Intent / Acceptance criteria / Verification checklist. Post evidence as a comment before moving an issue to Done. Commits end with the issue id, e.g. `(MOO-731)`.

**Three hard-won process notes:**

- **UI cannot be verified by reading.** Building the evidence page found five defects that 352 green tests never would: the page did not load at all (Convex query fired before Clerk attached its token), an entire evidence kind rendered nowhere, Reddit filed as `corroborating` let a dead link exclude a sound lead, `Why this surfaced` came out in index order, and the fixture's own trace was internally impossible. Seed one finished record and **open it in a browser** before calling UI work done.
- **Trace one fact backwards, by hand, and refuse any hop you cannot justify.** That is what caught the impossible trace and the wrong label — no test did. It is also exactly the discipline the product asks its users to apply.

- Implementer subagents go idle mid-task without reporting, fairly often. **Check `git log` and `git status` rather than trusting silence.**
- Do not let an implementer run `/simplify` or any refactor pass. One did, and it edited a shared module outside its task.

---

## 5. Environment — all configured, nothing pending

`.env.local` (git-ignored, never commit) holds: Clerk publishable + secret keys, `E2E_CLERK_EMAIL` / `E2E_CLERK_PASSWORD`, `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_APP_URL`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`.

Convex deployment env holds: `CLERK_JWT_ISSUER_DOMAIN`, `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PRIMARY_MODEL=claude-sonnet-5`, `AI_FALLBACK_MODEL=gpt-5.6-terra`, `AI_FALLBACK_ENABLED=false`.

Clerk is fully set up: app created, a JWT template named `convex` exists, and a test user exists with a strong password (the first one was rejected by Clerk's breach check).

**No `OPENAI_API_KEY`** — the item 6 Task 14 evaluation ran single-model. `docs/model-evaluation.md` leads with that: it is a measurement of Sonnet, not a head-to-head. Adding a key and re-running `npx tsx scripts/evaluate-models.ts` would produce the comparison.

**Model spend to date: about $1.62** (Anthropic), all on the item 6 evaluation harness. Raw answers are saved in the git-ignored `.eval-runs/`; `npx tsx scripts/evaluate-models.ts --rescore` re-runs the checks against them for free, and `--dry-run` exercises the harness with a stub.

**Nothing in items 5–7 is left half-done.** 355 unit/integration tests, 2 opt-in live tests, 21 Playwright tests, typecheck, lint and build all green on `main` at `fc7eb11`; CI run 32644447389 green.

**The review fixture is `internal.testing.seedSliceFixture`** in `convex/testing.ts`. It builds one finished lead from the REAL captured payloads and makes **no model call**. It is idempotent — re-seeding replaces the lead rather than doubling it. Reuse it for item 8 rather than writing a second fixture.

**SerpApi: Starter plan, 1000 searches/month.** ~983 remaining. About 10 have been spent on fixture capture and diagnostics. A single live scan may use up to 120.

**Gotchas that cost real time:**
- `npx convex codegen` does **not** deploy. After adding or changing a Convex function that a CLI or e2e run will call, also run `npx convex dev --once`.
- Convex CLI commands need the env sourced: `set -a; . ./.env.local; set +a`.
- `.env.local` has twice been clobbered when keys were added — `CONVEX_DEPLOYMENT` disappeared and `NEXT_PUBLIC_CONVEX_URL` reverted to the `example.convex.cloud` placeholder. If Convex commands suddenly fail, check that file first.

---

## 6. Rulings a new session must honor

These are decisions taken on Tarik's behalf during execution. Each is in the ledger with its cost-if-wrong. The load-bearing ones:

**Product**
- **Labels are newsroom language, not spec-speak** (Tarik's call). `Worth a look`, `Unverified tip`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`, `No longer qualifies`, `Incomplete scan`, `Stopped early`, `Outdated`, `Saved copy`. Decision 003.
- **Google Events moved from discovery to enrichment** (Tarik's call). The engine returns zero results for everything including SerpApi's own documented example. The fixed opening set is **13 searches, not 16**. Connector kept and tested. Decision 005.
- **`No longer qualifies` is directional** — it fires only when a lead falls from eligible to excluded, never the reverse. The plan had this backwards.

**Correctness**
- **Eligibility follows the spec's wording, not a stricter reading.** Only an inaccessible `initiating` or `corroborating` source excludes a candidate; a dead enrichment link still shows `Needs a recheck` but does not kill the lead. An earlier stricter version would have thinned the live feed.
- **The logged query must equal the executed query.** Google News carries its time filter inside the query text (`when:7d`), so the template renders it — `buildParams` must never mutate `spec.query`.
- **Entity terms from a model go through an allowlist, not a denylist.** Plain words only; anything else is rejected, not sanitised. A denylist was demonstrably bypassable six ways.
- **`searchesReserved` means authorized paid attempts** and never exceeds 120. Re-opening a failed run counts as a new authorized attempt: it increments `searchesReserved` and is refused at the cap. It does **not** decrement `searchesFailed` — that field is a cumulative count of failed attempts, not a live gauge of rows currently failed. Decrementing it makes the invariant `succeeded + failed + in-flight == reserved` impossible to hold, because the retry reuses the same row rather than creating a new one.

**Evidence honesty**
- **The 120 cap under concurrency is now proven** (2026-08-22, Task 8). `convex-test` takes a mutex per top-level transaction, so its 20-way test never interleaves and proves nothing about production. `tests/live/reserve-concurrency.test.ts` spawns 20 separate `npx convex run` processes against the real deployment: **granted=5, rejected=15, reserved=120, runs=5** from a scan seeded at 115. Zero SerpApi calls. Item 5's "including under concurrency" and demo gate 5 **are** satisfied. Note the plan's `ConvexHttpClient` sketch was impossible — internal functions need admin auth we do not have.
- **Two of seven normalizer branches (Events, Maps at the time) were tested against hand-written fixtures.** Maps has since been re-captured live. Events remains hand-written because the engine returns nothing.
- **The model evaluation is a measurement, not a comparison** (2026-08-23). 18 packets, 39/39 checks, 0 invalid outputs, median ~19s, $0.70. Single-model: no `OPENAI_API_KEY`. **4 of 18 packets carry expectations drafted by the build script and never confirmed by a person** — `analyze-official-01`, `analyze-official-02`, `analyze-spanish-01`, `brief-thin-01`. `docs/model-evaluation.md` names them. Brief *usefulness* is not measured at all.
- **Community discussion enters as `enrichment`, never `corroborating`** (2026-08-23). spec.md:541 says indexed Reddit results never count as corroboration. Filed as corroborating it did two wrong things at once: it inflated the independence count, and — because an inaccessible corroborating source excludes a candidate — **a dead Reddit link killed an otherwise sound lead**. As enrichment it flags `Needs a recheck` and leaves the lead standing, which is what the spec describes.
- **Every fixture source carries the search that could really have found it** (2026-08-23). The first `seedSliceFixture` put all four sources under one `site:city.milwaukee.gov` run, so a Journal Sentinel story claimed it was found by a search that cannot return jsonline.com. On the one page whose job is traceability, that is a lie. One search run per source now, using real catalog queries. The manual backward trace in the item 7 plan is what caught it — keep doing it.
- **The quotation rule was corrected, not weakened** (2026-08-23, Tarik's call). It demanded equality with the WHOLE stored field, which rejected the model quoting one true sentence out of a two-sentence snippet. Every failure was checked against saved raw output: all verbatim substrings, nothing invented. Rule is now a word-for-word run of **at least 20 characters** inside a cited source. The floor is what stops a substring becoming a cherry-picked word; it makes a misleading partial quote hard, not impossible. `spec.md:625` amended with the reason. Prompt is at **v2**.

---

## 7. Carried forward — do not lose these

Each is written into the relevant Linear issue as well.

| For | What |
| --- | --- |
| **Tarik** | **The two-category question in section 0.** Real data produced an excluded lead that three newsrooms covered. Unanswered. |
| **MOO-734** (item 8) | `runSliceForScan` in `convex/slice.ts` is the whole per-scan pipeline: cluster → form → classify → snapshot → **evaluate** → brief. Item 8 wraps it in the Convex Workflow component plus the 13 fixed discovery searches. Keep the exported-plain-function + one-line-`internalAction` shape; it is how tests inject a fake model. |
| **MOO-734** (item 8) | `convex/candidates/evaluate.ts` is the **only** writer of `status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`. Do not add a second writer. |
| **MOO-735** (item 9) | The ranked feed needs a **list** query. `evidence.forCandidate` is per-lead and deliberately heavy. |
| **MOO-735** (item 9) | `Outdated` is brief-scoped and still has no schema home. It must **not** go into `vProductLabel` — it needs a field on `briefVersions` or `candidates`. |
| **Item 10** | The Google Events normalizer branch is still unverified against a real payload. Re-check whether SerpApi has fixed the engine. |
| **Item 10** | **Never introduce a fabricated result to improve the demo.** This session shipped an invented lead and Tarik caught it — see the note below. |
| Deferred minors | Listed in each plan's ledger under `minor (deferred)`. None block. |

**The fabricated-fixture near-miss (2026-08-23).** The first Review Pause 2 lead was a story I invented — fake headlines, fake outlets, fake URLs — even though item 7's checklist says "using a **captured** candidate packet" and real captured Milwaukee payloads had been sitting in `tests/fixtures/serpapi/` since item 5. Tarik asked "is this a fake story you made?" and it was. It is now real captured data. Two rules follow from that:

1. When a checklist says *captured*, go and find the captured thing before inventing one.
2. A fixture that reaches a screen a human reviews is demo material. Treat it under item 10's no-fabrication rule, not as throwaway test data.

---

## 8. What happens after Review Pause 2

Section 0 is the blocker. Once Tarik accepts:

1. **Close MOO-733.** Evidence is already posted as a comment; move it to Done.
2. **Write the item 8 plan** (`docs/superpowers/plans/`, MOO-734, durable scan workflow). Use the `superpowers:writing-plans` skill and write it against the real interfaces in section 7, not predicted ones — that is what made the item 7 plan hold up.
3. **Item 8 is the 14-step scan lifecycle**: Convex Workflow component, the 13 frozen discovery templates, two-part coverage searches, 20 corroboration calls, conditional enrichment, the 34-call reserve, hard 120 ceiling, four public stages, cancellation, partial failures. `checklist.md` item 8 has the full acceptance list.
4. **Item 10 will need SerpApi budget.** ~983 searches left on Starter; one live scan may use up to 120.

If he asks for a change instead, it is a change to item 7 — make it, re-run `npm run check && npm run test:e2e`, re-seed, and put it back in front of him. Do not roll it into item 8.

---

## 9. Working agreements with Tarik

- He wants **plain English**, short sentences, one idea per sentence. When a decision is needed: two options, the context to choose fast, and a recommendation.
- **Decision log entries are a portfolio deliverable**, not paperwork — written so a smart non-engineer can follow them, jargon defined inline on first use. Claude drafts the decision; **the "What actually happened" section is left blank for Tarik to fill in his own voice.** That split is what makes them credible.
- Read primary sources before building. A summary of a source is not the source.
- Never weaken an evidence, locality, independence, coverage, or citation rule to make the feed look fuller.
