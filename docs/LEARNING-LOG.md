# Learning log

Running retro of real learnings from building SignalGap. Dated, three questions each: what did we expect, what happened, what do we now believe.

---

## 2026-08-22 — Renaming product labels touches more files than the labels themselves

**Expected:** Renaming ten label strings (see [[003-newsroom-label-language]]) would mostly be a find-and-replace inside one file, `src/lib/source-labels.ts`.

**Happened:** The same label strings were also hard-coded as literal values in the Convex schema validator (`convex/lib/validators.ts`, the code that tells the database which exact values a field is allowed to hold), in a unit test, in an end-to-end browser test, and repeated across five separate planning and product documents — including inside example code blocks in the original planning doc. One label ("Partial") also collided in a plain-text search with an unrelated TypeScript built-in type, `Partial<...>` (a utility type meaning "all these fields are optional"), which meant a blind find-and-replace across the codebase would have silently broken type signatures in the planning doc's code samples.

**Now believe:** A user-facing string that appears in more than one file should be traced with a full-repository search before editing, not assumed to live in a single source of truth — especially once it has also been typed as a literal value in a schema validator, which is easy to miss because it does not look like UI copy.

---

## 2026-08-22 — Closing out checklist items 1–4: foundation, editorial rules, auth shell, workspace UI

**Expected:** Items 1–4 of the build checklist (project setup, the pure-function editorial rules engine — see [[002-rules-engine-pure-functions]], Clerk sign-in plus Convex schema, and the authenticated workspace shell) would take roughly the planned time and close cleanly, since each task had a written brief before work started.

**Happened:** Clerk (the login/authentication service) needed three manual setup steps outside the code — steps a coding agent cannot do by itself because they require clicking through an external dashboard, not editing files. Two defects were caught by review before they shipped: a test-runner config gap (the `vitest` "projects" setup that separates fast pure-function tests from slower Convex-backed tests wasn't wired for both groups at first) and a one-word logic-direction bug in `eligibilityTransition` — a function meant to flag only leads moving from eligible to excluded, which the first version had backwards. The ten product-facing labels also needed a full rewrite mid-plan after Tarik reviewed them and found the wording read like a requirements document instead of newsroom language (see [[003-newsroom-label-language]]).

**Now believe:** A written brief before a task starts catches scope questions, but it doesn't catch direction bugs (this rule fires on X→Y, not Y→X) or tone-of-voice problems (technically correct wording that doesn't sound like the people who'll read it) — those need a human read of the actual output, not just a review of the plan. Budget review passes as real time in the plan, not as a buffer for if something goes wrong.

---

## 2026-08-23 — The test that finally proves something is the one that costs money to skip

**Expected:** The 120-search budget cap was covered by a twenty-way concurrency test, so checklist item 5's acceptance line — "the 121st reservation cannot occur, including under concurrency" — was already satisfied.

**Happened:** A reviewer read the test runner's own source (`node_modules/convex-test/dist/index.js`) and found it takes a lock around every top-level transaction. The twenty reservations never actually overlapped. The test proved the code orders operations correctly and proved nothing whatsoever about what happens in production, where transactions really do collide. Closing the gap meant running the same reservation against the real deployment from twenty separate operating-system processes — twenty independent clients, twenty independent transactions. Result: exactly five granted out of twenty, counter landing on 120. Zero SerpApi calls, because it only exercises database writes. The plan's own suggested approach for this test was impossible as written: it assumed a browser-style client could call an internal function, which needs administrator credentials we do not have.

**Now believe:** A test framework that makes concurrency convenient is usually simulating it, and a simulated race proves ordering rather than safety. When an acceptance criterion contains the word "concurrent", read the test runner's source before believing the test. Also: the cheapest honest move is to write down that the evidence is missing. That note survived a context reset, three sessions, and a handoff document, and it is why the gap got closed instead of quietly shipping.

---

## 2026-08-23 — Our own guard called the model a liar, and the model was telling the truth

**Expected:** Running eighteen evaluation packets against Claude Sonnet 5 would mostly measure the model: does it invent sources, does it invent quotations, does it resolve contradictions it should preserve.

**Happened:** Four of eighteen packets failed the source-binding check, which is the guard that rejects fabricated citations. Every failure looked like the model inventing a quotation. It was not. The rule demanded that a quotation equal the **entire** stored snippet, and the model had quoted one true sentence out of a two-sentence snippet — word for word, nothing added, nothing changed. Checking each failure against the saved raw output showed all of them were verbatim substrings. The guard was wrong, not the model. Corrected to "a word-for-word run of at least 20 characters found inside a cited source", the same eighteen packets scored 39 of 39 with zero invalid outputs.

**Now believe:** A validation rule that has never been run against real output is a hypothesis, not a guarantee — and a strict-looking rule can be strict in the wrong dimension. Whole-field equality is not stricter about fabrication than verbatim-substring matching; both make invention impossible, and only one of them permits normal quoting. The practical fix that made this cheap to discover: save every raw model answer to disk during an evaluation run. It turned "pay again to find out why" into "read the file", and it is how the corrected rule was verified for free.

---

## 2026-08-23 — Idempotency keys stop duplicate records, not duplicate spending

**Expected:** The specification's model-idempotency key (scan, candidate, operation, input fingerprint, schema version, prompt version, model) would prevent paying twice for the same answer, because a repeat request would find the existing record.

**Happened:** It found the existing record and then called the model anyway. The key was doing exactly what it was written to do — avoid a duplicate row — while the expensive part, the network call, happened before anything consulted it. A test that simply asked for the same brief twice exposed it. The same shape of bug had already been found and fixed one layer down, in the paid-search budget, where re-running a finished search would have spent a second SerpApi call.

**Now believe:** An idempotency key protects whatever comes after the lookup. If the costly action sits before the check, or the check does not gate it, the key is a bookkeeping convenience and nothing more. The question to ask of any key is not "does this prevent a duplicate record" but "what, specifically, does this stop from happening twice" — and then write the test that does the thing twice.

---

## 2026-08-23 — Four bugs that only appear when you run the thing

**Expected:** With 352 unit and integration tests green and a design canvas drawn from the real tokens, building the evidence page would be assembly. The tests already covered the query, the rules and the pipeline; the components were rendering data that was known-correct.

**Happened:** The page did not load at all on first run — a Convex query fired before Clerk had attached its token, threw once, and never retried. Behind that were three more: evidence classified as `existing_coverage` rendered nowhere, because it matched none of the four kind-sections and its source was not a coverage-role source, so the official agenda citation was silently missing from a page whose entire job is showing citations. `formFromCluster` filed r/milwaukee as a corroborating source, which both inflated the independence count and let a dead Reddit link exclude a lead the rules should have kept. And `Why this surfaced` came out in database index order, putting the primary record third. None of the four could have been found by reading the code or the tests. All four took minutes to find once the page was on screen.

**Now believe:** For UI, "the data is correct" and "the page is right" are different claims with different evidence. A passing integration test proves a query returns a field; it cannot notice that no component renders it. The cheap habit that found all four was building a seeder that produces one finished record and then actually opening it — worth doing before the components are finished, not after.

---

## 2026-08-23 — A design that shows an impossible state teaches the wrong thing

**Expected:** Drawing the evidence page from the real tokens and the real fixture — every number computed by the actual rules engine — would make the design a faithful preview.

**Happened:** Two things in it were states the system cannot produce. The label read `Coverage gap` on a lead with a dead link; the rules give that lead `Needs a recheck`, because a reverification flag outranks the gap label. And every source's "found by" line showed one `site:city.milwaukee.gov` search — including a Journal Sentinel story, which that search can never return. Both were caught the same way: by running the manual backward trace the plan required, one link at a time, asking of each step "could this actually have happened?"

**Now believe:** A mockup drawn from real values is still a claim about behaviour, and it needs checking against the behaviour, not just the palette. The specific check that works is tracing one fact backwards through every hop and refusing to accept a hop you cannot justify — the same discipline the product is asking its users to apply to a lead. If a fixture cannot survive that trace, no amount of visual fidelity saves it.

---

## 2026-08-24 — Two layers each thought they owned the same number

**Expected:** Wiring the four stages (discovery, coverage, corroboration, enrichment) into one durable workflow would be plumbing — call the pieces earlier work already built, in the order the spec lists them.

**Happened:** Three separate defects, and every one of them only showed up at a seam between two pieces that had each been tested on its own and passed.

The first was about *order*: candidate evaluation ran immediately after gathering evidence, but the spec puts the coverage searches — checking whether other newsrooms already reported the story — *between* those two steps, because the answer changes whether the lead qualifies at all. Wiring it in file order would have judged every lead against a verdict that was one step away from being overturned.

The second was about starting an engine that was still wired to the ignition switch. A scan is meant to run in the background, so an editor's click returns right away and the scan keeps going after. The library that runs it (a "durable workflow": code that can pause, resume, and survive a crash mid-task) has a setting, `startAsync`, that tells it to hand off and run in the background. Without that one setting, it does the opposite: it runs the *entire* scan — all thirteen opening searches, every model call — immediately, inside the same click that started it. The editor's button would have sat there, unresponsive, for as long as the whole scan takes.

The third was a counter that two different pieces of code both thought was theirs to update. Item 5 built the rule "when one search finishes, add it to the scan's running total" — and built it correctly, with a guard so a retried search can't be counted twice. A later task, wiring the stages together, added a second rule that also added each stage's totals to the same number, not knowing the first rule already had. Every finished search was being counted twice: thirteen real searches showed up as twenty-six. The 120-search hard limit was untouched — it lives in a separate number that neither rule touches — but the "how many searches finished" total an editor would read was double the truth. It survived three separate task reviews because nothing had ever compared the scan's running total against the actual rows in the database; the first test that did caught it immediately.

**What we now believe:** A pipeline built and tested one stage at a time will pass every test written from inside that stage and still be wrong about the sequence and the bookkeeping it belongs to — because the defect's two halves live in two different tasks, and no single task's tests can see both halves at once. A vertical slice — one path through the whole system, built early — is what surfaces where the seams need to move, but only an end-to-end accounting test, one that checks the total against the parts rather than trusting either in isolation, can catch two well-tested pieces quietly agreeing to do the same job twice. That test should not be saved for last.

**A coda:** deleting the double-count exposed a second, smaller gap underneath it. The surviving rule — "add one to the counter when a search finishes" — turned out to have no opinion about whether the *scan* it belongs to was still running. A real search can take up to eighty seconds; if an editor cancels in that window, the search cannot be called back, and its answer arrives after the scan has already been marked finished. That answer's counter update was landing anyway, quietly changing a total that was supposed to be a permanent snapshot. This is the same "a finished scan cannot change" rule the project had already written down and defended twice before — which was the tell that it belonged inside the one function that moves the counter, not repeated at every place that calls it. Guarded there now, and proven with a test that reproduces the actual timing (reserve a search, finalize the scan, only then let the search finish) rather than a shortcut that skips past the timing entirely.

---

## 2026-08-25 — The demo data was the test that mattered

**Expected:** Building a fixture — a set of pre-made records used to fill a screen for testing — would be the small task at the end of the feed plan. The rules engine had been proven by 440 tests. The fixture just had to hand it some leads and let it work.

**Happened:** It produced thirty leads and **not one of them qualified**. Not because of a bug. Because of the rule the whole product rests on.

To qualify, a lead needs two *different kinds* of source confirming it — a news story **and** a city record, say. Three newspapers all reporting the same thing is three sources but only one kind, and one kind is not enough. That gate is deliberate: if three newsrooms have it, an editor is late, not early.

The captured Milwaukee search results contain fifty news stories and ten city records. No news story and no city record in that set are about the same thing. The only word appearing on both sides is "WHEDA" — once on a city event page, once in an unrelated grant announcement. Two different things wearing the same name.

So there was no honest way to make a single lead pass. The fixture could have been made to look good by asserting that the event page and the grant announcement were one story. That is precisely the invention the product exists to refuse, and an earlier session had already shipped a made-up lead once and been caught.

Two other things surfaced in the same pass, both the same shape. A demo card asked "What is the Zoning Committee taking up at 526 E Concordia Ave?" — but in the real city calendar entry that address belongs to a *different* body listed just after the committee. A real address attached to the wrong real organisation, on a card a human reads and believes. And a card carried a "duplicate" flag whose reader-visible words are *"it repeats a lead already in the feed"* — a claim the source data did not support. Both were removed rather than defended. Removing the flag cost the demo one of its ten reasons.

**Now believe:** Fixture data is not scaffolding, it is a claim about the world, and it deserves the same scrutiny as the product's own output — more, because nobody thinks to check it. Two habits did the work here. First, a provenance test: every seeded headline, link, publisher, date and excerpt is checked against the raw captured file, so inventing one fails the build. It caught a set of timestamps rounded to the minute before a human ever saw them. Second, and harder: when the honest data could not produce what the plan asked for, the right answer was to produce less and say so, not to bridge the gap with a plausible-looking inference. Every fabrication in this pass wore the same costume — a link between two real things that the evidence did not establish.

The finding itself is worth more than the fixture. Four hundred and forty passing tests could not reveal that the product's central gate never fires against real Milwaukee data, because every one of those tests supplies its own inputs. Only real data asks whether the inputs exist. That question now belongs to the live scan, not to a fixture.

**A coda on measurement.** A pagination bug in the same plan was fixed and the fix "proved" by watching the card count across a click. The proof used twenty-seven leads — but twenty-seven fit in a single click, and the defect only appears on the *second*. The measurement could not reach the thing it was certifying, and it took an independent reviewer walking the state machine to notice. Re-run against sixty-five leads, the old code visibly collapsed and the new code held. The lesson is not "measure" — that had been done. It is that a measurement has a reach, and the reach has to be checked against where the defect actually lives.

---

## 2026-08-26 — A pipeline can pass 443 tests and never once have run

**Expected:** The first live Milwaukee scan would mostly work. Every stage had been built and reviewed, 443 tests were green, and the parts had been exercised individually for weeks. Whatever broke would break at a seam.

**Happened:** It returned 294 real search results and produced **zero leads**. Behind that were three defects, and only the first was the one the failure appeared to be.

The obvious one was size: all 294 results went to the model in a single request that needed 27–38 minutes against a two-minute limit. Measurable, fixable, unsurprising.

The second was that **the work was being thrown away**. The system reads every search result and extracts the people, agencies, streets and claims in it — the expensive part. Then it hands the next step, the one that decides which results are about the same story, a list of bare ID codes and nothing else. The model was being asked "which of these 294 are the same story?" while shown nothing to compare. It had never once worked. The proof was one measurement: fed empty inputs it merged nothing at all; fed the real extracted entities it found three correct merges in forty results, and named them — *"both reference the Asian Street Food Festival at Veterans Park organized by Ka Vang."*

The third was the one that mattered. A lead's permanent identity is built from its entity names. With no entity names, **every lead got the same identity**, so each one overwrote the last. Two hundred and ninety-four separate stories would have become one lead claiming 294 sources corroborated it. It does not crash. It produces a confident, well-formed, entirely fabricated lead — and a scan that looks like it succeeded.

**Now believe:** Tests written stage by stage prove each stage against inputs the test itself supplies. They cannot notice that the stage upstream supplies something different, because no test ever runs the real handoff. Every one of these three defects lived in the gap between two well-tested pieces, and the suite was green through all of them.

Two habits did the work here, and neither is "write more tests."

The first is **running the real thing early, and reading the output rather than the exit code**. The scan that failed was worth more than the 443 tests that passed, because it was the first time anything ran end to end on real volume. The measurement that followed cost about a dollar and overturned the repair plan's central recommendation — the plan said batch 25 results at a time; measured, 25 takes 195 seconds and breaches the same limit we were trying to escape.

The second is **assertions about the shape of the output, not just its correctness**. Nothing in 443 tests asserted that a scan of N results yields more than one lead. That single line would have caught the worst defect on day one. The same class of gap appeared twice more in the same repair: a model answering about ten of twenty sources was recorded as a success, because nothing compared what came back to what was sent; and every test of the scoring layer was blind to one of its three inputs, because no test fixture happened to contain a date. In production that input flipped a pair the thresholds were specifically calibrated to keep apart.

**A coda on what the failures said.** When the repaired scan finally ran, seven of its 493 model calls were rejected — three for paraphrasing a quotation instead of copying it, two for quoting under twenty characters, one for citing a source id that does not exist, one for slipping a search operator into a snippet. The screen reported that as a failure. It is the opposite: the product refused to publish a fabricated citation, seven times, on live data. A pipeline whose failure messages name what it declined to do is worth more than one that only reports success.

---

## 2026-08-27 — Adding a beat cost more than the searches it bought

**Expected:** Adding a fourth beat — sports — would cost four extra searches per scan and produce a few more leads. The change was small: a config entry, a vocabulary member, four search templates, two test counts updated.

**Happened:** Three costs surfaced, and only the first was the one we had priced.

The first was arithmetic and we nearly got it wrong. The brief said each beat contributes three discovery searches. It is **four** — a Google News query, a Reddit query, a Spanish query, and an official-domains query. So the fixed opening set went 13 → 17, not 13 → 16. And 17 exceeded the discovery allocation of 16, which means the seventeenth search — the sports beat's official-domains query — would have been **silently skipped on every scan forever**. The beat would have run at three-quarters strength and nothing would have said so. It was caught by measuring the catalog rather than trusting the brief, and paid for out of the retry reserve so the 120-call hard cap never moved.

The second was that the scan then **stalled**. Sports took the scan from 285 sources to 368, and the evidence stage — which makes one model call per candidate, serially, inside a single Convex action — ran out of wall clock at around 280 candidates. It did not fail. It stopped, leaving a model-run row claiming to be in progress with no completion time, twenty-four minutes after a call whose hard ceiling is six. The previous scan had finished at 236 candidates in forty-five minutes. It was already near the edge, and nothing on the screen or in the data said so.

The third is that the number the diagnosis rests on is still unverified. The action time limit came from research a week ago, was flagged as unverified then, and is still being quoted now.

**Now believe:** A change is priced by the resource it obviously consumes, and the bill arrives from the one it does not. Sports was priced in SerpApi searches, which is where our budget discipline lives — there is a hard cap, a per-purpose allocation, and a committed test asserting the allocations sum. There is no equivalent for *time*: the evidence stage has no budget, no ceiling on candidates, and no tell. So the search cost was caught by arithmetic before the scan ran, and the time cost was caught by a sixty-minute stall.

The pattern to take from this is not "check the time limit too". It is that **the resource with the discipline is the resource that will not surprise you**, and it is worth asking, before a change ships, which resources it touches that have no discipline at all. A limit nobody has measured is not a limit; it is a rumour that happens to have been true so far.

A smaller note worth keeping: a killed action leaves a ledger row that lies. The row says `running`, and the code that would reopen it treats `in_flight` as a live call and refuses. So the crash did not only stop the scan — it made that one unit of work permanently unrepeatable. Evidence that cannot distinguish "still working" from "died mid-sentence" is evidence with a hole in it.

---

## 2026-08-29 — the backup and the thing that deletes it shared an account

**Expected:** finishing the saved-demo work would be the whole job — mark the
scan, export it, add the button, commit. The scan was the thing at risk, and
exporting it was the thing that made it safe.

**Happened:** three things, in order of how uncomfortable they are.

The first is small. The handoff said "run `npm run check`, expect 543 passed".
It was piped through `tail`, which reports its own exit code, so the run looked
green. It was not: four TypeScript errors in the new test file meant typecheck
failed and the tests never ran at all. A test suite that never executed reports
nothing, and it reports it very quietly.

The second is that the work was better than the note about it suggested. The
report stopped after step three. Steps four and five — the button, the label,
the two components — were built, unreported, and correct. An agent that goes
quiet has not necessarily stopped working, and reading only the report would
have meant rebuilding what already existed.

The third is the one that matters. Before every browser-test run, a setup step
wipes the test account clean. It looks up the account by whatever
`E2E_CLERK_EMAIL` names. It named Tarik's own account — the account that owns
the scan the whole session was spent preserving. So `npm run test:e2e` would
have deleted it, along with the 19 raw SerpApi archives that are deliberately
kept out of the committed fixture and therefore existed in exactly one place.
The export made the *rows* safe on the same afternoon that an ordinary test
command could still have destroyed the part the export does not carry.

**Now believe:** a backup is only a backup of what it actually contains, and the
gap between "we preserved it" and "we preserved the rows and left the files
where they were" is the whole risk. We had written that gap down honestly — the
report names `rawStorageId` as deliberately excluded — and still did not
connect it to the delete path standing right next to it. Naming an exclusion is
not the same as noticing what can reach the excluded thing.

The fix that held was not a guard on the delete. It was noticing that test data
and real data were living in the same account, which is the actual cause; the
delete was only the mechanism. The tempting fix — teach the wipe to skip the
saved demo — would have left them sharing an account and paid for the guard by
breaking the first-run test, which needs a genuinely empty workspace to check
what a new user sees. Separating the identities cost one throwaway account and
broke nothing. Decision 011.

And the smaller one, which keeps recurring: **a command's exit code is the exit
code of the last thing in the pipe.** `npm run check | tail` will tell you the
tail worked.
