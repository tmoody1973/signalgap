# Model evaluation

Mode: **re-scored**. The model answers are the saved output of the live run on 2026-08-22; only the checks were re-run, at no additional cost.
Model: `claude-sonnet-5`. Challenger: **none** — no `OPENAI_API_KEY` is configured, so this is a single-model run and not a comparison.
Packets: 18 (14 objective, 4 not yet reviewed by a person).
Prompt version and schema version are identical across models.

## Per check

| Check | Passed |
| --- | --- |
| source binding | 18/18 |
| citation completeness | 6/6 |
| source type = primary | 2/2 |
| source type = discussion | 1/1 |
| keeps "9-4" | 1/1 |
| detects es | 1/1 |
| original kept beside translation | 1/1 |
| no promotion in the brief | 1/1 |
| nothing claimed as confirmed | 1/1 |
| conflict preserved | 1/1 |
| records conflicting_claim | 1/1 |
| flags material conflict | 1/1 |
| no promotion to confirmed | 1/1 |
| no over-merge | 1/1 |
| syndication detected | 1/1 |
| no executable search | 1/1 |

## Totals

| Measure | Value |
| --- | --- |
| Invalid-output rate | 0/18 |
| Checks passed | 39/39 |
| Median latency | 19,687ms (from the live run) |
| Input tokens | 42,166 (from the live run) |
| Output tokens | 39,477 (from the live run) |
| Estimated cost | $0.7187 (the live run; re-scoring cost nothing) |

## Per packet

| Packet | Dimension | Review status | Result | Checks |
| --- | --- | --- | --- | --- |
| `analyze-news-01` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-news-02` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-news-03` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-news-04` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-news-05` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-news-06` | claim-to-source validity, citation completeness, invalid-output rate | objective | valid | 2/2 |
| `analyze-official-01` | source-type suggestion on official records | unreviewed | valid | 2/2 |
| `analyze-official-02` | source-type suggestion on official records | unreviewed | valid | 2/2 |
| `analyze-reddit-01` | discussion is never treated as confirmation | objective | valid | 2/2 |
| `analyze-spanish-01` | Spanish meaning preservation | unreviewed | valid | 4/4 |
| `brief-promotion-01` | the model cannot promote a claim to confirmed | objective | valid | 2/2 |
| `brief-thin-01` | brief cautiousness when evidence is thin | unreviewed | valid | 2/2 |
| `classify-conflict-01` | conflict preservation | objective | valid | 4/4 |
| `classify-reddit-01` | the model cannot promote a claim to confirmed | objective | valid | 2/2 |
| `cluster-distinct-01` | clustering precision / over-merge rate | objective | valid | 2/2 |
| `cluster-syndicated-01` | press-release and syndication detection | objective | valid | 2/2 |
| `plan-budget-01` | budget respect | objective | valid | 1/1 |
| `plan-intent-01` | no executable URL or raw parameter | objective | valid | 2/2 |

## Chosen primary

`claude-sonnet-5` stays the primary model. It produced no invalid output across 18 packets, it did not invent a source or a quotation, it preserved a contradiction rather than resolving it, it kept a Spanish original beside its translation, and it never returned an executable search. The plan's rule was that Sonnet stays primary unless the evaluation shows a material traceability or quality deficit; it does not.

A challenger could not be run: no `OPENAI_API_KEY` is configured, so `AI_FALLBACK_ENABLED` is false. This is a single-model measurement, not a head-to-head. Median latency near 19 seconds per operation is the number that matters for the scan workflow, not the cost.

## What this does not tell you

- 4 packets carry expectations drafted by the build script and **not confirmed by a person**: `analyze-official-01`, `analyze-official-02`, `analyze-spanish-01`, `brief-thin-01`. Treat their scores as provisional.
- "Brief usefulness" is not measured. Cautiousness is checked only as "did it avoid asserting the unverified claim".
- There is no challenger model, so nothing here compares Sonnet to an alternative.

