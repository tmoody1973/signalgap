# 009 — Deterministic clustering, with AI only in the unclear band

**Decision:** Group a scan's search results into stories with plain code, and ask the AI only about the pairs the code cannot call.

## Why this came up

SignalGap searches the web, then has to work out which results are about **the same story**. That matters more than it sounds: a lead only qualifies if two *different kinds* of source confirm it — a news story and a city record, say. So "are these two the same story?" is the question that decides what a journalist ever sees.

The original design asked the AI to do the whole job: here are 294 search results, tell me which ones go together.

On 2026-08-25 we ran the first live Milwaukee scan. It returned 294 real results and produced **zero leads**. The AI call ran for 238 seconds against a 120-second limit, failed three times, and the scan ended with nothing.

Investigating that failure turned up three separate defects, and only the first was the one we thought we had:

1. **Too much in one call.** Measured: each result costs ~700 output tokens and ~7 seconds to analyse. All 294 in one request needed 27–38 minutes.
2. **The AI's work was being thrown away.** The system extracted the people, agencies, streets and claims from every result — then handed the clustering step empty strings. It was asking "which of these 294 are the same story?" while showing the model 294 bare ID codes and nothing else.
3. **Every cluster collapsed into one lead.** A lead's identity is built from its entity names. With no entity names, every lead got the *same* identity, so each one overwrote the last. 294 stories would have become **one lead claiming 294 sources back it up** — a confident, well-formed, entirely fabricated lead.

What was at stake if we got the fix wrong: defect 3 does not crash. A scan would have looked successful and produced a lie.

## Options

**A. Make the AI call fit — batch it.**
Split the 294 into smaller groups. Cheap to build, and it is what the first draft of the repair plan recommended.

Its cost, and why it was wrong: a story can span *any two* of the 294. Splitting them into batches means two outlets covering the same vote can land in different batches and never be compared. The product's core function would fail silently, and the scan would look like it worked. It also would not have touched defects 2 or 3.

**B. Let the AI keep deciding, but fix the plumbing.**
Feed it the entities it already extracts, keep it as the single decision-maker, raise the timeout.

Its cost: a model still decides which sources corroborate each other, which is the input to whether a lead qualifies. That sits awkwardly against the product's central claim — *AI suggests, rules decide*. It is also unfixable when it gets something wrong: there is no threshold to tune, only a prompt to reword.

**C. Deterministic first, AI only in the unclear band.**
Plain code narrows 43,071 possible pairs to about 1,200 by looking for rare shared words. Code then scores each: clearly the same → link it, clearly different → drop it. Only the genuinely unclear middle — about 89 pairs — goes to the AI, as yes/no questions about one pair at a time.

Its cost: real new code (a blocking index, a pair scorer, a grouping pass, a new AI operation), and two tuning thresholds someone has to own.

## What we chose and why

**Option C.** Joint call — Claude proposed it after research, Tarik approved it on 2026-08-25.

Measured against the same 294 real results:

| | The old AI call | Option C |
| --- | --- | --- |
| Time | 238s (timed out) | **22 seconds** |
| Cost | $0.48 | **$0.11** |
| Merges found | **0** | **54** |

The deciding argument was not speed or cost. It was that clustering is a decision the product claims *rules* make, and Option C is the only one where that is true. 15 merges are made by code that can be read and tested. 1,102 pairs are rejected by code. The AI is asked 89 yes-or-no questions and cannot see the other 43,000 pairs at all.

The AI still earns its place. Graded against Tarik's hand labels: code alone finds **25%** of the merges he marked; code plus AI finds **90%**. And it caught a merge no rule would ever make — a festival article matched to the Reddit thread about it.

## What we gave up

- **Stories that share no distinctive word are never compared.** Blocking trades recall for precision. One known miss: the mayor's bike ride and the festival it happens *at* share almost no text. The AI knew they were connected; no word-matching reaches that. It is pinned by a test named `KNOWN MISS` so it goes red the day anything finds it.
- **Two tuning thresholds are now a liability someone owns.** They decide which leads qualify. Set wrong, they silently change the feed.
- **We deliberately chose precision over recall and left recall on the table.** A looser setting would have caught the known miss — and also merged a Denver hit-and-run with a Dodge County motorcycle crash, and two unrelated restaurant threads. A wrong merge is the error nothing downstream can undo: it inflates the count that decides whether a lead qualifies. The full trade table is in `docs/research/2026-08-25-evidence-pipeline/research-clustering.md`.
- **Cross-language pairs are the likeliest quiet failure.** A Spanish and an English report of one story share few words. We block on the translated text too, but that path is untested against real translations.

## How we'll know if this was right

- **Tarik labeled 107 pairs by hand on 2026-08-26.** The pipeline is graded against those labels on every test run: **precision 1.00, recall 0.90**, with precision pinned at 1.00 so a single wrong merge fails the build and names the pair.
- **The first live scan after the repair** (2026-08-26) produced 236 leads and one that qualified — a $13.9M MCTS federal grant story, labeled `Coverage gap`, with two independent source categories and seven interview questions. The label had never appeared before.
- **The number to watch:** whether one qualifying lead per scan is the rule holding the line or the rule being too strict. One scan is one news day. It needs more.

## What actually happened

_(Tarik fills this in.)_
