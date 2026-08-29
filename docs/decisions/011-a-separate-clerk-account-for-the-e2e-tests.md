# 011 — A separate Clerk account for the end-to-end tests

**Decision.** The browser tests now sign in as their own throwaway account,
`signalgap-e2e+clerk_test@example.com`, instead of as Tarik's real account.

## Why this came up

Before every browser-test run, a setup step wipes that account's scans clean, so
the first test can check what a brand-new user sees. It does this by asking Clerk
"who owns this email?" and then deleting everything that user has.

The email it asked about was Tarik's own. And Tarik's account owns
`k17d48736…` — the 2026-08-26 Milwaukee scan, the only end-to-end run that has
ever produced a qualifying lead, and the centrepiece of the demo.

So `npm run test:e2e` — an ordinary, safe-sounding command — would have deleted
it. Most of it was recoverable: the scan is now exported to a committed fixture
(`tests/fixtures/demo/demo-scan.json`) that can be imported back. But the wipe
also deletes the 19 **raw archives** — the untouched JSON that SerpApi returned
for each search, kept in Convex File Storage — and those are deliberately *not*
in the fixture, because committing paid API payloads to a public repository is
not something we want to do. Those 19 files had no second copy anywhere.

What was at stake: one careless command, and the proof that the product works
would have been permanently thinner.

## Options

**A. Give the tests their own account.** Point the tests at a new Clerk account
that owns nothing. Cost: someone has to create that account, and the test
credentials become one more thing to keep in `.env.local`.

**B. Teach the wipe to skip the saved demo.** About three lines: never delete a
scan flagged as the saved demo. Cost is real and permanent — the first-run test
checks for the "Run first scan" button, which the app only shows when the
workspace has *zero* scans. Leave the saved demo behind and that button never
appears, so a working test has to be rewritten or thrown away. We would be
trading test coverage for a guard rail.

**C. Just remember not to run it.** Free today. Cost: the trap stays armed, and
it springs on a command that any future session, or any continuous-integration
setup, would reach for without a second thought. A note in a document is not a
guard rail.

## What we chose and why

**A**, Tarik's call, recommended by Claude.

It fixes the actual cause rather than the symptom. The cause was never "the wipe
is too aggressive" — a test reset *should* be aggressive. The cause was that test
data and real data were living in the same account. Once they are separated, the
wipe can stay exactly as blunt as it needs to be, and it can never reach anything
that matters. Option B would have left them sharing an account and paid for the
guard rail with a test.

It is also the shape production needs anyway. Item 11 deploys a separate
production Convex and Vercel target; having an identity that exists only for
testing is the right starting point for that, not extra work.

## What we gave up

There is now a second account to keep track of, and one more line in
`.env.local` that has to be right for the browser tests to work. If someone
copies a stale `.env.local` from before 2026-08-29, the tests will sign in as
Tarik again and the trap is back, silently. The protection lives in
configuration, not in code — that is the honest weakness of this choice, and it
is exactly what option B would have fixed.

The generated password for the account was not written down anywhere. The tests
do not need it (they sign in through Clerk's back door, not the login form). If
a human ever needs to log in as this account, reset the password from the Clerk
dashboard.

## How we'll know if this was right

- `npm run test:e2e` completes and scan `k17d48736…` is still there afterwards,
  with all 25 searches and all 19 raw archives.
- The first-run test still passes without being rewritten.
- No test ever again needs to know Tarik's email address.

## What actually happened

<!-- Tarik fills this in. -->
