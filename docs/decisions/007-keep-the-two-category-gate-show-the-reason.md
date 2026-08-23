# 007 — Keep the two-category gate; make the screen say why

## Decision

A lead still needs two independent *kinds* of source to qualify. Three
newsrooms all filing news stories is one kind, not two, so it stays excluded.
What changes is the screen: an excluded lead now names the rule it failed, in
plain language, instead of stopping at "did not qualify".

## Why this came up

The lead built for Review Pause 2 is real captured Milwaukee data — the
Metcalfe Park Liberation Hub, August 2026. Three independent Milwaukee outlets
covered it: the Journal Sentinel, Urban Milwaukee, and the Business Journals.
There was also a public Reddit thread.

SignalGap refused it. The independence rule counts *categories* of source, not
outlets, and all three stories sit in one category (`original_news`). No
official record naming the project appeared in the captured payload, and
inventing that link is the fabrication the product refuses.

That looked like the rule being too strict. What was at stake was the product's
core claim: SignalGap earns its place by telling an editor **nobody has this
yet**. If the rule bends, the feed fills with stories everyone already ran, and
the tool becomes a clip service an editor already has for free.

## Options

1. **Loosen the gate.** Let three or more separate outlets qualify a lead on
   their own. Cost: the feed fills with well-covered stories. Every editor
   already gets those from Google Alerts. The one thing SignalGap is for —
   surfacing under-reported developments — gets diluted by the thing it is
   competing with.

2. **Keep the gate, keep the screen as it was.** Cost: an editor opens a lead
   and reads "this lead did not qualify, so it has no score" with no further
   explanation. That is a dead end. Worse, it is the exact black box this
   product promises never to be — a verdict with its reasoning hidden.

3. **Keep the gate, and make the screen name the failed rule.** Cost: a small
   schema addition and a wording table that has to stay in step with the rules
   engine. The reason list is now a user-facing surface, so a new rule cannot
   ship without wording an editor can read.

## What we chose and why

Option 3. **Tarik made the call**, asking what an assigning editor would want
if they used this every morning. The answer was: do not loosen the rule —
three newsrooms means I am late, not early — but never show me a blank.

Naming the failed rule turns a dead end into something an editor can act on.
"Only one kind of source confirmed it, and two are required" tells a reporter
exactly what is missing. They can pull the permit themselves, and the lead
becomes a story. That judgment is a human's to make, and the tool's job is to
hand over the missing piece rather than hide behind a verdict.

The reasons already existed. `convex/editorial/eligibility.ts` builds the list
on every evaluation; `convex/candidates/evaluate.ts` returned it and dropped it
on the floor. Nothing about the rules changed — the reasoning was simply never
saved (persisted, meaning written to the database rather than computed and
discarded).

## What we gave up

The wording table is a second place a rule lives. Add an exclusion rule to the
engine and forget the sentence, and the page shows one fewer reason than the
engine found. A unit test compares the two lists and fails the build if they
drift, which catches the omission but not a sentence that is merely wrong.

We also accepted that some genuinely interesting leads stay excluded. The
Metcalfe Park lead is one. It is now excluded *legibly*, which is better, but
it is still excluded, and an editor has to do the extra step themselves.

## How we'll know if this was right

- On the review lead, an editor can state in one sentence what is missing,
  without opening the code or asking anyone.
- No exclusion rule ships without its sentence — the sync test stays green.
- When the feed goes live, excluded leads that an editor rescues by hand should
  be the ones whose named reason pointed at a document they could go and get.
  If the named reasons are never actionable, this was decoration.

## What actually happened

_(Tarik fills this in.)_
