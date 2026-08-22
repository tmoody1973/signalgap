# 001: Untitled UI over shadcn/ui

## Decision

Use Untitled UI React (the MIT-licensed, open-source component set) as SignalGap's only component foundation. Do not also install shadcn/ui or any second set of base building blocks (buttons, badges, form inputs, and so on).

## Why this came up

Every product needs a starting set of UI building blocks — buttons, badges, inputs — instead of hand-drawing each one from scratch. Two well-known open-source options existed: shadcn/ui (very common in the React/Next.js world) and Untitled UI React (a newer set with its own visual language). The approved product spec, in the section "UI Component And Design-System Policy," directs the project to Untitled UI and explicitly warns that running two component systems side by side — two sets of visual building blocks, two naming conventions for spacing/color tokens, two different keyboard-focus behaviors, two different light/dark-mode conventions — creates accessibility and consistency risk without any real benefit.

## Options

1. **shadcn/ui.** The most common choice in this stack, well documented, but SignalGap's spec calls for Untitled UI's specific look, and adding shadcn on top would mean maintaining two competing token systems and two focus/dark-mode conventions at once.
2. **Untitled UI React, MIT components only.** Matches the spec exactly. Real cost: Untitled UI also sells a paid ("PRO") tier of extra components, and its license says PRO source may never be checked into a public code repository (this project's is public on GitHub for the hackathon). That means every component has to be checked against the actual MIT-licensed open-source list before it's copied in — an extra verification step shadcn wouldn't require.
3. **Hand-roll every component from bare HTML/CSS.** No license risk at all, but by far the most build time, and it throws away a maintained, accessible, tested component library for no product benefit.

## What we chose and why

Option 2, Untitled UI MIT components only — decided by Tarik via the approved spec, with Claude implementing the pure-license-safety shape of it. Every component copied into `src/components/ui/untitled/` must pass two checks before it's committed: (a) is this exact component confirmed open source / present in the public MIT repo, and (b) is its origin, source URL, license, and copy date recorded in `THIRD_PARTY_NOTICES.md`. If either answer is no, the behavior gets built by hand instead of copied in.

## What we gave up

- **A license-safety step on every component.** Unlike shadcn (fully open, no tier to check), each Untitled UI component needs a quick check that it's the free tier before it's copied in — slower than "just install the package."
- **Smaller community and fewer examples than shadcn**, which is the default choice for most Next.js tutorials, so less copy-pasteable guidance is available online.
- **No safety net if the check is skipped.** The record-keeping in `THIRD_PARTY_NOTICES.md` is a manual habit, not something the build automatically enforces — a rushed commit could copy a PRO component by mistake unless someone remembers to check.

## How we'll know if this was right

If the public GitHub repo never ends up holding a PRO-licensed component (checkable any time by comparing `THIRD_PARTY_NOTICES.md` against everything under `src/components/ui/untitled/`), and if the product never has two competing button/badge/token systems fighting each other visually.

## What actually happened

<!-- Tarik fills this in. -->
