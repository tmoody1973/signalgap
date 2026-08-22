# SignalGap

SignalGap is an editorial lead-discovery workspace for small Milwaukee newsrooms.
It uses live SerpApi results to gather public-web signals, AI to connect and explain them,
transparent rules to decide eligibility and rank, and a human editor to reject, monitor, or assign.

It is **not** autonomous journalism. It does not publish, verify facts on its own, or measure public opinion.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values.
3. `npx convex dev` in one terminal, `npm run dev` in another.

## Commands
`npm run check` (lint + typecheck + unit/integration tests), `npm run test:e2e`, `npm run build`.
