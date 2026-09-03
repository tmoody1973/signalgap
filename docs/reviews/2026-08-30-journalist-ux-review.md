# Would a journalist use this? A first-contact review

**Date:** 2026-08-30
**Reviewer:** Claude, walking every screen as a skeptical assigning editor at a small Milwaukee newsroom
**Method:** signed in fresh, drove the workspace, the saved scan, the ranked feed, the rejected list, the flagship lead page, a rejected lead page, the Compare link, and both main pages at phone width. Screenshots and page text captured for every step. Claims below cite what was on screen.
**Feeds:** checklist item 11, "close gaps found at the three pauses."

---

## The verdict

A journalist would understand what SignalGap is for in about thirty seconds. They would not use it, for one structural reason and three presentational ones.

**The structural reason: it dead-ends.** You read a lead and there is nothing to do with it. The only interactive control on the lead page is Dark mode. No assign, no monitor, no reject, no note. The PRD's core journey has nine steps; the product stops at seven.

**The presentational reasons reduce to one sentence:** the screens are ordered by how the system works, not by what the editor needs.

The bones are good. The hierarchy is inverted and the workflow is unfinished. Both are fixable, and most of the fixes are cheap.

## Who this review pretends to be

An assigning editor at a small Milwaukee outlet with three to six reporters. Overwhelmed. Two hundred press releases a week. Knows the city cold. Skeptical of AI, partly because it makes things up and partly because "AI-generated" is an insult in their world. Wants stories nobody else has, a name to call, and a reason to spend a reporter's day.

## What they experience, in order

### The landing page

One sentence explains the product: "Finds Milwaukee developments that appear across several public web signals but have limited verified local coverage, then drafts a source-linked reporting brief for a human editor." Accurate, and not in their language. "Public web signals" is engineering. They would say "stuff online." "Limited verified local coverage" is the hook, and it is buried in the middle of the sentence.

The best line on the page is below the sign-in button: **"Labels say what SignalGap checked. They never say a story is true."** A reporter will respect that sentence. It should be the first thing they read, not the last.

### The workspace, first landing

The heading reads "Latest scan." Under it: **Stopped early. 0 ready, 0 did not qualify, 0 still working.** A dead machine. That is the actual state of the deployment right now, because the newest scan was cancelled.

Two buttons: "Run new scan" and "Open saved demo scan." To a journalist, "demo" means fake data. They choose one on faith.

### The workspace, saved scan

The top 900 pixels are a pipeline status panel. Four stage rows all reading DONE. A search-budget counter: "28 of 120 searches used, 9 failed." Four failure strings, including:

```
2 of 29 analyze batches failed: batch 5 invalid_output; batch 6 invalid_output
brief: invalid_output
```

A reporter reads `invalid_output` and concludes the product is broken. Naming failures is the right instinct and this project defends it. Naming them in code is not the same thing.

Below all of that: **1 ready, 235 did not qualify.** Twenty-eight searches and one story. The reporter's reflex is "I could find one story in five minutes on Twitter." The 235 is shown as a count, not as evidence of a strict standard.

### The rejected list

Every card carries an AI-written question about something that has nothing to do with Milwaukee:

> Is there a Wisconsin/Milwaukee-relevant WNBA story behind this trending search term, and if so, what is it?

> Is there a Vitruvias Therapeutics thyroid tablet recall, and if so, what are its scope, cause, and relevance to Wisconsin/Milwaukee consumers?

Under each, the same five-reason run-on sentence, verbatim, 235 times:

> Did not qualify: nothing ties it to Milwaukee, only one kind of source confirmed it, and two are required, it does not fall in a covered beat, the check for existing coverage did not finish, and the claim is speculation, not a reported development.

And every card is labelled **Housing and neighborhood development.** Checked against the fixture: **129 of the 227 leads carry the housing beat**, including "Dumpster Rental : r/milwaukee," "Helping moving couch Asap!!," and "Nice place for a real splurge dinner?" This is the beat-classification bug fixed on 2026-08-27, frozen into a saved scan captured on 2026-08-26.

The rules rejected all of these correctly. The presentation makes the AI look stupid rather than the rules look strict.

### The flagship lead

The reporting question as the headline is smart. It is how editors actually think, and the compact metadata line beneath it (70 of 100, 4 sources, 2 prior reports, New) is exactly right.

Then a five-row score table. Then "Why this surfaced," which is good. Then three headed sections that are **empty**: Confirmed facts (none), Unverified signals (none), Conflicting claims (none). On the one qualifying lead, the product's central promise, "every confirmed fact has a working citation," has zero facts to show. The single "potential human source" is the County Executive who issued the press release, whom no reporter needs a tool to find.

About 2,500 pixels down, the brief's summary:

> A county press release announcing a $13.9m grant to modernize the MCTS bus fleet was picked up by multiple local outlets, suggesting public interest but limited independent reporting beyond the original announcement.

**That sentence is the product.** It is the coverage gap in one line. It is the last thing the reader reaches.

Below it, seven interview questions. "Will MCTS need to provide matching funds, and if so how much?" "Has the grant been finalized, or is it pending federal approval?" A reporter would use these. They are the second-to-last section on a page that is 6,116 pixels tall on a phone.

Then the page ends. Nothing to click. The reporter closes the tab.

### Compare scans

The link in the primary navigation goes to a page that returns **404.**

### On a phone

The workspace's first full screen is the status panel. The single lead is at the bottom. The lead page is 6,116 pixels; the query log's `site:` lists wrap into unreadable blocks.

## What is genuinely good and should not be touched

- The reporting question as the lead's headline.
- The labels, and the line "They never say a story is true."
- The query log, with "You can run any of these yourself."
- The interview questions.
- The brief's summary sentence.
- The instinct to name failures rather than hide them.
- The score breakdown showing its reasons.

A journalist will respect every one of these. They need to encounter them before the telemetry, not after.

## What to change, in order

| # | Change | Why | Cost |
| --- | --- | --- | --- |
| 1 | Add Assign, Monitor, Reject and a note field to the lead page | Turns a report into a desk. Without this, nothing else matters. | Real work, checklist item 9 Part B |
| 2 | Invert the workspace: leads first, scan status collapsed to one line with a details toggle | The editor came for leads, not telemetry | Cheap, mostly moving JSX |
| 3 | Invert the lead page: brief summary and interview questions directly under the headline; score and evidence below; empty sections collapse to one line | The value is at the bottom | Cheap |
| 4 | Re-export the saved demo after the beat fix | 129 wrong labels in the most-clicked list | One export run, plus re-verifying the fixture |
| 5 | Stop generating reporting questions for rejected candidates; show the source title. Render rejection reasons as short chips, not a sentence | The AI's weakest output is front and center | Medium |
| 6 | Translate the failure strings into English | Code-speak on the main screen reads as broken | Trivial |
| 7 | Rename "Saved demo scan" to "Saved scan, Aug 26" | "Demo" says fake | Trivial |
| 8 | Remove "Compare scans" from the nav until it exists | A 404 in primary navigation | Trivial |
| 9 | Anchor the score with a word or a legend | 70 means nothing without a reference | Small |

## What this review did not check

Dark mode on every screen. Keyboard navigation through the feed filters. How any of this reads to a reporter who is *not* skeptical of AI. The review took the hard case on purpose.

## Evidence

Screenshots and page-text dumps for every step were captured during the walk on 2026-08-30 and are referenced above. The beat count was verified directly against `tests/fixtures/demo/demo-scan.json`. The 404 was captured at `/compare`. The "only interactive control is Dark mode" claim came from enumerating every `button`, `a[role=button]`, and `select` on the lead page.
