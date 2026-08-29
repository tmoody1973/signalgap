# Known limitations

What this product does not do well, stated plainly, with the numbers that show
it. Written for a reader who has to decide whether to trust the demo.

Everything here is measured, not estimated. Where a number is unverified, it
says so.

---

## 1. The lead counts and the lead rows disagree by nine

The saved demo scan reports **236 leads** — 1 that qualified, 235 that did not.
The database holds **227** rows for those leads. The feed's tab reads
"Did not qualify (**235**)", and the list behind it can show at most **226**.

Anyone who scrolls that list to the end comes up nine short.

**Why it is not quietly fixed.** One file, `convex/candidates/evaluate.ts`, is
the only thing in the codebase allowed to write those counters. That rule is the
reason a score or a label can never be set by the AI, or by a retry, or by a
convenience patch somewhere else. Correcting the number from outside that file
would buy a tidier demo by breaking the single invariant the product's
credibility rests on. So the number stays wrong and the reason is written down.

**What we do not know:** why nine leads were counted but left no row. The most
likely explanation is a step that failed partway through forming those leads,
after the counter went up and before the row was written — the scan does record
`brief: invalid_output` among its failures. That is a hypothesis, not a finding;
nobody has traced it.

A second instance of the same shape: the scan reserved **28** searches but left
**25** search records. Three reservations produced no row.

## 2. The 30-day coverage check searches the headline, not the story

This is the most serious defect on this list.

To decide whether a story has already been covered, the product searches local
news outlets for prior reporting. **It searches for the headline of the source
that started the lead, as an exact phrase** — not for what the story is about.

For the demo lead, the phrase it searched was:

```
"Milwaukee County Executive David Crowley Announces ..."
```

That is a headline the search engine had already cut short, ellipsis and all.
The story's actual subject — MCTS, the $13.9 million federal grant — never
appeared in the query. So the check came back with any Crowley announcement it
could find: a community centre, a person, an election result. Those three
articles are visible in `Existing coverage` on the lead page, and they have
nothing to do with the story.

**How widespread.** Of 227 leads in the saved scan, **9** carry a headline the
search engine truncated and **21** carry a Reddit thread title. Searching
`jsonline.com` for `"Renter rights?? : r/milwaukee"` cannot succeed. But the
problem is not confined to those 30: searching for a headline finds
*republications of that headline*, which is not the same question as *has anyone
else reported this story*.

**Which way it fails, and why that matters.** Irrelevant matches make a lead look
*more* covered than it is, which is the safe direction — it makes the product
more reluctant to call something a coverage gap. The dangerous direction is the
other one: a story that genuinely *has* been covered, whose headline happens to
be unusual, returns nothing and gets labelled a **coverage gap**. The code that
draws that section says it plainly — claiming an absence of reporting is "the
most damaging thing this product could get wrong."

**Not fixed before submission, deliberately.** The fix is to search the story's
entities and claims, which the pipeline already extracts and stores. But the
saved demo is frozen data: changing what future scans search would not change
what the demo shows, and it would leave the code and the demonstrated data
disagreeing about how coverage was decided. A live scan cannot currently be
relied on to produce a fresh one (see below). So the defect is named here rather
than half-fixed.

**What is NOT known:** whether the one qualifying lead would still qualify under
a correct coverage search. Nobody has run that check.

**And that question is only half-answerable without spending a search.** The two
halves are not symmetric, which is the trap:

- **The archive can prove the lead FAILS.** If the 308 sources already captured
  in this scan happen to contain three or more qualifying original local reports
  about the grant, then a correct coverage check would have found them and the
  lead loses its `Coverage gap` label. That is decidable from the committed
  fixture alone.
- **The archive can never prove the lead HOLDS.** Finding nothing in what was
  captured is not evidence that a correct search would find nothing. The broken
  query is the very reason the right sources were never fetched in the first
  place — absence in the archive is absence of a search, not absence in the
  world.

So an offline check ends in one of two places: "it definitely no longer
qualifies", or "unresolved, and it needs one real coverage search to settle."
A null result is **not** a clean bill of health, and reading it as one would be
exactly the kind of claim the rest of this product is built to refuse.

Root cause: `convex/candidates/coverage.ts`, `termsFor` — it returns
`candidate.currentTitle` truncated to 80 characters.

## 3. One qualifying lead is one news day, not a sample

Of 236 leads formed, exactly **one** cleared every gate. That single result is
the demo, and it should not be read as a hit rate.

The strictest gate requires two *independent categories* of source — an official
record and a news report, say, rather than two write-ups of the same press
release. It fired once in 236. Whether that is a strict rule doing its job or a
rule set too tight cannot be settled by one scan on one day. It needs more
scans, not more argument.

## 4. A live scan is not currently a reliable demo path

The second full scan (2026-08-27, four beats, 368 sources) **stalled at roughly
280 leads and had to be cancelled.** The stage that checks evidence makes one AI
call per lead, one after another, inside a single server task, and ran out of
wall clock. It did not fail — it stopped, leaving a record claiming to still be
running twenty-four minutes after a call whose ceiling is six.

This is why the saved fallback exists.

**Unverified:** the server task time limit is believed to be about 30 minutes.
That figure came from research and **has never been confirmed first-hand.** It
should not be quoted as fact.

A related consequence: a task killed this way leaves a ledger row that reads
"running" forever, and the code that would retry it treats that as a live call
and refuses. So that one unit of work becomes permanently unrepeatable.

## 5. The saved copy is a faithful copy, with two exceptions

The saved demo reproduces the scan verbatim out of the database. Two things
cannot travel:

- **The raw search archives.** The untouched JSON that SerpApi returned for each
  search — 19 files — stays in file storage and is deliberately not committed,
  because publishing paid API payloads to a public repository is not something
  we want to do. The saved copy restores every lead, source, score and brief;
  it does not restore those 19 files.
- **Row creation times.** The database assigns those and they cannot be set, so
  restored rows carry the moment of the import. Nothing in the product orders by
  them — the feed orders by score, then by when a lead was first seen — but not
  every consumer has been checked.

The saved copy is always labelled. `Saved copy`, plus the exact capture moment,
appears above the scan's numbers and again at the top of every lead opened from
it. It is never selected automatically; a person has to press
`Open saved demo scan`.

**Unverified:** the exported fixture has been imported back into the deployment
it came from, twice, and proven not to double. It has **never been imported into
a fresh deployment.**

## 6. Reddit is never treated as verified

Reddit results are indexed through search and can suggest a story, but nothing
sourced from Reddit is ever counted as a confirmed fact or as one of the two
independent categories. This is a deliberate limit, not a gap.

## 7. Source counts in older documents disagree

The build checklist records "285 real sources" for the saved demo scan. The
database holds **308**. Nobody has traced where 285 came from — it may have
counted only reachable sources, or counted after removing duplicates. 308 is
what exists and 308 is what was exported.
