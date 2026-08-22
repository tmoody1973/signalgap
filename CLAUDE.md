# SignalGap build rules

Read `docs/hackathon-build/prd.md` and `docs/hackathon-build/spec.md` before implementation.

## Non-negotiables
- Never weaken locality, independence, coverage, or citation rules to fill the feed.
- AI suggests; deterministic code in `convex/editorial/` decides eligibility, labels, scores.
- Every public Convex function: `args` + `returns` validators, Clerk identity, server-derived `ownerId`.
- Raw SerpApi JSON lives in Convex File Storage; never returned to the browser.
- Use the exact product labels in `src/lib/source-labels.ts`. No sensational copy.

## UI rules
- Untitled UI (MIT only) is the sole primitive foundation. Search `src/components/ui/untitled/` before adding a primitive.
- Never copy a PRO component. No shadcn/ui, no Radix, no second token system.
- Add every copied component to `THIRD_PARTY_NOTICES.md` in the same change.
- Custom newsroom meaning lives in `src/components/ui/editorial/` and feature folders.
- Preserve React Aria semantics. Keep client boundaries small.
- Colors come from tokens in `src/styles/theme.css`; no ad-hoc hex in components.
- Verify light mode, dark mode, keyboard focus, narrow width, and non-color status text.

## Process
- npm only. Commit after every task. TDD for rules, adapters, schemas, validators, workflow transitions.
- Never commit `.env*`. Paid API tests run only with `LIVE_TESTS=1`.
