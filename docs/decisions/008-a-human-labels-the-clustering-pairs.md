# 008 — A journalist labels the clustering pairs, and the sheet hides the machine's answer

**Decision.** Ask Tarik to hand-label 107 real source pairs — every pair the
clustering code links or hesitates over, plus three seeded traps — and score the
software against his answers, without showing him what the software already
decided.

## Why this came up

Clustering decides which sources are covering the same story. That drives how
many *different kinds* of source confirm a lead, which decides whether a lead
qualifies at all. Everything proven about it so far is "precision by inspection":
someone read the merges and judged them reasonable. Nobody wrote the judgements
down, so nothing fails when a threshold quietly drifts — the tests could only
check that the code agrees with itself.

What was at stake: a threshold change that silently starts merging unrelated
stories would show up as *more* qualifying leads, which looks like the product
working better.

## Options

1. **Label nothing; keep reading merges by hand each time.** Free, and it is what
   we have. Costs: no test can fail, and the judgement lives in a person's head
   and in three long reports.
2. **Have the model label the pairs and grade the code against that.** Fast, and
   the model has already answered 89 of them. Costs: circular — the answer key
   comes from the thing being graded, and any shared blind spot scores as success.
3. **One human sitting over the pairs that matter, kept to about 40 minutes.**
   Costs: about 40 minutes of a journalist's time, and the answer key covers 107
   of 43,071 possible pairs, so it measures the scoring stage rather than the
   whole system.

## What we chose and why

Option 3, decided by Tarik in the task brief and implemented by Claude. The value
of the artifact is precisely that a journalist made the calls; the same file
graded against the model's own answers would be worth nothing.

Two calls inside it were Claude's:

- **107 pairs rather than the ~47 the research proposed.** The research's number
  came from a design that was never shipped. The shipped code produces 89 pairs it
  cannot call and 15 it merges on its own; both sets matter, for different
  reasons, and dropping either leaves a real number unmeasured. Grouping related
  pairs together is what keeps 107 inside one sitting.
- **The sheet does not show what the code decided.** A sheet that prints the
  machine's answer next to each pair collects agreement rather than judgement.

## What we gave up

The answer key covers only pairs the software already thought were worth
comparing. A pair of reports on the same story that share no distinctive word is
never proposed, never labeled, and therefore invisible to the score — the system
can look excellent while missing an entire class of story. Two such misses are
seeded by hand as a partial check; two is not a measurement. Measuring that
properly means sampling from the 41,865 pairs the software never compared, which
is a much longer sitting and a different question.

We also gave up speed: the tests that consume the labels sit skipped until a human
does the work.

## How we'll know if this was right

- The precision and recall floors, once set from Tarik's labels, go red on a
  clustering change nobody intended. It has already been demonstrated on a
  stand-in file: dropping the link threshold from 4 to 3.5 produced three merges
  of pairs marked "different", and the test named all three.
- Tarik's answers on the ten football pairs settle a question the reports have
  been arguing about — whether we are measuring "same story" or "would make a
  lead".

## What actually happened

_(left blank for Tarik)_
