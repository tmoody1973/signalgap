# 003: Newsroom-language product labels

## Decision

Rename all ten SignalGap status labels (the small tags on each lead, like "Coverage gap") to plainer, newsroom-style wording, and rewrite their one-line explanations to match. The internal keys used in code (`possibleDevelopment`, `coverageGap`, and so on) do not change — only the words a person actually sees.

## Why this came up

Tarik reviewed the label legend (the panel that lists every label and what it means) and found the wording was spec-speak — accurate, but written the way a requirements document talks, not the way a newsroom talks. Terms like "Reverification needed" or "Eligibility changed" read like system-status jargon rather than something an editor would say out loud to a colleague. We did research into real newsroom vocabulary (tips, leads, unconfirmed reports, conflicting reports) to find wording editors already use, documented in `research-newsroom-labels.md`.

## Options

1. **Keep the original PRD names, change nothing.** Zero cost, but the label wording stays spec-speak — the exact problem Tarik flagged.
2. **Rename the labels to newsroom words, but keep the old explanation sentences.** Cheaper than a full rewrite, but the explanations were written in the same spec-speak style, so the mismatch (plain label, wordy explanation) would still show.
3. **Rename the labels AND rewrite the explanations in plain, short sentences.** Most work — touches ten label strings, ten explanations, five source files, five docs files, and one type validator — but it actually fixes the problem end to end instead of half-fixing it.

## What we chose and why

Option 3, chosen by Tarik. Half-measures (Option 2) would have left a label that finally sounds human sitting next to an explanation that still sounds like a requirements doc — a worse mismatch than doing nothing. Since the underlying `PRODUCT_LABELS` keys stay fixed, the blast radius is contained to string values and prose, not data structures or stored records.

## What we gave up

- **Rework cost.** Every place a label string appeared as a literal — components, the Convex schema validator (`vProductLabel`, the rule that constrains what values Convex will accept in the database), unit tests, an end-to-end test, and five documents — needed a matching edit. That is more surface area than a words-only tweak.
- **Docs debt paid down late.** The planning doc (`docs/superpowers/plans/2026-08-21-signalgap-foundation.md`) had the old strings baked into example code blocks from when the feature was first planned; those needed updating too so a future reader copying from that plan doesn't reintroduce the old wording.
- **No user data migration needed** because SignalGap has no live users yet — a product already in production would have needed to handle old label strings still sitting in a database.

## How we'll know if this was right

If an editor using SignalGap can read a label and its explanation cold — without needing anyone to translate it — and immediately understands what SignalGap did and did not check. A concrete test: hand the label legend to someone outside the project and ask them to explain "Coverage gap" back in their own words; they should get it close on the first try.

## What actually happened

<!-- Tarik fills this in. -->
