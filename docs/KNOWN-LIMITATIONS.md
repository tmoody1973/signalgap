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

## 2. One qualifying lead is one news day, not a sample

Of 236 leads formed, exactly **one** cleared every gate. That single result is
the demo, and it should not be read as a hit rate.

The strictest gate requires two *independent categories* of source — an official
record and a news report, say, rather than two write-ups of the same press
release. It fired once in 236. Whether that is a strict rule doing its job or a
rule set too tight cannot be settled by one scan on one day. It needs more
scans, not more argument.

## 3. A live scan is not currently a reliable demo path

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

## 4. The saved copy is a faithful copy, with two exceptions

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

## 5. Reddit is never treated as verified

Reddit results are indexed through search and can suggest a story, but nothing
sourced from Reddit is ever counted as a confirmed fact or as one of the two
independent categories. This is a deliberate limit, not a gap.

## 6. Source counts in older documents disagree

The build checklist records "285 real sources" for the saved demo scan. The
database holds **308**. Nobody has traced where 285 came from — it may have
counted only reachable sources, or counted after removing duplicates. 308 is
what exists and 308 is what was exported.
