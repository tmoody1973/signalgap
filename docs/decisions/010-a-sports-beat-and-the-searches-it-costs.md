# 010: A fourth beat — sports — and the three extra searches it costs

## Decision

SignalGap gains a fourth beat, keyed `sports` and labelled **"Sports, venues, and
recreation"**. Its search terms aim at the civic half of sports: the places, the
public money and the school and parks programs. The fixed opening set grows from
13 searches to 17, and the discovery allocation in the budget table moves from 16
to 20, taken out of the retry reserve so the 120-call hard cap does not move.

## Why this came up

The first successful live scan (2026-08-26) filed a WNBA story, a US Open story
and a thyroid tablet recall under **no beat at all**. That was correct behaviour —
none of them is housing, transportation, or arts and culture — but two of the
three are real Milwaukee news a newsroom would want. A beat is not decoration: a
lead with no beat cannot be filtered for, and the rules engine has an exclusion
reason called `no_beat_relevance`. Three beats was too few a vocabulary to
describe the city.

What was at stake if we got it wrong: search terms become live, paid SerpApi
queries on every scan, forever. Terms that are too broad turn a local-news
product into a national sports wire; too narrow and the beat costs money and
finds nothing.

## Options

1. **`sports` with broad terms** — team names, "game", "score", "season". Finds
   the most stories per search, and most of them are national wire copy about
   the Bucks and the Brewers that a Milwaukee newsroom already reads elsewhere.
   Real cost: pollutes the feed with the exact noise that made the last scan's
   sports stories look like mistakes.
2. **`sports` with civic terms** — stadium, arena, ballpark, athletics,
   recreation. Finds fewer stories, and the ones it finds are about public money,
   public land and public schools. Real cost: a Bucks trade will never surface
   from a search; it can only arrive through another beat's query and get
   *classified* as sports afterwards.
3. **A combined "sports and entertainment" beat**, as first asked for.
   Real cost: "entertainment" overlaps almost entirely with the existing "Arts,
   culture, and neighborhood life" beat — venues, festivals, shows — so two
   beats would compete for the same stories and the classifier would have to
   guess between them.

## What we chose and why

Option 2, with the label carrying more than the terms do. Decided by Claude on
the team lead's instruction to pick `sports` and justify the terms; the split
between a *narrow* search net and a *broad* label is the part worth naming.

The two levers are separate and it matters. `BEATS.sports.terms` decides what new
searches go looking for — that stays civic. `BEAT_TEXT.sports` is what the
classifier reads when it files a story that some *other* search already found —
"Sports, venues, and recreation" is wide enough to accept the WNBA story. So the
scan does not go hunting for scores, but when a score story arrives anyway, it
now has somewhere to live instead of nowhere.

The word "entertainment" is deliberately absent, per option 3's cost.

## What we gave up

- **A Bucks or Brewers story will not be discovered by this beat.** It can only
  be classified into it. If Tarik wants the beat to actively hunt pro sports,
  that is a terms change, not a label change, and it will pull national copy.
- **Three more paid searches on every scan**, 13 → 17. At SerpApi's per-call
  price that is a real, recurring cost for a beat that has not yet proven it
  returns anything.
- **Four calls out of the retry reserve** (34 → 30). The reserve exists to
  absorb retries and approved supplemental searches; it is now slightly thinner.
  Nothing today reads `SEARCH_BUDGET.reserve` in code, so this is a claim about
  headroom rather than a behaviour change — but it is a real claim.
- **The recall story still has no beat.** A thyroid tablet recall is health and
  consumer news. This change does not give it a home and does not pretend to.

## How we'll know if this was right

At the next live scan: do the four sports searches return Milwaukee results, and
are those results about venues, money, schools or parks rather than scores? If
`news-sports-en-01` comes back full of national box scores, the terms are wrong.
If all four come back empty two scans running, the beat is costing four calls a
scan for nothing and the terms are too narrow.

Second check: does any candidate get classified into `sports` that was *not*
found by a sports search? That is the label doing the job the terms deliberately
will not.

## What actually happened

<!-- Tarik fills this in after the next live scan. -->
