# Newsroom label vocabulary research

Note on sourcing: entries marked (fetched) come from directly fetching and reading the cited page. Entries marked (search) come from web-search result summaries — the phrase is attributed to the source but was not confirmed by reading the raw page text, so treat as directionally reliable, not a verbatim quote guarantee. No sources were invented; where search turned up nothing concrete, that is stated.

## A. Glossary of real newsroom terms found

- **Tip** — "a piece of information that suggests a potential story, or leads a journalist to investigate." — Poynter, [Journalism words: reporting terms](https://www.poynter.org/reporting-editing/2025/journalism-words-reporting-terms-off-the-record/) (fetched)
- **Lead** — the story-opening sense ("lede") and, informally, an unconfirmed thread a reporter is chasing. Poynter (above); Wikipedia, [Glossary of journalism](https://en.wikipedia.org/wiki/Glossary_of_journalism) (fetched)
- **Pitch** — "a proposal for a story idea." — Poynter (fetched)
- **Budget line** — "a line a reporter gives to an editor to propose a story... includes a slug and a brief story description." — Poynter (fetched). "On the budget" = allocated space/slot in an edition, discussed in budget meetings — general newsroom-workflow search summary (search)
- **Assignment** — "instruction to a reporter to cover an event." — Wikipedia, Glossary of journalism (fetched)
- **Spike / spiked** — "the act of withholding a story from publication, either temporarily or permanently, for editorial, political, or commercial reasons." — Wikipedia, [Spike (journalism)](https://en.wikipedia.org/wiki/Spike_(journalism)) (fetched). Poynter's shorter gloss: "to cancel or nix a story before publication." (fetched)
- **Developing story** — "an initial story has been written with established facts and will be updated as more facts become clear and available." — Poynter (fetched)
- **Embargo** — agreement not to publish before an agreed date/time. — Wikipedia, Glossary of journalism (fetched)
- **Beat / stringer** — background terms, not directly relevant to status labels. — Wikipedia (fetched)
- **Unconfirmed reports / unconfirmed sources** — used to flag content "not confirmed by any news agencies yet." — Byline Supplement, ['Unconfirmed Reports' and the Weasel Words](https://www.bylinesupplement.com/p/unconfirmed-reports-and-the-weasel) (search)
- **Could not independently verify** — standard wire/broadcast disclaimer, e.g. "CNN could not independently verify those claims" — StudentNewsDaily, [example](https://www.studentnewsdaily.com/example-of-media-bias/cnn-could-not-independently-verify-those-claims/) (search)
- **Conflicting reports / conflicting accounts** — phrase used when sources disagree during breaking coverage — DataJournalism.com, [Verifying User-Generated Content](https://datajournalism.com/read/handbook/verification-1/verifying-user-generated-content/3-verifying-user-generated-content) (search, general context only — page did not yield an exact quote)
- **Trust Project Indicators** — eight indicators (Best Practices, Author/Reporter Expertise, Type of Work, Citations and References, Methods, Locally Sourced, Diverse Voices, Actionable Feedback) used to signal how a piece was reported, not single-claim status labels. — [thetrustproject.org](https://thetrustproject.org/trust-indicators/) (search). Not a direct source of per-claim vocabulary like "unverified" or "conflicting" — it operates at the article/publisher level, not the claim level.
- **GOV.UK plain-English swaps** (pattern to apply, not 1:1 label matches): "facilitate" → run / be specific; "leverage" → use, influence; "utilise" → use; "deploy" → use, put in place; general rule — "describe what the user actually needs to do, rather than what government calls a thing." — [GOV.UK A-Z style guide](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/) (fetched)
- **Nielsen Norman "visibility of system status"** — status labels should give "clear, quick feedback" in the user's own words, not internal system terms — general NN/g heuristic #1 (search, paraphrase of well-established heuristic, not a direct quote)

First Draft's own verification-essentials page could not be fetched (502 error) and Storyful's/AP's/Reuters' formal internal style guides are not public, so exact-phrase confirmation for those specific outlets is limited to what other sources quote them saying (above).

## B. Per-label recommendations

1. **"Possible development"** → rename to **"Worth a look"** (alt: "Possible lead"). Rewrite: *"This might be a story — we haven't finished checking it yet."* (11 words)
2. **"Unverified signal"** → keep the word "unverified" (matches AP/CNN/wire usage), rename to **"Unverified tip"** (alt: "Not yet confirmed"). Rewrite: *"This points to something, but doesn't prove it happened."* (10 words)
3. **"Coverage gap detected"** → keep **"Coverage gap"** (already real journalism usage, e.g. news deserts framing), drop "detected." Rewrite: *"No one else has reported this in the last month."* (10 words)
4. **"Conflicting evidence"** → rename to **"Conflicting reports"** (matches breaking-news usage above). Rewrite: *"Sources disagree, and we haven't sorted out who's right."* (10 words)
5. **"Reverification needed"** → rename to **"Needs a recheck"**. Rewrite: *"The source we relied on doesn't hold up anymore. Check it again."* (12 words)
6. **"Eligibility changed"** → rename to **"No longer qualifies"** (alt: "Rules changed"). Rewrite: *"This lead doesn't meet the current rules anymore."* (8 words)
7. **"Partial"** → rename to **"Incomplete scan"**. Rewrite: *"Part of the search failed, so results may be missing."* (10 words)
8. **"Canceled—incomplete"** → rename to **"Stopped early"**. Rewrite: *"You stopped this scan before it finished."* (7 words)
9. **"Outdated"** → keep **"Outdated"** — plain and already newsroom-standard ("needs an update"). Rewrite: *"This brief is old. New information may have come in."* (10 words)
10. **"Saved—not live"** → rename to **"Saved copy"** (alt: "Snapshot"). Rewrite: *"Saved from an earlier scan — may not be current."* (9 words)

## C. Conflicts between newsroom norm and product's cautious intent

- **"Confirmed" vs "Verified"**: Newsrooms often use "confirmed" loosely for facts a second source backs up, while verification-community language (First Draft, Verification Handbook, Trust Project) uses "verified" more rigorously, tied to a documented method. SignalGap's product owner wants cautious language — recommend the product avoid "Confirmed" entirely for any label (it isn't in the original 10, but adjacent labels like "Coverage gap" or a future "reviewed" state should not drift into "Confirmed," which overclaims certainty the product cannot back up automatically).
- **"Developing story"**: In newsroom use this signals an *actively updating, already-published* story — the opposite of "still being checked before publication." Do not reuse "developing" for label 1 ("Possible development"); it would misread as "already running" to a journalist.
- **"Spiked"**: Real newsroom term for a human editorial decision to kill a story, often for reasons beyond truth (legal, commercial, political). Using it for label 8 ("Canceled—incomplete," a user-stopped scan) would misleadingly imply an editorial judgment call was made, when really the process just didn't finish. Recommend against "Spiked" for that label — "Stopped early" is more honest and less loaded.
- **Trust Project indicators operate at article level, not claim level** — they're not a source of single-claim status words (unverified/conflicting/outdated); don't lean on them for label copy, only cite them if the product later adds outlet-level trust signals.
