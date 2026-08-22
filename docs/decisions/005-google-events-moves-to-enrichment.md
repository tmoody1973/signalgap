# 005: Google Events moves from discovery to enrichment

## Decision

Google Events stops being one of the fixed searches SignalGap runs at the start of every scan. The connector stays built and tested, but it now runs only as conditional enrichment — the same place the spec already puts YouTube and Google Maps. The fixed opening set drops from 16 searches to 13.

## Why this came up

The approved spec lists nine source families and gives Google Events three of the sixteen searches that open every scan — one per beat. While capturing real response samples for each engine, the Events searches came back with nothing. Twice.

Rather than assume Milwaukee simply has thin event coverage, we tested it properly. Three more live calls, each one narrowing the question:

| Query | Result |
| --- | --- |
| `events in Milwaukee` | 0 results |
| `events in Chicago` | 0 results |
| `Events in Austin` — SerpApi's own documentation example | 0 results |

Every one returned the same message: *"Google hasn't returned any results for this query."* With and without a location parameter. The same parameters work on every other engine we call.

That last row is what settled it. When a vendor's own published example returns nothing, the problem is not the city, not the beat terms, and not our code — the engine is broken upstream. Google appears to have changed the events layout that SerpApi reads, and SerpApi has not caught up.

## Options

1. **Keep Events in the fixed sixteen and report the emptiness honestly.** No deviation from the approved spec, and SignalGap already has machinery for naming a source family that failed. But it burns three searches per scan on an engine known to return nothing, and the demo would show a source family that is visibly empty — inviting exactly the question we would rather answer on our own terms.
2. **Replace Events with three more searches from a family that works** — more official-domain queries, say, or promoting YouTube from enrichment to discovery. Keeps sixteen opening searches, but quietly drops an approved source family and rebalances discovery without evidence that the replacement is the better use of those three calls.
3. **Move Events to conditional enrichment.** The connector remains written, tested, and callable, so the "one credible, tested route per source family" promise still holds. It simply stops consuming discovery calls it cannot repay. The fixed opening set becomes thirteen.

## What we chose and why

Option 3, decided by Tarik. Option 1 spends real budget on a known-dead call and makes the product look weaker than it is — a judge seeing an empty family reasonably wonders whether the other eight are solid. Option 2 solves the symptom by hiding it.

Option 3 is the only one that is both honest and cheap: nothing is deleted, nothing is pretended. If SerpApi fixes the engine before submission, Events starts producing enrichment results with no code change at all — and promoting it back into discovery is a one-line edit to the catalog.

## What we gave up

- **A documented deviation from the approved spec**, which places Events in discovery. That deviation now has to be stated plainly in the README and the submission rather than glossed over.
- **Three fewer opening searches**, so the first pass over the public web is slightly narrower. In practice this costs little, since those three were returning nothing.
- **An untested normalizer.** Because the engine returns no data, the Events branch of our result-normalizing code is still checked only against a hand-written sample rather than a real response. It is marked as such in the fixture file. If the engine comes back, that branch needs a real payload before we trust it.
- **A claim we can no longer make cleanly.** "Nine source families, all live" becomes "nine wired, eight returning data today." That is the truthful version, and stating it is the point — but it is a weaker headline.

## How we'll know if this was right

At the live Milwaukee scan, the thirteen fixed searches should return usable signals across the remaining families, and no scan should burn calls on an engine that cannot answer. If SerpApi restores the engine and Events starts producing relevant Milwaukee results as enrichment, promoting it back to discovery should be a one-line change — if it turns out to be more than that, we coupled it too tightly to the enrichment path.

## What actually happened

<!-- Tarik fills this in after the live scan. -->
