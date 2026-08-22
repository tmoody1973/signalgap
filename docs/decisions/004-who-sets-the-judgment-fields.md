# 004: Who sets the judgment fields the rules engine reads

## Decision

Before the AI layer is built (checklist item 6), every judgment field the rules engine reads must carry a marker saying who set it — a deterministic rule, an AI suggestion, or the editor. Where a field can be worked out by rule instead of by model, it will be. This decision is recorded now and implemented as part of item 6, not before.

The fields in question are the ones fed into `evaluateCandidate`: `localityBand` (is this really Milwaukee, and how directly), `relevanceBand` (does this concern a real change, a cultural impact, or nothing), `beat`, and the flags `isSpeculative`, `isRoutineCrime`, `isDuplicateOfCandidate`, `hasMaterialConflict`.

## Why this came up

SignalGap's central promise is "AI suggests; visible rules and editors decide." The rules engine (the plain-TypeScript code in `convex/editorial/` that decides whether a lead qualifies and what it scores) delivers on that in one important sense: no model can call it, and no model can write a label or a score.

A whole-branch code review found the gap. The engine's *inputs* are wide open. `localityBand` and `relevanceBand` together are worth 40 of the 100 points and control two of the reasons a lead can be thrown out. If the AI layer fills those fields, the model has effectively decided eligibility while the code still looks deterministic — and the evidence view would have no way to show an editor which judgments came from a model. That is precisely the confusion the product exists to prevent.

Nothing shipped is wrong today: no AI code exists yet. This is a fork in the road that has to be taken before item 6, because retrofitting provenance (a record of where a value came from) after the AI contracts are written is far more expensive.

## Options

1. **Let the AI fill the judgment fields, unmarked.** Fastest path to a working item 6. The cost is the honesty of the product's core claim: the demo would show a "deterministic" score built on unlabelled model opinions, and a judge who asked "who decided this was a Milwaukee story?" would get no answer from the interface.
2. **Forbid the AI from touching these fields; derive all of them by rule.** Maximum honesty, but not achievable. Whether an event is "routine crime without systemic beat relevance" or a "documented community impact" is a reading judgment; a keyword rule would get it wrong often enough to make the feed useless.
3. **Mark every judgment field with its source, and derive by rule wherever a rule can actually do the job.** More plumbing — a `basis` value stored beside each band, surfaced in the score breakdown — but it keeps the claim truthful and gives the editor the one thing they need to overrule the system intelligently.

## What we chose and why

Option 3, decided by Claude during the item 1–4 close-out and carried into the item 5–7 plan for Tarik to confirm. Option 1 fails the product's own principle in the exact place the hackathon judges will look. Option 2 sounds principled but would ship a feed nobody would trust for the opposite reason.

Two concrete commitments follow from it:

- `localityBand` gets a deterministic path first. `isOfficialDomain` already exists in `convex/config/officialDomains.ts` and is currently unused — an official City of Milwaukee domain in a lead's sources is a rule-provable `direct_city` signal, no model needed.
- Each band carries `basis: "deterministic" | "ai_suggested" | "editor"`, stored on the candidate and shown in the score breakdown. The pattern already exists in the database: `candidateSources.addedBy` records exactly this for source membership.

## What we gave up

- **Item 6 gets bigger.** The AI contracts now have to return suggestions plus a reason, and the persistence layer has to keep the marker. That is real hours taken from the SerpApi and evidence work.
- **More surface in the interface.** The score breakdown has to show provenance without becoming cluttered. Done badly it adds noise to the view that is supposed to make things clear.
- **Partial coverage, honestly labelled.** Only `localityBand` has a credible deterministic path today. `relevanceBand` and most flags will still be `ai_suggested` at demo time. We will be showing the editor an honest label, not a rules-derived judgment — which is better than hiding it, but it is not the same as solving it.

## How we'll know if this was right

At the demo, a reviewer can point at any score component and get a straight answer to "who decided this?" — and at least one component answers "a rule did." If the score breakdown ships with every band marked `ai_suggested`, we chose the right principle and ran out of time to honor it, and the README should say so plainly.

## What actually happened

<!-- Tarik fills this in after item 6 ships. -->
