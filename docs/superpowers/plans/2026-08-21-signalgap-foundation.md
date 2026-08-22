# SignalGap Foundation Implementation Plan (Checklist items 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `signalgap` repo with a verified Next.js + Convex + Clerk foundation, the editorial design system and shell (Review Pause 1), the validated owner-scoped data model, and the fully tested deterministic editorial rules engine.

**Architecture:** One Next.js App Router app with a `convex/` backend in the same repo. UI uses copied MIT Untitled UI primitives under custom SignalGap editorial components, driven by semantic tokens in `src/styles/theme.css`. Convex holds all state behind owner-scoped public functions. The rules engine (`convex/editorial/*`) is pure TypeScript with no Convex imports, so it is unit-tested with plain Vitest.

**Tech Stack:** Next.js (App Router, TypeScript), Tailwind CSS 4, Untitled UI React (MIT components only, React Aria), next-themes, Clerk (`@clerk/nextjs`), Convex (`convex`, `@convex-dev/workflow`), `convex-test`, Zod, Vitest, Playwright, npm.

**Spec:** `docs/spec (1).md` (rename to `docs/hackathon-build/spec.md` in Task 3), `docs/prd.md`, `docs/scope.md`, `docs/checklist.md`. This plan covers **checklist items 1, 2, 3, 4**. Items 5–7 (evidence vertical slice), 8–9 (workflow + feed), 10–12 (live scan + ship) get their own plans.

## Global Constraints

- Market literal: `milwaukee-wi`. Beats: `housing`, `transportation`, `culture` (user text: "Housing and neighborhood development", "Transportation and access", "Arts, culture, and neighborhood life").
- Discovery window: 7 days. Coverage window: 30 days. Search hard cap: `120` per scan.
- Eligibility needs **at least two independent signal categories**. One primary source alone is NOT eligible.
- `Coverage gap` requires `coveragePassStatus === "complete"` AND qualifying original reports `<= 2`.
- Score weights: Milwaukee evidence 25, cross-source 20, freshness 15, coverage scarcity 25, relevance 15. Total = sum of components. Only eligible candidates are scored.
- Reddit (`community_discussion`), `trend`, and `map` sources may initiate but never confirm.
- Exact product labels (copy verbatim): `Worth a look`, `Unverified tip`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`, `No longer qualifies`, `Incomplete scan`, `Stopped early`, `Outdated`, `Saved copy`.
- Stage text: `discovery`→"Discovering signals", `evidence`→"Checking local evidence", `coverage`→"Reviewing existing coverage", `briefs`→"Preparing leads".
- No shadcn/ui, no Radix, no second token system, no Untitled UI PRO source. Every copied component is recorded in `THIRD_PARTY_NOTICES.md` in the same commit.
- Never commit `.env*`. `.env.example` has names only.
- Package manager: npm, one committed `package-lock.json`. Commit after every task.
- Fonts: `Newsreader` (editorial headings, reporting questions), `Inter` (UI). Palette: warm white / charcoal / amber. Amber never carries meaning alone; every status has a text label.
- Convex times are Unix ms. Every public Convex function has `args` and `returns` validators, requires Clerk identity, and derives `ownerId` server-side.
- Git tag after Task 10: `checkpoint/design-foundation`.

---

## File Structure (this plan)

```
signalgap/
  package.json, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs
  vitest.config.ts, playwright.config.ts
  .github/workflows/ci.yml
  .env.example, CLAUDE.md, README.md, THIRD_PARTY_NOTICES.md
  docs/hackathon-build/{scope,prd,spec,checklist}.md
  src/
    app/layout.tsx, page.tsx, globals.css
    app/sign-in/[[...sign-in]]/page.tsx
    app/workspace/page.tsx
    app/workspace/workspace-shell.tsx
    proxy.ts                          # Next 16 name; middleware.ts if Next <16
    components/providers.tsx
    components/ui/untitled/{button,badge}.tsx   # copied MIT source
    components/ui/editorial/status-label.tsx
    components/ui/editorial/label-legend.tsx
    components/ui/editorial/theme-toggle.tsx
    components/shell/app-header.tsx
    lib/source-labels.ts
    lib/routes.ts
    lib/design/labels.ts
    lib/convex-client.ts
    styles/theme.css
  convex/
    schema.ts, auth.config.ts, convex.config.ts
    lib/auth.ts                        # requireUser helper
    users.ts, scans.ts, searchRuns.ts
    config/{ruleset,beats,coverageOutlets,officialDomains,searchBudget}.ts
    editorial/{types,independence,coverage,eligibility,scoring,status}.ts
  tests/
    unit/smoke.test.ts
    unit/source-labels.test.ts
    unit/design/notices.test.ts
    unit/editorial/{independence,coverage,eligibility,scoring,status}.test.ts
    integration/auth-ownership.test.ts
    integration/schema-validation.test.ts
    integration/raw-storage-boundary.test.ts
    e2e/smoke.spec.ts, e2e/design-system.spec.ts, e2e/first-run.spec.ts
```

---

### Task 1: Scaffold the app, npm scripts, CI

**Files:**
- Create: `signalgap/` via `create-next-app`, `package.json` scripts, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: npm scripts `lint`, `typecheck`, `test`, `test:e2e`, `test:live`, `build`, `check` used by every later task.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/tarikmoody/Projects
npx create-next-app@latest signalgap --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
cd signalgap
git init -b main
```

- [ ] **Step 2: Install dependencies**

```bash
npm install convex @convex-dev/workflow @clerk/nextjs next-themes zod ai @ai-sdk/anthropic @ai-sdk/openai react-aria-components @untitledui/icons tailwind-merge
npm install -D vitest @vitest/coverage-v8 convex-test @edge-runtime/vm @playwright/test
npx playwright install chromium
```

- [ ] **Step 3: Add scripts to `package.json`** (merge into existing `scripts`)

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:live": "LIVE_TESTS=1 vitest run tests/live",
  "check": "npm run lint && npm run typecheck && npm run test"
}
```

- [ ] **Step 4: Record resolved versions**

```bash
node -e "const p=require('./package.json');console.log(JSON.stringify({...p.dependencies,...p.devDependencies},null,2))" > docs/resolved-versions.json
cat docs/resolved-versions.json
```
Decide the middleware file name now: if `next` is `>=16`, use `src/proxy.ts`; else `src/middleware.ts`. Write the answer at the top of `docs/resolved-versions.json` as a comment line in the commit message.

- [ ] **Step 5: CI workflow** — `.github/workflows/ci.yml`

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run check
      - run: npm run build
        env:
          NEXT_PUBLIC_CONVEX_URL: https://example.convex.cloud
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_placeholder
          CLERK_SECRET_KEY: sk_test_placeholder
```

- [ ] **Step 6: Verify it builds**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all pass (no tests yet; `vitest run` with zero files exits 1 — that is fixed in Task 2).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold signalgap Next.js app, deps, scripts, CI"
```

---

### Task 2: Smoke unit test and rendered-page browser test

**Files:**
- Create: `vitest.config.ts`, `playwright.config.ts`, `tests/unit/smoke.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: Vitest config with two environments: `edge-runtime` for `tests/integration/**` (needed by `convex-test`), `node` for everything else.

- [ ] **Step 1: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environmentMatchGlobs: [["tests/integration/**", "edge-runtime"]],
    server: { deps: { inline: ["convex-test"] } },
    coverage: { provider: "v8", include: ["convex/**", "src/lib/**"] },
  },
});
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL, colorScheme: "light" },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
```

- [ ] **Step 3: Failing smoke test** — `tests/unit/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MARKET_KEY } from "@/lib/constants";

describe("smoke", () => {
  it("knows the frozen market", () => {
    expect(MARKET_KEY).toBe("milwaukee-wi");
  });
});
```

Run: `npm test` → Expected: FAIL, cannot resolve `@/lib/constants`.

- [ ] **Step 4: Make it pass** — `src/lib/constants.ts`

```ts
export const MARKET_KEY = "milwaukee-wi" as const;
export const APP_NAME = "SignalGap";
```

Run: `npm test` → Expected: 1 passed.

- [ ] **Step 5: Rendered-page test** — `tests/e2e/smoke.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test("public page renders SignalGap", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SignalGap");
});
```

Replace `src/app/page.tsx` with a minimal placeholder (Task 7 replaces it again):

```tsx
export default function Home() {
  return (
    <main>
      <h1>SignalGap</h1>
    </main>
  );
}
```

Run: `npm run test:e2e` → Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add vitest + playwright smoke tests so an empty suite cannot pass"
```

---

### Task 3: Project docs, env example, notices, public GitHub repo

**Files:**
- Create: `CLAUDE.md`, `.env.example`, `THIRD_PARTY_NOTICES.md`, `README.md`, `docs/hackathon-build/*`
- Modify: `.gitignore`

- [ ] **Step 1: Move the approved docs**

```bash
mkdir -p docs/hackathon-build
cp "/Users/tarikmoody/Projects/SignalGap/docs/scope.md" docs/hackathon-build/scope.md
cp "/Users/tarikmoody/Projects/SignalGap/docs/prd.md" docs/hackathon-build/prd.md
cp "/Users/tarikmoody/Projects/SignalGap/docs/spec (1).md" docs/hackathon-build/spec.md
cp "/Users/tarikmoody/Projects/SignalGap/docs/checklist.md" docs/hackathon-build/checklist.md
mkdir -p docs/superpowers/plans && cp "/Users/tarikmoody/Projects/SignalGap/docs/superpowers/plans/"*.md docs/superpowers/plans/
```

- [ ] **Step 2: `.env.example`** (names only)

```
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_APP_URL=
# Convex dashboard env (not read by Next.js):
# CLERK_JWT_ISSUER_DOMAIN, SERPAPI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
# AI_PRIMARY_MODEL, AI_FALLBACK_MODEL, AI_FALLBACK_ENABLED
```

Append to `.gitignore`: `.env*` and `!.env.example`.

- [ ] **Step 3: `THIRD_PARTY_NOTICES.md`**

```markdown
# Third-party notices

Every file under `src/components/ui/untitled/` is copied from the MIT-licensed
Untitled UI React open-source set (https://github.com/untitleduico/react).
PRO components are never copied into this repository.

| Component | Source URL | License | Copied on | Local modifications |
| --- | --- | --- | --- | --- |
```

- [ ] **Step 4: `CLAUDE.md`**

```markdown
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
```

- [ ] **Step 5: `README.md`** (first version)

```markdown
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
```

- [ ] **Step 6: Create the public repo and push**

```bash
gh repo create signalgap --public --source=. --remote=origin --description "Editorial lead discovery for Milwaukee newsrooms, powered by SerpApi"
git add -A
git commit -m "docs: add build rules, env example, third-party notices, README, approved docs"
git push -u origin main
gh repo view signalgap --json name,visibility,url
```
Expected: `"visibility": "PUBLIC"`. Run `git status --short` → empty. Run `git ls-files | grep -E '^\.env'` → only `.env.example`.

---

### Task 4: Design tokens, fonts, theme provider

**Files:**
- Create: `src/styles/theme.css`, `src/components/providers.tsx`, `src/components/ui/editorial/theme-toggle.tsx`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`

**Interfaces:**
- Produces: CSS variables `--bg`, `--bg-raised`, `--fg`, `--fg-muted`, `--rule`, `--accent`, `--accent-fg`, `--focus`, `--status-*`; Tailwind utilities `bg-surface`, `bg-raised`, `text-ink`, `text-muted`, `border-rule`, `text-accent`, `font-editorial`, `font-ui`.

- [ ] **Step 1: `src/styles/theme.css`**

```css
@theme {
  --font-editorial: var(--font-newsreader), Georgia, serif;
  --font-ui: var(--font-inter), system-ui, sans-serif;
  --radius-sm: 3px;
  --radius-md: 5px;

  --color-surface: var(--bg);
  --color-raised: var(--bg-raised);
  --color-ink: var(--fg);
  --color-muted: var(--fg-muted);
  --color-rule: var(--rule);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-focus: var(--focus);
}

:root {
  --bg: #faf7f2;          /* warm white */
  --bg-raised: #ffffff;
  --fg: #1f1d1a;          /* charcoal text */
  --fg-muted: #5c5751;
  --rule: #e2dcd2;
  --accent: #b8741a;      /* amber, AA on warm white */
  --accent-fg: #ffffff;
  --focus: #b8741a;
  --status-neutral: #5c5751;
  --status-caution: #8a5a00;
  --status-conflict: #9b2c2c;
  --status-positive: #2f6b3a;
}

.dark {
  --bg: #1c1b19;          /* charcoal */
  --bg-raised: #26241f;
  --fg: #f3efe8;
  --fg-muted: #b4ada3;
  --rule: #3a3731;
  --accent: #e0a04a;
  --accent-fg: #1c1b19;
  --focus: #e0a04a;
  --status-neutral: #b4ada3;
  --status-caution: #e0b26a;
  --status-conflict: #f08a8a;
  --status-positive: #8ccf9a;
}

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 2: `src/app/globals.css`**

```css
@import "tailwindcss";
@import "../styles/theme.css";
@custom-variant dark (&:where(.dark, .dark *));

body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-ui);
}
```

- [ ] **Step 3: `src/components/providers.tsx`**

```tsx
"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

export const metadata: Metadata = {
  title: "SignalGap",
  description: "Editorial lead discovery for Milwaukee newsrooms.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${newsreader.variable}`}>
      <body className="min-h-screen bg-surface text-ink font-ui antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: `src/components/ui/editorial/theme-toggle.tsx`**

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-sm border border-rule px-2 py-1 text-sm text-muted hover:text-ink"
      aria-label={`Switch to ${next} mode`}
    >
      {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build && npm run test:e2e`
Expected: all pass. Open `http://localhost:3000`, confirm warm-white background; toggle class `dark` on `<html>` in devtools, confirm charcoal.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(design): add warm-white/charcoal/amber tokens, Newsreader+Inter, next-themes"
```

---

### Task 5: Copy MIT Untitled UI Button and Badge, record notices, guard test

**Files:**
- Create: `src/components/ui/untitled/button.tsx`, `src/components/ui/untitled/badge.tsx`, `src/lib/utils/cx.ts`, `tests/unit/design/notices.test.ts`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces: `Button` (`color: "primary" | "secondary" | "tertiary"`, `size: "sm" | "md"`), `Badge` (`color`, `size`), `cx()` class merge helper.

- [ ] **Step 1: Failing notices guard test** — `tests/unit/design/notices.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const untitledDir = path.join(root, "src/components/ui/untitled");
const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

describe("third-party notices", () => {
  it("records every copied Untitled UI component", () => {
    const files = readdirSync(untitledDir).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(notices, `${file} missing from THIRD_PARTY_NOTICES.md`).toContain(`\`${file}\``);
    }
  });

  it("contains no PRO source markers", () => {
    const files = readdirSync(untitledDir).filter((f) => f.endsWith(".tsx"));
    for (const file of files) {
      const src = readFileSync(path.join(untitledDir, file), "utf8");
      expect(src).not.toMatch(/Untitled UI PRO|untitledui\.com\/pro/i);
    }
  });
});
```

Run: `npm test -- tests/unit/design` → Expected: FAIL (directory does not exist).

- [ ] **Step 2: Copy the components with the CLI, then move them**

```bash
npx untitledui@latest add button badge
```
The CLI writes into `src/components/base/...` (and may add `src/utils/cx.ts`). Move them:

```bash
mkdir -p src/components/ui/untitled src/lib/utils
git mv src/components/base/buttons/button.tsx src/components/ui/untitled/button.tsx
git mv src/components/base/badges/badges.tsx src/components/ui/untitled/badge.tsx
git mv src/utils/cx.ts src/lib/utils/cx.ts 2>/dev/null || true
rm -rf src/components/base src/utils
```
Fix imports inside the two files to `@/lib/utils/cx`. Delete any `badge-types` / icon imports you do not need. Confirm both files exist in the public MIT repo `https://github.com/untitleduico/react/tree/main/components/base` before committing. If the CLI emits a file that is not in that repo, delete it and write the behavior locally.

If the CLI did not create `cx.ts`, write `src/lib/utils/cx.ts`:

```ts
import { twMerge } from "tailwind-merge";
export const cx = (...classes: Array<string | false | null | undefined>) => twMerge(classes.filter(Boolean).join(" "));
```

- [ ] **Step 3: Re-theme to tokens** — in `button.tsx`, replace brand color classes (`bg-brand-solid`, etc.) so `color="primary"` uses `bg-accent text-accent-fg`, `secondary` uses `border border-rule bg-raised text-ink`, `tertiary` uses `text-muted hover:text-ink`. Keep React Aria `Button` and `focus-visible` ring behavior untouched. Do the same for badge colors: map to `border-rule text-ink` neutral plus the `--status-*` variables via `text-[var(--status-caution)]` etc.

- [ ] **Step 4: Record notices** — append rows to `THIRD_PARTY_NOTICES.md`

```markdown
| `button.tsx` | https://github.com/untitleduico/react/blob/main/components/base/buttons/button.tsx | MIT | 2026-08-21 | Colors mapped to SignalGap tokens; unused variants removed |
| `badge.tsx` | https://github.com/untitleduico/react/blob/main/components/base/badges/badges.tsx | MIT | 2026-08-21 | Colors mapped to SignalGap status tokens |
```

- [ ] **Step 5: Verify**

Run: `npm test -- tests/unit/design && npm run typecheck && rg -n "shadcn|@radix-ui|Untitled UI PRO" src package.json package-lock.json THIRD_PARTY_NOTICES.md`
Expected: tests pass; `rg` prints only the prohibition line in `THIRD_PARTY_NOTICES.md` and `CLAUDE.md` (no code hits).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add MIT Untitled UI Button and Badge with notices guard"
```

---

### Task 6: Source labels module and `StatusLabel` component

**Files:**
- Create: `src/lib/source-labels.ts`, `tests/unit/source-labels.test.ts`, `src/components/ui/editorial/status-label.tsx`

**Interfaces:**
- Produces: `PRODUCT_LABELS` const, `ProductLabel` type, `STAGE_TEXT`, `BEAT_TEXT`, `labelTone(label)`; `<StatusLabel label="Coverage gap" />` renders visible text + tone.

- [ ] **Step 1: Failing test** — `tests/unit/source-labels.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BEAT_TEXT, PRODUCT_LABELS, STAGE_TEXT, labelTone } from "@/lib/source-labels";

describe("source labels", () => {
  it("uses the exact PRD label text", () => {
    expect(Object.values(PRODUCT_LABELS)).toEqual([
      "Worth a look",
      "Unverified tip",
      "Coverage gap",
      "Conflicting reports",
      "Needs a recheck",
      "No longer qualifies",
      "Incomplete scan",
      "Stopped early",
      "Outdated",
      "Saved copy",
    ]);
  });

  it("maps stages to user-facing text", () => {
    expect(STAGE_TEXT).toEqual({
      discovery: "Discovering signals",
      evidence: "Checking local evidence",
      coverage: "Reviewing existing coverage",
      briefs: "Preparing leads",
    });
  });

  it("names the three beats", () => {
    expect(BEAT_TEXT.housing).toBe("Housing and neighborhood development");
    expect(BEAT_TEXT.transportation).toBe("Transportation and access");
    expect(BEAT_TEXT.culture).toBe("Arts, culture, and neighborhood life");
  });

  it("gives every label a tone", () => {
    for (const label of Object.values(PRODUCT_LABELS)) {
      expect(["neutral", "caution", "conflict", "positive"]).toContain(labelTone(label));
    }
  });
});
```

Run: `npm test -- tests/unit/source-labels` → Expected: FAIL.

- [ ] **Step 2: `src/lib/source-labels.ts`**

```ts
export const PRODUCT_LABELS = {
  possibleDevelopment: "Worth a look",
  unverifiedSignal: "Unverified tip",
  coverageGap: "Coverage gap",
  conflictingEvidence: "Conflicting reports",
  reverificationNeeded: "Needs a recheck",
  eligibilityChanged: "No longer qualifies",
  partial: "Incomplete scan",
  canceled: "Stopped early",
  outdated: "Outdated",
  savedNotLive: "Saved copy",
} as const;

export type ProductLabel = (typeof PRODUCT_LABELS)[keyof typeof PRODUCT_LABELS];

export const STAGE_TEXT = {
  discovery: "Discovering signals",
  evidence: "Checking local evidence",
  coverage: "Reviewing existing coverage",
  briefs: "Preparing leads",
} as const;

export type Stage = keyof typeof STAGE_TEXT;

export const BEAT_TEXT = {
  housing: "Housing and neighborhood development",
  transportation: "Transportation and access",
  culture: "Arts, culture, and neighborhood life",
} as const;

export type Beat = keyof typeof BEAT_TEXT;

export type LabelTone = "neutral" | "caution" | "conflict" | "positive";

const TONES: Record<ProductLabel, LabelTone> = {
  "Worth a look": "neutral",
  "Unverified tip": "caution",
  "Coverage gap": "positive",
  "Conflicting reports": "conflict",
  "Needs a recheck": "caution",
  "No longer qualifies": "caution",
  "Incomplete scan": "caution",
  "Stopped early": "conflict",
  Outdated: "caution",
  "Saved copy": "caution",
};

export const labelTone = (label: ProductLabel): LabelTone => TONES[label];

export const LABEL_EXPLANATIONS: Record<ProductLabel, string> = {
  "Worth a look": "Might be a story. Checks are not finished yet.",
  "Unverified tip": "Points to something, but does not prove it.",
  "Coverage gap": "Two or fewer local outlets reported this in the last 30 days.",
  "Conflicting reports": "Sources disagree. Not sorted out yet.",
  "Needs a recheck": "A source link broke or changed. Check it again.",
  "No longer qualifies": "This lead stopped meeting the rules.",
  "Incomplete scan": "Some searches failed. Results may be missing.",
  "Stopped early": "You stopped this scan before it finished.",
  Outdated: "New evidence came in. Regenerate the brief.",
  "Saved copy": "From an earlier scan. May not be current.",
};
```

Run: `npm test -- tests/unit/source-labels` → Expected: PASS.

- [ ] **Step 3: `src/components/ui/editorial/status-label.tsx`**

```tsx
import { labelTone, type ProductLabel } from "@/lib/source-labels";
import { cx } from "@/lib/utils/cx";

const TONE_CLASS = {
  neutral: "text-[var(--status-neutral)]",
  caution: "text-[var(--status-caution)]",
  conflict: "text-[var(--status-conflict)]",
  positive: "text-[var(--status-positive)]",
} as const;

export function StatusLabel({ label, className }: { label: ProductLabel; className?: string }) {
  return (
    <span
      data-tone={labelTone(label)}
      className={cx("inline-flex items-center rounded-sm border border-rule px-1.5 py-0.5 font-ui text-xs font-medium", TONE_CLASS[labelTone(label)], className)}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(labels): add exact PRD product labels, stage and beat text, StatusLabel"
```

---

### Task 7: Public orientation page

**Files:**
- Create: `src/lib/routes.ts`, `src/components/ui/editorial/label-legend.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: `src/lib/routes.ts`**

```ts
export const routes = {
  home: () => "/",
  signIn: () => "/sign-in",
  workspace: () => "/workspace",
  scan: (scanId: string) => `/scans/${scanId}`,
  lead: (candidateId: string) => `/leads/${candidateId}`,
  compare: () => "/compare",
} as const;
```

- [ ] **Step 2: `src/components/ui/editorial/label-legend.tsx`**

```tsx
import { LABEL_EXPLANATIONS, PRODUCT_LABELS } from "@/lib/source-labels";
import { StatusLabel } from "./status-label";

export function LabelLegend() {
  return (
    <section aria-labelledby="label-legend-heading" className="border-t border-rule pt-4">
      <h2 id="label-legend-heading" className="font-editorial text-xl">Evidence labels</h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.values(PRODUCT_LABELS).map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <dt><StatusLabel label={label} /></dt>
            <dd className="text-sm text-muted">{LABEL_EXPLANATIONS[label]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 3: `src/app/page.tsx`**

```tsx
import Link from "next/link";
import { LabelLegend } from "@/components/ui/editorial/label-legend";
import { ThemeToggle } from "@/components/ui/editorial/theme-toggle";
import { routes } from "@/lib/routes";
import { BEAT_TEXT } from "@/lib/source-labels";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-editorial text-4xl leading-tight">SignalGap</h1>
          <p className="mt-2 max-w-prose text-lg text-muted">
            Finds Milwaukee developments that appear across several public web signals but have limited verified local coverage, then drafts a source-linked reporting brief for a human editor.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section aria-labelledby="scope-heading" className="grid gap-4 border-y border-rule py-6 sm:grid-cols-3">
        <div>
          <h2 id="scope-heading" className="text-xs font-medium uppercase tracking-wide text-muted">Coverage area</h2>
          <p className="mt-1">City of Milwaukee</p>
        </div>
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Beats</h2>
          <ul className="mt-1 space-y-1">
            {Object.values(BEAT_TEXT).map((beat) => <li key={beat}>{beat}</li>)}
          </ul>
        </div>
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Evidence standard</h2>
          <p className="mt-1 text-sm">Two independent signal categories. No more than two original local reports in 30 days. Every confirmed fact has a working citation.</p>
        </div>
      </section>

      <p className="text-sm text-muted">
        Community discussion is not representative public opinion. AI output is never treated as source evidence. SignalGap proposes; the editor decides.
      </p>

      <Link href={routes.signIn()} className="inline-flex w-fit rounded-sm bg-accent px-4 py-2 font-medium text-accent-fg">
        Sign in to the Milwaukee workspace
      </Link>

      <LabelLegend />
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run test:e2e` → Expected: pass. Check both themes visually at 375px and 1280px wide; no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(orientation): public page with scope, beats, evidence standard, label legend"
```

---

### Task 8: Clerk sign-in route, route protection, Convex client provider

**Files:**
- Create: `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/proxy.ts` (or `src/middleware.ts`), `src/lib/convex-client.ts`
- Modify: `src/components/providers.tsx`

Set real dev keys in `.env.local` (not committed): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CONVEX_URL` (after `npx convex dev` in Task 11; until then use the placeholder from CI).

- [ ] **Step 1: Sign-in page** — `src/app/sign-in/[[...sign-in]]/page.tsx`

```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignIn forceRedirectUrl="/workspace" />
    </main>
  );
}
```

- [ ] **Step 2: Route protection** — `src/proxy.ts` (rename to `src/middleware.ts` if Next < 16)

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/workspace(.*)", "/scans(.*)", "/leads(.*)", "/compare(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
```

- [ ] **Step 3: Convex client** — `src/lib/convex-client.ts`

```ts
"use client";

import { ConvexReactClient } from "convex/react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");

export const convexClient = new ConvexReactClient(url);
```

- [ ] **Step 4: Providers** — replace `src/components/providers.tsx`

```tsx
"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { convexClient } from "@/lib/convex-client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`. Then `npm run dev`, open `/workspace` signed out → Expected: redirect to `/sign-in`. Sign in with a dev account → Expected: lands on `/workspace` (404 until Task 9 is fine; the redirect is what is being checked).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): Clerk sign-in, protected routes, Convex provider"
```

---

### Task 9: Workspace shell and first-run state

**Files:**
- Create: `src/components/shell/app-header.tsx`, `src/app/workspace/page.tsx`, `src/app/workspace/workspace-shell.tsx`

**Interfaces:**
- Produces: `<WorkspaceShell latestScan={null | {...}} />` — Task 13 later wires real data via `useQuery(api.scans.list)`. In this task it renders the first-run state only.

- [ ] **Step 1: `src/components/shell/app-header.tsx`**

```tsx
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/editorial/theme-toggle";
import { routes } from "@/lib/routes";

export function AppHeader() {
  return (
    <header className="border-b border-rule">
      <nav aria-label="Workspace" className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-4">
          <Link href={routes.workspace()} className="font-editorial text-lg">SignalGap</Link>
          <span className="text-xs text-muted">Milwaukee workspace</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href={routes.compare()} className="text-sm text-muted hover:text-ink">Compare scans</Link>
          <ThemeToggle />
          <UserButton />
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: `src/app/workspace/workspace-shell.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/untitled/button";
import { LabelLegend } from "@/components/ui/editorial/label-legend";
import { BEAT_TEXT } from "@/lib/source-labels";

export function FirstRunState({ onRunFirstScan, disabled }: { onRunFirstScan: () => void; disabled?: boolean }) {
  return (
    <section aria-labelledby="first-run-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="first-run-heading" className="font-editorial text-3xl">No scans yet</h1>
        <p className="mt-2 max-w-prose text-muted">
          SignalGap searches the public web for the City of Milwaukee across three beats, then checks which developments already have local coverage.
        </p>
      </div>
      <dl className="grid gap-4 border-y border-rule py-4 sm:grid-cols-3 text-sm">
        <div><dt className="text-muted">Geography</dt><dd>City of Milwaukee</dd></div>
        <div>
          <dt className="text-muted">Beats</dt>
          <dd><ul>{Object.values(BEAT_TEXT).map((b) => <li key={b}>{b}</li>)}</ul></dd>
        </div>
        <div><dt className="text-muted">Windows</dt><dd>7-day discovery, 30-day coverage check</dd></div>
      </dl>
      <p className="text-sm text-muted">
        Community discussion is not public opinion. AI output is not source evidence. Nothing is configured; the Milwaukee scan is fixed.
      </p>
      <Button color="primary" size="md" onClick={onRunFirstScan} isDisabled={disabled}>Run first scan</Button>
      <LabelLegend />
    </section>
  );
}
```

- [ ] **Step 3: `src/app/workspace/page.tsx`** (first-run only for now)

```tsx
"use client";

import { AppHeader } from "@/components/shell/app-header";
import { FirstRunState } from "./workspace-shell";

export default function WorkspacePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <FirstRunState onRunFirstScan={() => {}} disabled />
      </main>
    </>
  );
}
```
The button is disabled until Task 13 wires `scans.startScan`. A disabled primary action is acceptable for Pause 1 because the scan workflow does not exist yet; say so when presenting.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`. Sign in, open `/workspace`: heading, geography, three beats, boundary sentence, `Run first scan`, legend all visible in both themes. Tab through: header links → theme toggle → user button → Run first scan → nothing skipped, focus ring visible.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(workspace): authenticated shell and first-run state"
```

---

### Task 10: Playwright design-system and first-run specs — REVIEW PAUSE 1

**Files:**
- Create: `tests/e2e/design-system.spec.ts`, `tests/e2e/first-run.spec.ts`, `tests/e2e/helpers/auth.ts`

Clerk test mode: create a dev-instance test user and set `E2E_CLERK_EMAIL` / `E2E_CLERK_PASSWORD` in `.env.local`. Use Clerk's Playwright helper package if available (`@clerk/testing`); otherwise the form-fill below.

- [ ] **Step 1: `tests/e2e/helpers/auth.ts`**

```ts
import type { Page } from "@playwright/test";

export async function signIn(page: Page) {
  const email = process.env.E2E_CLERK_EMAIL;
  const password = process.env.E2E_CLERK_PASSWORD;
  if (!email || !password) throw new Error("Set E2E_CLERK_EMAIL and E2E_CLERK_PASSWORD");
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /continue|sign in/i }).click();
  await page.waitForURL("**/workspace");
}
```

- [ ] **Step 2: `tests/e2e/design-system.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

const LABELS = ["Worth a look", "Unverified tip", "Coverage gap", "Conflicting reports", "Needs a recheck"];

test("labels are text, not color alone", async ({ page }) => {
  await page.goto("/");
  for (const label of LABELS) await expect(page.getByText(label, { exact: true })).toBeVisible();
});

test("light and dark themes use warm white and charcoal", async ({ page }) => {
  await page.goto("/");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe("rgb(250, 247, 242)");
  await page.getByRole("button", { name: /switch to dark mode/i }).click();
  await expect.poll(bg).toBe("rgb(28, 27, 25)");
});

test("keyboard focus is visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("no horizontal overflow at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

- [ ] **Step 3: `tests/e2e/first-run.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";

test("first-run workspace names Milwaukee, beats, and Run first scan", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("City of Milwaukee")).toBeVisible();
  await expect(page.getByText("Housing and neighborhood development")).toBeVisible();
  await expect(page.getByText("Transportation and access")).toBeVisible();
  await expect(page.getByText("Arts, culture, and neighborhood life")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run first scan" })).toBeVisible();
  await expect(page.getByText(/AI output is not source evidence/)).toBeVisible();
});

test("signed-out user cannot open the workspace", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/sign-in/);
});
```

- [ ] **Step 4: Run**

```bash
npm run test:e2e -- tests/e2e/design-system.spec.ts tests/e2e/first-run.spec.ts
rg -n "shadcn|@radix-ui|Untitled UI PRO" src package.json package-lock.json THIRD_PARTY_NOTICES.md
```
Expected: all pass; `rg` hits only the prohibition sentences in docs.

- [ ] **Step 5: Commit, tag, STOP for Tarik**

```bash
git add -A
git commit -m "test(e2e): design-system and first-run specs"
git tag checkpoint/design-foundation
git push && git push --tags
```
**STOP.** Show Tarik the public page and signed-in shell at desktop and mobile width in both themes. Resume only after approval.

---

### Task 11: Convex project, auth config, workflow registration, full schema

**Files:**
- Create: `convex/schema.ts`, `convex/auth.config.ts`, `convex/convex.config.ts`, `convex/lib/validators.ts`

**Interfaces:**
- Produces: every table from the spec data model; shared validators `vBeat`, `vScanStatus`, `vStage`, `vPurpose`, `vEngine`, `vSourceFamily`, `vSignalCategory`, `vProductLabel`, `vDisposition`, `vCandidateStatus`, `vCoveragePassStatus`, `vEvidenceKind`, `vModelOperation`.

- [ ] **Step 1: Initialize Convex**

```bash
npx convex dev --once
```
This creates the dev deployment and writes `NEXT_PUBLIC_CONVEX_URL` into `.env.local`. In the Convex dashboard set `CLERK_JWT_ISSUER_DOMAIN` (from Clerk → JWT Templates → create template named `convex`, copy issuer).

- [ ] **Step 2: `convex/auth.config.ts`**

```ts
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
```

- [ ] **Step 3: `convex/convex.config.ts`**

```ts
import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(workflow);
export default app;
```

- [ ] **Step 4: `convex/lib/validators.ts`**

```ts
import { v } from "convex/values";

export const vMarketKey = v.literal("milwaukee-wi");
export const vBeat = v.union(v.literal("housing"), v.literal("transportation"), v.literal("culture"));
export const vScanStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("partial"), v.literal("canceled"));
export const vStage = v.union(v.literal("discovery"), v.literal("evidence"), v.literal("coverage"), v.literal("briefs"));
export const vPurpose = v.union(v.literal("discovery"), v.literal("corroboration"), v.literal("coverage"), v.literal("enrichment"));
export const vEngine = v.union(
  v.literal("google"), v.literal("google_news"), v.literal("google_trends_trending_now"),
  v.literal("google_events"), v.literal("youtube"), v.literal("google_maps"),
);
export const vLanguage = v.union(v.literal("en"), v.literal("es"), v.literal("mixed"));
export const vSearchRunStatus = v.union(v.literal("reserved"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("skipped"));
export const vSourceFamily = v.union(
  v.literal("news"), v.literal("official"), v.literal("event"), v.literal("video"),
  v.literal("map"), v.literal("community_discussion"), v.literal("public_web"), v.literal("trend"),
);
export const vSourceType = v.union(v.literal("primary"), v.literal("secondary"), v.literal("discussion"), v.literal("unknown"));
export const vSignalCategory = v.union(
  v.literal("official_record"), v.literal("original_news"), v.literal("event"), v.literal("video"),
  v.literal("map"), v.literal("community_discussion"), v.literal("public_web"), v.literal("trend"),
);
export const vCandidateStatus = v.union(v.literal("processing"), v.literal("eligible"), v.literal("excluded"), v.literal("needs_reverification"));
export const vProductLabel = v.union(
  v.literal("Worth a look"), v.literal("Unverified tip"), v.literal("Coverage gap"),
  v.literal("Conflicting reports"), v.literal("Needs a recheck"), v.literal("No longer qualifies"),
);
export const vDisposition = v.union(v.literal("new"), v.literal("rejected"), v.literal("monitoring"), v.literal("assigned"));
export const vCoveragePassStatus = v.union(v.literal("pending"), v.literal("complete"), v.literal("failed"));
export const vSourceRole = v.union(v.literal("initiating"), v.literal("corroborating"), v.literal("coverage"), v.literal("enrichment"), v.literal("potential_source"));
export const vAddedBy = v.union(v.literal("ai_suggestion"), v.literal("deterministic_rule"), v.literal("editor"));
export const vEvidenceKind = v.union(v.literal("confirmed_fact"), v.literal("unverified_signal"), v.literal("conflicting_claim"), v.literal("existing_coverage"), v.literal("potential_source"));
export const vEditorEventType = v.union(v.literal("disposition_changed"), v.literal("note_added"), v.literal("question_edited"), v.literal("correction_added"), v.literal("source_flagged"));
export const vModelOperation = v.union(v.literal("analyzeResults"), v.literal("clusterSignals"), v.literal("classifyEvidence"), v.literal("planFollowUp"), v.literal("generateBrief"));
export const vModelRunStatus = v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid"), v.literal("failed"));

export const vScoreComponent = v.object({
  points: v.number(),
  max: v.number(),
  bandId: v.string(),
  reason: v.string(),
  evidenceIds: v.array(v.string()),
});
export const vScoreComponents = v.object({
  milwaukeeEvidence: vScoreComponent,
  crossSource: vScoreComponent,
  freshness: vScoreComponent,
  coverageScarcity: vScoreComponent,
  relevance: vScoreComponent,
});
export const vFailureSummary = v.object({ purpose: vPurpose, code: v.string(), message: v.string() });
export const vSourceBoundBlock = v.object({ text: v.string(), sourceResultIds: v.array(v.id("sourceResults")) });
```

- [ ] **Step 5: `convex/schema.ts`**

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as V from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_user_id", ["clerkUserId"]),

  scans: defineTable({
    ownerId: v.id("users"),
    marketKey: V.vMarketKey,
    rulesetVersion: v.string(),
    queryCatalogVersion: v.string(),
    status: V.vScanStatus,
    stage: V.vStage,
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelRequestedAt: v.optional(v.number()),
    searchBudgetLimit: v.number(),
    searchesReserved: v.number(),
    searchesSucceeded: v.number(),
    searchesFailed: v.number(),
    eligibleCount: v.number(),
    excludedCount: v.number(),
    processingCount: v.number(),
    failureSummaries: v.array(V.vFailureSummary),
    isSavedDemo: v.boolean(),
    captureTimestamp: v.optional(v.number()),
  })
    .index("by_owner_started", ["ownerId", "startedAt"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status_started", ["status", "startedAt"]),

  searchRuns: defineTable({
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    idempotencyKey: v.string(),
    templateId: v.string(),
    queryCatalogVersion: v.string(),
    purpose: V.vPurpose,
    engine: V.vEngine,
    query: v.string(),
    parameters: v.record(v.string(), v.string()),
    language: V.vLanguage,
    status: V.vSearchRunStatus,
    attemptCount: v.number(),
    resultCount: v.number(),
    durationMs: v.number(),
    rawStorageId: v.optional(v.id("_storage")),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    reservedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_scan_purpose", ["scanId", "purpose"])
    .index("by_scan_status", ["scanId", "status"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  sourceResults: defineTable({
    scanId: v.id("scans"),
    searchRunId: v.id("searchRuns"),
    ownerId: v.id("users"),
    canonicalKey: v.string(),
    canonicalUrl: v.string(),
    originalUrl: v.string(),
    engine: V.vEngine,
    sourceFamily: V.vSourceFamily,
    sourceType: V.vSourceType,
    title: v.string(),
    snippet: v.string(),
    originalLanguage: v.string(),
    translatedTitle: v.optional(v.string()),
    translatedSnippet: v.optional(v.string()),
    publisher: v.optional(v.string()),
    author: v.optional(v.string()),
    channel: v.optional(v.string()),
    placeName: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    discoveredAt: v.number(),
    position: v.optional(v.number()),
    nativeId: v.optional(v.string()),
    redditPostId: v.optional(v.string()),
    isAccessible: v.boolean(),
    accessCheckedAt: v.optional(v.number()),
    contentHash: v.string(),
  })
    .index("by_scan", ["scanId"])
    .index("by_search_run", ["searchRunId"])
    .index("by_scan_canonical", ["scanId", "canonicalKey"])
    .index("by_reddit_post_id", ["redditPostId"]),

  candidates: defineTable({
    ownerId: v.id("users"),
    fingerprint: v.string(),
    currentTitle: v.string(),
    reportingQuestion: v.string(),
    beat: V.vBeat,
    status: V.vCandidateStatus,
    primaryLabel: V.vProductLabel,
    disposition: V.vDisposition,
    latestEvidenceVersion: v.number(),
    latestBriefVersion: v.optional(v.number()),
    scoreTotal: v.optional(v.number()),
    scoreComponents: v.optional(V.vScoreComponents),
    independentCategoryCount: v.number(),
    coverageOriginalCount: v.number(),
    coveragePassStatus: V.vCoveragePassStatus,
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_fingerprint", ["ownerId", "fingerprint"])
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_owner_disposition", ["ownerId", "disposition"]),

  candidateAppearances: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    statusAtScan: V.vCandidateStatus,
    labelAtScan: V.vProductLabel,
    dispositionAtScan: V.vDisposition,
    scoreAtScan: v.optional(v.number()),
    coverageCountAtScan: v.optional(v.number()),
    categoryCountAtScan: v.optional(v.number()),
    changeSummary: v.optional(v.record(v.string(), v.string())),
    rank: v.optional(v.number()),
  })
    .index("by_scan_rank", ["scanId", "rank"])
    .index("by_candidate_scan", ["candidateId", "scanId"])
    .index("by_owner_scan", ["ownerId", "scanId"]),

  candidateSources: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    sourceResultId: v.id("sourceResults"),
    role: V.vSourceRole,
    independenceGroup: v.string(),
    signalCategory: V.vSignalCategory,
    addedBy: V.vAddedBy,
  })
    .index("by_candidate_scan", ["candidateId", "scanId"])
    .index("by_source_result", ["sourceResultId"])
    .index("by_candidate_role", ["candidateId", "role"]),

  evidenceItems: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    evidenceVersion: v.number(),
    kind: V.vEvidenceKind,
    claimText: v.string(),
    sourceResultIds: v.array(v.id("sourceResults")),
    exactExcerpt: v.optional(v.string()),
    originalLanguageText: v.optional(v.string()),
    translatedText: v.optional(v.string()),
    classificationBasis: v.string(),
    confidence: v.optional(v.number()),
    conflictGroupId: v.optional(v.string()),
    requiresReverification: v.boolean(),
    createdByModelRunId: v.optional(v.id("modelRuns")),
  })
    .index("by_candidate_version", ["candidateId", "evidenceVersion"])
    .index("by_scan_kind", ["scanId", "kind"])
    .index("by_source_result", ["sourceResultIds"]),

  briefVersions: defineTable({
    candidateId: v.id("candidates"),
    scanId: v.id("scans"),
    ownerId: v.id("users"),
    version: v.number(),
    reportingQuestion: v.string(),
    whySurfaced: v.string(),
    confirmedFacts: v.array(V.vSourceBoundBlock),
    unverifiedClaims: v.array(V.vSourceBoundBlock),
    conflicts: v.array(V.vSourceBoundBlock),
    existingCoverage: v.array(V.vSourceBoundBlock),
    potentialHumanSources: v.array(V.vSourceBoundBlock),
    interviewQuestions: v.array(v.string()),
    modelRunId: v.optional(v.id("modelRuns")),
    editedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_candidate_version", ["candidateId", "version"])
    .index("by_scan", ["scanId"]),

  editorEvents: defineTable({
    candidateId: v.id("candidates"),
    ownerId: v.id("users"),
    scanId: v.id("scans"),
    actorUserId: v.id("users"),
    type: V.vEditorEventType,
    before: v.optional(v.record(v.string(), v.string())),
    after: v.optional(v.record(v.string(), v.string())),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_candidate_created", ["candidateId", "createdAt"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  modelRuns: defineTable({
    scanId: v.id("scans"),
    candidateId: v.optional(v.id("candidates")),
    ownerId: v.id("users"),
    operation: V.vModelOperation,
    idempotencyKey: v.string(),
    provider: v.string(),
    modelId: v.string(),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    inputSnapshotHash: v.string(),
    status: V.vModelRunStatus,
    attempt: v.number(),
    fallbackFromRunId: v.optional(v.id("modelRuns")),
    fallbackReason: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    validationErrors: v.optional(v.array(v.string())),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_scan_operation", ["scanId", "operation"])
    .index("by_candidate_operation", ["candidateId", "operation"])
    .index("by_idempotency_key", ["idempotencyKey"]),
});
```

- [ ] **Step 6: Verify**

Run: `npx convex codegen && npm run typecheck`
Expected: `convex/_generated/` updated, no type errors. Commit `convex/_generated/` (Convex recommends committing it).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(convex): auth config, workflow component, full validated schema"
```

---

### Task 12: `users.ensureCurrent` and the `requireUser` helper (ownership tests)

**Files:**
- Create: `convex/lib/auth.ts`, `convex/users.ts`, `tests/integration/helpers.ts`, `tests/integration/auth-ownership.test.ts`

**Interfaces:**
- Produces: `requireUser(ctx): Promise<Doc<"users">>` (throws `"Unauthenticated"` / `"User not bootstrapped"`), `users.ensureCurrent` mutation returns `Id<"users">`, `users.me` query returns `{ _id, displayName, email } | null`.

- [ ] **Step 1: Test helper** — `tests/integration/helpers.ts`

```ts
import { convexTest } from "convex-test";
import schema from "../../convex/schema";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export const asUser = (t: ReturnType<typeof setup>, subject: string) =>
  t.withIdentity({ subject, tokenIdentifier: `clerk|${subject}`, name: subject, email: `${subject}@example.com` });
```

- [ ] **Step 2: Failing test** — `tests/integration/auth-ownership.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { asUser, setup } from "./helpers";

describe("users.ensureCurrent", () => {
  it("rejects anonymous callers", async () => {
    const t = setup();
    await expect(t.mutation(api.users.ensureCurrent, {})).rejects.toThrow(/Unauthenticated/);
  });

  it("creates one user per Clerk subject and is idempotent", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const first = await alice.mutation(api.users.ensureCurrent, {});
    const second = await alice.mutation(api.users.ensureCurrent, {});
    expect(first).toBe(second);
    const me = await alice.query(api.users.me, {});
    expect(me?._id).toBe(first);
  });

  it("returns null for a user who has not bootstrapped", async () => {
    const t = setup();
    expect(await asUser(t, "bob").query(api.users.me, {})).toBeNull();
  });
});
```

Run: `npm test -- tests/integration/auth-ownership` → Expected: FAIL (module missing).

- [ ] **Step 3: `convex/lib/auth.ts`**

```ts
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject)).unique();
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  const user = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject)).unique();
  if (!user) throw new Error("User not bootstrapped");
  return user;
}
```

- [ ] **Step 4: `convex/users.ts`**

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { currentUser } from "./lib/auth";

export const ensureCurrent = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const now = Date.now();
    const existing = await ctx.db.query("users").withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", identity.subject)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { email: identity.email, displayName: identity.name, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("users", { clerkUserId: identity.subject, email: identity.email, displayName: identity.name, createdAt: now, updatedAt: now });
  },
});

export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ _id: v.id("users"), displayName: v.optional(v.string()), email: v.optional(v.string()) })),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? { _id: user._id, displayName: user.displayName, email: user.email } : null;
  },
});
```

Run: `npx convex codegen && npm test -- tests/integration/auth-ownership` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(convex): users.ensureCurrent, me, requireUser helper with ownership tests"
```

---

### Task 13: Owner-scoped scan APIs (`startScan`, `get`, `list`, `cancel`)

**Files:**
- Create: `convex/config/ruleset.ts`, `convex/config/searchBudget.ts`, `convex/scans.ts`
- Modify: `tests/integration/auth-ownership.test.ts`, `src/app/workspace/page.tsx`

**Interfaces:**
- Consumes: `requireUser` (Task 12).
- Produces: `scans.startScan({}) → Id<"scans">` (throws `"A scan is already running"` if owner has queued/running scan); `scans.get({scanId}) → ScanSummary | null` (null if not owned); `scans.list({}) → ScanSummary[]` newest first, max 50; `scans.cancel({scanId}) → null`. Workflow start itself lands in the item-8 plan; here `startScan` only writes the `queued` document.

- [ ] **Step 1: Config**

`convex/config/ruleset.ts`
```ts
export const RULESET_VERSION = "2026-08-21.1";
export const QUERY_CATALOG_VERSION = "2026-08-21.1";
export const MARKET_KEY = "milwaukee-wi" as const;
export const DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const COVERAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_COVERAGE_REPORTS = 2;
export const MIN_INDEPENDENT_CATEGORIES = 2;
```

`convex/config/searchBudget.ts`
```ts
export const SEARCH_BUDGET = {
  discovery: 16,
  coverage: 20,
  corroboration: 20,
  enrichment: 30,
  reserve: 34,
  hardCap: 120,
} as const;
```

- [ ] **Step 2: Failing tests** — append to `tests/integration/auth-ownership.test.ts`

```ts
import { api } from "../../convex/_generated/api";
import { asUser, setup } from "./helpers";

describe("scans ownership", () => {
  it("starts a queued scan for the owner only", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await alice.mutation(api.scans.startScan, {});
    const scan = await alice.query(api.scans.get, { scanId });
    expect(scan?.status).toBe("queued");
    expect(scan?.searchBudgetLimit).toBe(120);

    const bob = asUser(t, "bob");
    await bob.mutation(api.users.ensureCurrent, {});
    expect(await bob.query(api.scans.get, { scanId })).toBeNull();
    expect(await bob.query(api.scans.list, {})).toEqual([]);
    await expect(bob.mutation(api.scans.cancel, { scanId })).rejects.toThrow(/not found/i);
  });

  it("refuses a second active scan", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    await alice.mutation(api.scans.startScan, {});
    await expect(alice.mutation(api.scans.startScan, {})).rejects.toThrow(/already running/);
  });

  it("cancel records cancelRequestedAt and moves queued to canceled", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await alice.mutation(api.scans.startScan, {});
    await alice.mutation(api.scans.cancel, { scanId });
    const scan = await alice.query(api.scans.get, { scanId });
    expect(scan?.status).toBe("canceled");
    expect(scan?.cancelRequestedAt).toBeTypeOf("number");
  });
});
```

Run: `npm test -- tests/integration/auth-ownership` → Expected: FAIL.

- [ ] **Step 3: `convex/scans.ts`**

```ts
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { QUERY_CATALOG_VERSION, RULESET_VERSION } from "./config/ruleset";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const vScanSummary = v.object({
  _id: v.id("scans"),
  status: V.vScanStatus,
  stage: V.vStage,
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  cancelRequestedAt: v.optional(v.number()),
  searchBudgetLimit: v.number(),
  searchesReserved: v.number(),
  searchesSucceeded: v.number(),
  searchesFailed: v.number(),
  eligibleCount: v.number(),
  excludedCount: v.number(),
  processingCount: v.number(),
  failureSummaries: v.array(V.vFailureSummary),
  isSavedDemo: v.boolean(),
  captureTimestamp: v.optional(v.number()),
});

const toSummary = (s: Doc<"scans">) => ({
  _id: s._id, status: s.status, stage: s.stage, startedAt: s.startedAt, completedAt: s.completedAt,
  cancelRequestedAt: s.cancelRequestedAt, searchBudgetLimit: s.searchBudgetLimit, searchesReserved: s.searchesReserved,
  searchesSucceeded: s.searchesSucceeded, searchesFailed: s.searchesFailed, eligibleCount: s.eligibleCount,
  excludedCount: s.excludedCount, processingCount: s.processingCount, failureSummaries: s.failureSummaries,
  isSavedDemo: s.isSavedDemo, captureTimestamp: s.captureTimestamp,
});

export const startScan = mutation({
  args: {},
  returns: v.id("scans"),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    for (const status of ["queued", "running"] as const) {
      const active = await ctx.db.query("scans").withIndex("by_owner_status", (q) => q.eq("ownerId", user._id).eq("status", status)).first();
      if (active) throw new Error("A scan is already running");
    }
    return ctx.db.insert("scans", {
      ownerId: user._id,
      marketKey: "milwaukee-wi",
      rulesetVersion: RULESET_VERSION,
      queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "queued",
      stage: "discovery",
      startedAt: Date.now(),
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
      eligibleCount: 0, excludedCount: 0, processingCount: 0,
      failureSummaries: [],
      isSavedDemo: false,
    });
    // ponytail: workflow.start lands in the item-8 plan; queued rows are enough to test ownership now.
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  returns: v.union(v.null(), vScanSummary),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return null;
    return toSummary(scan);
  },
});

export const list = query({
  args: {},
  returns: v.array(vScanSummary),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const scans = await ctx.db.query("scans").withIndex("by_owner_started", (q) => q.eq("ownerId", user._id)).order("desc").take(50);
    return scans.map(toSummary);
  },
});

export const cancel = mutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) throw new Error("Scan not found");
    if (scan.status !== "queued" && scan.status !== "running") return null;
    const now = Date.now();
    await ctx.db.patch(scanId, scan.status === "queued"
      ? { cancelRequestedAt: now, status: "canceled", completedAt: now }
      : { cancelRequestedAt: now });
    return null;
  },
});
```

Run: `npx convex codegen && npm test -- tests/integration/auth-ownership` → Expected: PASS.

- [ ] **Step 4: Wire the workspace page**

```tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import { AppHeader } from "@/components/shell/app-header";
import { FirstRunState } from "./workspace-shell";

export default function WorkspacePage() {
  const ensure = useMutation(api.users.ensureCurrent);
  const me = useQuery(api.users.me);
  useEffect(() => { void ensure({}); }, [ensure]);
  const scans = useQuery(api.scans.list, me ? {} : "skip");
  const start = useMutation(api.scans.startScan);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {scans === undefined ? (
          <p className="text-muted">Loading workspace…</p>
        ) : scans.length === 0 ? (
          <FirstRunState onRunFirstScan={() => void start({})} />
        ) : (
          <section aria-labelledby="latest-scan">
            <h1 id="latest-scan" className="font-editorial text-3xl">Latest scan</h1>
            <p className="mt-2 text-muted">Status: {scans[0].status}. Searches reserved: {scans[0].searchesReserved} / {scans[0].searchBudgetLimit}.</p>
            {/* ponytail: full summary + Run new scan arrive with the feed plan (items 8–9) */}
          </section>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run test:e2e -- tests/e2e/first-run.spec.ts`. Manually: sign in, click `Run first scan`, page flips to "Latest scan / Status: queued".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scans): owner-scoped startScan/get/list/cancel with single-active-scan rule"
```

---

### Task 14: Raw-storage boundary and schema-validation tests

**Files:**
- Create: `convex/searchRuns.ts`, `tests/integration/raw-storage-boundary.test.ts`, `tests/integration/schema-validation.test.ts`, `tests/fixtures/factories.ts`

**Interfaces:**
- Produces: `searchRuns.listForScan({scanId}) → SafeSearchRun[]` — never includes `rawStorageId` or `parameters.api_key`; internal `searchRuns.insertForTest` does not exist — tests insert via `t.run(ctx => ctx.db.insert(...))`.

- [ ] **Step 1: Factories** — `tests/fixtures/factories.ts`

```ts
import type { Id } from "../../convex/_generated/dataModel";

export const scanDoc = (ownerId: Id<"users">, overrides: Partial<Record<string, unknown>> = {}) => ({
  ownerId, marketKey: "milwaukee-wi" as const, rulesetVersion: "t", queryCatalogVersion: "t",
  status: "running" as const, stage: "discovery" as const, startedAt: 1_000,
  searchBudgetLimit: 120, searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
  eligibleCount: 0, excludedCount: 0, processingCount: 0, failureSummaries: [], isSavedDemo: false,
  ...overrides,
});

export const searchRunDoc = (scanId: Id<"scans">, ownerId: Id<"users">, rawStorageId?: Id<"_storage">) => ({
  scanId, ownerId, idempotencyKey: `${scanId}:discovery:news-housing-en-01:abc`, templateId: "news-housing-en-01",
  queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google_news" as const,
  query: "Milwaukee (housing OR zoning)", parameters: { gl: "us", hl: "en" }, language: "en" as const,
  status: "succeeded" as const, attemptCount: 1, resultCount: 7, durationMs: 900, rawStorageId,
  reservedAt: 1_000, completedAt: 2_000,
});
```

- [ ] **Step 2: Failing boundary test** — `tests/integration/raw-storage-boundary.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

describe("searchRuns.listForScan", () => {
  it("never exposes raw storage IDs or secrets and is owner-scoped", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    const { scanId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([JSON.stringify({ organic_results: [] })]));
      const scanId = await ctx.db.insert("scans", scanDoc(aliceId));
      await ctx.db.insert("searchRuns", searchRunDoc(scanId, aliceId, storageId));
      return { scanId };
    });

    const runs = await alice.query(api.searchRuns.listForScan, { scanId });
    expect(runs).toHaveLength(1);
    expect(JSON.stringify(runs)).not.toMatch(/rawStorageId|api_key/);
    expect(runs[0]).toMatchObject({ query: "Milwaukee (housing OR zoning)", purpose: "discovery", status: "succeeded", resultCount: 7 });

    const bob = asUser(t, "bob");
    await bob.mutation(api.users.ensureCurrent, {});
    expect(await bob.query(api.searchRuns.listForScan, { scanId })).toEqual([]);
  });
});
```

- [ ] **Step 3: `convex/searchRuns.ts`**

```ts
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const vSafeSearchRun = v.object({
  _id: v.id("searchRuns"),
  templateId: v.string(),
  purpose: V.vPurpose,
  engine: V.vEngine,
  query: v.string(),
  language: V.vLanguage,
  status: V.vSearchRunStatus,
  attemptCount: v.number(),
  resultCount: v.number(),
  durationMs: v.number(),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  reservedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const listForScan = query({
  args: { scanId: v.id("scans") },
  returns: v.array(vSafeSearchRun),
  handler: async (ctx, { scanId }) => {
    const user = await requireUser(ctx);
    const scan = await ctx.db.get(scanId);
    if (!scan || scan.ownerId !== user._id) return [];
    const runs = await ctx.db.query("searchRuns").withIndex("by_scan_purpose", (q) => q.eq("scanId", scanId)).take(200);
    return runs.map((r) => ({
      _id: r._id, templateId: r.templateId, purpose: r.purpose, engine: r.engine, query: r.query, language: r.language,
      status: r.status, attemptCount: r.attemptCount, resultCount: r.resultCount, durationMs: r.durationMs,
      errorCode: r.errorCode, errorMessage: r.errorMessage, reservedAt: r.reservedAt, completedAt: r.completedAt,
    }));
  },
});
```

- [ ] **Step 4: Schema-validation test** — `tests/integration/schema-validation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

describe("schema validators", () => {
  it("rejects an unknown scan status", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    await expect(
      t.run((ctx) => ctx.db.insert("scans", scanDoc(aliceId, { status: "bogus" }) as never)),
    ).rejects.toThrow();
  });

  it("rejects a candidate with a non-approved label", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const aliceId = await alice.mutation(api.users.ensureCurrent, {});
    await expect(
      t.run((ctx) => ctx.db.insert("candidates", {
        ownerId: aliceId, fingerprint: "f", currentTitle: "t", reportingQuestion: "q", beat: "housing",
        status: "eligible", primaryLabel: "Definitely true", disposition: "new", latestEvidenceVersion: 1,
        independentCategoryCount: 2, coverageOriginalCount: 0, coveragePassStatus: "complete",
        firstSeenAt: 1, lastSeenAt: 1, updatedAt: 1,
      } as never)),
    ).rejects.toThrow();
  });

  it("rejects a public call with a wrong argument type", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    await alice.mutation(api.users.ensureCurrent, {});
    await expect(alice.query(api.scans.get, { scanId: 42 } as never)).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run and commit**

Run: `npx convex codegen && npm test -- tests/integration` → Expected: PASS.

```bash
git add -A
git commit -m "feat(convex): safe searchRuns query log; raw-storage and schema validation tests"
```

---

### Task 15: Editorial config (beats, outlet catalog, official domains)

**Files:**
- Create: `convex/config/beats.ts`, `convex/config/coverageOutlets.ts`, `convex/config/officialDomains.ts`, `tests/unit/editorial/config.test.ts`

- [ ] **Step 1: Failing test** — `tests/unit/editorial/config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BEATS } from "../../../convex/config/beats";
import { COVERAGE_OUTLETS, REQUIRED_COVERAGE_GROUPS, outletGroupForDomain } from "../../../convex/config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../../convex/config/officialDomains";

describe("editorial config", () => {
  it("has exactly three beats", () => {
    expect(Object.keys(BEATS)).toEqual(["housing", "transportation", "culture"]);
  });
  it("requires both coverage groups", () => {
    expect(REQUIRED_COVERAGE_GROUPS).toEqual(["general", "community"]);
    expect(COVERAGE_OUTLETS.general.length).toBeGreaterThanOrEqual(12);
    expect(COVERAGE_OUTLETS.community.length).toBeGreaterThanOrEqual(7);
  });
  it("maps a community domain to its group", () => {
    expect(outletGroupForDomain("milwaukeenns.org")).toBe("community");
    expect(outletGroupForDomain("www.jsonline.com")).toBe("general");
    expect(outletGroupForDomain("nytimes.com")).toBeNull();
  });
  it("lists official domains", () => {
    expect(OFFICIAL_DOMAINS).toContain("city.milwaukee.gov");
  });
});
```

- [ ] **Step 2: `convex/config/beats.ts`**

```ts
export const BEATS = {
  housing: { label: "Housing and neighborhood development", terms: ["housing", "zoning", "development", "displacement", "neighborhood"] },
  transportation: { label: "Transportation and access", terms: ["transit", "bus", "street", "bike", "access", "construction"] },
  culture: { label: "Arts, culture, and neighborhood life", terms: ["arts", "culture", "venue", "festival", "library", "museum"] },
} as const;
export type Beat = keyof typeof BEATS;
```

- [ ] **Step 3: `convex/config/coverageOutlets.ts`**

```ts
export const COVERAGE_CATALOG_VERSION = "2026-08-21.1";

export const COVERAGE_OUTLETS = {
  general: [
    { name: "Milwaukee Journal Sentinel", domain: "jsonline.com" },
    { name: "WUWM", domain: "wuwm.com" },
    { name: "Wisconsin Public Radio", domain: "wpr.org" },
    { name: "Urban Milwaukee", domain: "urbanmilwaukee.com" },
    { name: "Wisconsin Watch", domain: "wisconsinwatch.org" },
    { name: "TMJ4", domain: "tmj4.com" },
    { name: "WISN 12", domain: "wisn.com" },
    { name: "FOX6", domain: "fox6now.com" },
    { name: "CBS 58", domain: "cbs58.com" },
    { name: "WTMJ", domain: "wtmj.com" },
    { name: "Radio Milwaukee", domain: "radiomilwaukee.org" },
    { name: "BizTimes Milwaukee", domain: "biztimes.com" },
  ],
  community: [
    { name: "Milwaukee Neighborhood News Service", domain: "milwaukeenns.org" },
    { name: "Milwaukee Courier", domain: "milwaukeecourier.com" },
    { name: "Milwaukee Community Journal", domain: "communityjournal.net" },
    { name: "101.7 The Truth", domain: "1017truth.com" },
    { name: "Wisconsin Muslim Journal", domain: "wisconsinmuslimjournal.org" },
    { name: "Spanish Journal", domain: "spanishjournal.com" },
    { name: "Wisconsin Latino News", domain: "wilatinonews.com" },
    { name: "El Conquistador", domain: "elconquistadornews.com" },
  ],
} as const;

export type CoverageGroup = keyof typeof COVERAGE_OUTLETS;
export const REQUIRED_COVERAGE_GROUPS: readonly CoverageGroup[] = ["general", "community"];

export function outletGroupForDomain(hostname: string): CoverageGroup | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const group of REQUIRED_COVERAGE_GROUPS) {
    if (COVERAGE_OUTLETS[group].some((o) => host === o.domain || host.endsWith(`.${o.domain}`))) return group;
  }
  return null;
}
```

- [ ] **Step 4: `convex/config/officialDomains.ts`**

```ts
export const OFFICIAL_DOMAINS = [
  "city.milwaukee.gov",
  "milwaukee.legistar.com",
  "county.milwaukee.gov",
  "milwaukee.granicus.com",
  "mps.milwaukee.k12.wi.us",
  "wisconsinpublicnotices.org",
  "ridemcts.com",
] as const;

export const isOfficialDomain = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
};
```

- [ ] **Step 5: Run and commit**

Run: `npm test -- tests/unit/editorial/config` → PASS.

```bash
git add -A
git commit -m "feat(config): beats, frozen equitable coverage catalog, official domains"
```

---

### Task 16: Engine types and independence rules

**Files:**
- Create: `convex/editorial/types.ts`, `convex/editorial/independence.ts`, `tests/unit/editorial/independence.test.ts`

**Interfaces:**
- Produces the engine input shape every later editorial module consumes:

```ts
// convex/editorial/types.ts
import type { Beat } from "../config/beats";

export type SignalCategory = "official_record" | "original_news" | "event" | "video" | "map" | "community_discussion" | "public_web" | "trend";
export const CONFIRMING_CATEGORIES: ReadonlySet<SignalCategory> = new Set(["official_record", "original_news", "event", "video", "public_web"]);
export const PRIMARY_CATEGORIES: ReadonlySet<SignalCategory> = new Set(["official_record"]);

export type EngineSource = {
  id: string;
  signalCategory: SignalCategory;
  independenceGroup: string;   // press-release / syndication lineage; same group = one source
  isAccessible: boolean;
  publishedAt?: number;
  isPromotional: boolean;
};

export type CoverageReport = { id: string; independenceGroup: string; group: "general" | "community" };
export type CoveragePartitionStatus = "pending" | "succeeded" | "failed";
export type CoverageInput = {
  partitions: { general: CoveragePartitionStatus; community: CoveragePartitionStatus };
  reports: CoverageReport[];
};

export type LocalityBand = "direct_city" | "county_city_effect" | "area_city_consequence" | "none";
export type RelevanceBand = "policy_service_change" | "community_cultural_impact" | "emerging_question" | "promotion_only";

export type CandidateInput = {
  localityBand: LocalityBand;
  beat: Beat | null;
  relevanceBand: RelevanceBand;
  initiatingSignalAt: number;
  now: number;
  sources: EngineSource[];
  coverage: CoverageInput;
  hasTrendMomentum: boolean;
  isDuplicateOfCandidate: boolean;
  isSpeculative: boolean;
  isRoutineCrime: boolean;
  hasMaterialConflict: boolean;
};

export type ExclusionReason =
  | "weak_locality" | "stale" | "insufficient_independence" | "no_beat_relevance" | "already_covered"
  | "inaccessible_evidence" | "coverage_pass_incomplete" | "promotional" | "duplicate" | "speculative" | "routine_crime";
```

- [ ] **Step 1: Failing test** — `tests/unit/editorial/independence.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { independenceSummary } from "../../../convex/editorial/independence";
import type { EngineSource } from "../../../convex/editorial/types";

const src = (id: string, signalCategory: EngineSource["signalCategory"], independenceGroup = id): EngineSource =>
  ({ id, signalCategory, independenceGroup, isAccessible: true, isPromotional: false });

describe("independenceSummary", () => {
  it("counts distinct confirming categories", () => {
    const s = independenceSummary([src("a", "official_record"), src("b", "original_news")]);
    expect(s.independentCategoryCount).toBe(2);
    expect(s.hasPrimary).toBe(true);
  });

  it("collapses same independence group to one", () => {
    const s = independenceSummary([src("a", "original_news", "release-1"), src("b", "original_news", "release-1"), src("c", "public_web", "release-1")]);
    expect(s.independentCategoryCount).toBe(1);
    expect(s.groups).toHaveLength(1);
  });

  it("reddit, trend, and map never confirm", () => {
    const s = independenceSummary([src("r", "community_discussion"), src("t", "trend"), src("m", "map")]);
    expect(s.independentCategoryCount).toBe(0);
    expect(s.nonConfirmingSourceIds).toEqual(["r", "t", "m"]);
  });

  it("reddit plus one news story is one category", () => {
    const s = independenceSummary([src("r", "community_discussion"), src("n", "original_news")]);
    expect(s.independentCategoryCount).toBe(1);
  });

  it("ignores inaccessible sources", () => {
    const s = independenceSummary([src("a", "official_record"), { ...src("b", "original_news"), isAccessible: false }]);
    expect(s.independentCategoryCount).toBe(1);
  });
});
```

- [ ] **Step 2: `convex/editorial/independence.ts`**

```ts
import { CONFIRMING_CATEGORIES, PRIMARY_CATEGORIES, type EngineSource, type SignalCategory } from "./types";

export type IndependenceGroupSummary = { group: string; category: SignalCategory; sourceIds: string[] };

export type IndependenceSummary = {
  independentCategoryCount: number;
  hasPrimary: boolean;
  groups: IndependenceGroupSummary[];
  nonConfirmingSourceIds: string[];
};

export function independenceSummary(sources: EngineSource[]): IndependenceSummary {
  const accessible = sources.filter((s) => s.isAccessible);
  const nonConfirmingSourceIds = accessible.filter((s) => !CONFIRMING_CATEGORIES.has(s.signalCategory)).map((s) => s.id);
  const confirming = accessible.filter((s) => CONFIRMING_CATEGORIES.has(s.signalCategory));

  const byGroup = new Map<string, IndependenceGroupSummary>();
  for (const s of confirming) {
    const existing = byGroup.get(s.independenceGroup);
    byGroup.set(s.independenceGroup, existing
      ? { ...existing, sourceIds: [...existing.sourceIds, s.id] }
      : { group: s.independenceGroup, category: s.signalCategory, sourceIds: [s.id] });
  }
  const groups = [...byGroup.values()];
  const categories = new Set(groups.map((g) => g.category));
  return {
    independentCategoryCount: categories.size,
    hasPrimary: groups.some((g) => PRIMARY_CATEGORIES.has(g.category)),
    groups,
    nonConfirmingSourceIds,
  };
}
```

- [ ] **Step 3: Run and commit**

Run: `npm test -- tests/unit/editorial/independence` → PASS.

```bash
git add -A
git commit -m "feat(editorial): engine types and independence/press-release grouping rules"
```

---

### Task 17: Coverage rules

**Files:**
- Create: `convex/editorial/coverage.ts`, `tests/unit/editorial/coverage.test.ts`

**Interfaces:**
- Produces: `coverageSummary(input: CoverageInput) → { passStatus: "pending"|"complete"|"failed", originalReportCount: number, countedReportIds: string[], groupsChecked: string[] }`, `coverageGapAllowed(summary) → boolean`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { coverageGapAllowed, coverageSummary } from "../../../convex/editorial/coverage";
import type { CoverageInput } from "../../../convex/editorial/types";

const done = { general: "succeeded", community: "succeeded" } as const;
const report = (id: string, group: "general" | "community", independenceGroup = id) => ({ id, group, independenceGroup });

describe("coverage", () => {
  it("is complete only when both partitions succeeded", () => {
    expect(coverageSummary({ partitions: done, reports: [] }).passStatus).toBe("complete");
    expect(coverageSummary({ partitions: { general: "succeeded", community: "pending" }, reports: [] }).passStatus).toBe("pending");
    expect(coverageSummary({ partitions: { general: "succeeded", community: "failed" }, reports: [] }).passStatus).toBe("failed");
  });

  it("counts syndicated copies once", () => {
    const s = coverageSummary({ partitions: done, reports: [report("a", "general", "wire-1"), report("b", "general", "wire-1"), report("c", "community")] });
    expect(s.originalReportCount).toBe(2);
  });

  it("counts a community outlet the same as a large outlet", () => {
    const s = coverageSummary({ partitions: done, reports: [report("c1", "community"), report("c2", "community"), report("c3", "community")] });
    expect(s.originalReportCount).toBe(3);
    expect(coverageGapAllowed(s)).toBe(false);
  });

  it("allows the gap label at 0, 1, 2 and blocks at 3", () => {
    const n = (k: number): CoverageInput => ({ partitions: done, reports: Array.from({ length: k }, (_, i) => report(`r${i}`, "general")) });
    expect(coverageGapAllowed(coverageSummary(n(0)))).toBe(true);
    expect(coverageGapAllowed(coverageSummary(n(2)))).toBe(true);
    expect(coverageGapAllowed(coverageSummary(n(3)))).toBe(false);
  });

  it("blocks the gap label when the pass failed even with zero reports", () => {
    const s = coverageSummary({ partitions: { general: "failed", community: "succeeded" }, reports: [] });
    expect(coverageGapAllowed(s)).toBe(false);
  });
});
```

- [ ] **Step 2: `convex/editorial/coverage.ts`**

```ts
import { MAX_COVERAGE_REPORTS } from "../config/ruleset";
import { REQUIRED_COVERAGE_GROUPS } from "../config/coverageOutlets";
import type { CoverageInput } from "./types";

export type CoverageSummary = {
  passStatus: "pending" | "complete" | "failed";
  originalReportCount: number;
  countedReportIds: string[];
  groupsChecked: string[];
};

export function coverageSummary(input: CoverageInput): CoverageSummary {
  const statuses = REQUIRED_COVERAGE_GROUPS.map((g) => input.partitions[g]);
  const passStatus = statuses.some((s) => s === "failed") ? "failed" : statuses.every((s) => s === "succeeded") ? "complete" : "pending";

  const seen = new Set<string>();
  const countedReportIds = input.reports.filter((r) => {
    if (seen.has(r.independenceGroup)) return false;
    seen.add(r.independenceGroup);
    return true;
  }).map((r) => r.id);

  return {
    passStatus,
    originalReportCount: countedReportIds.length,
    countedReportIds,
    groupsChecked: REQUIRED_COVERAGE_GROUPS.filter((g) => input.partitions[g] === "succeeded"),
  };
}

export const coverageGapAllowed = (s: CoverageSummary) => s.passStatus === "complete" && s.originalReportCount <= MAX_COVERAGE_REPORTS;
```

- [ ] **Step 3: Run and commit**

Run: `npm test -- tests/unit/editorial/coverage` → PASS.

```bash
git add -A
git commit -m "feat(editorial): equitable coverage completion and original-report counting"
```

---

### Task 18: Eligibility gate

**Files:**
- Create: `convex/editorial/eligibility.ts`, `tests/unit/editorial/eligibility.test.ts`, `tests/fixtures/editorial.ts`

**Interfaces:**
- Consumes: `independenceSummary`, `coverageSummary`.
- Produces: `evaluateEligibility(input: CandidateInput) → { eligible: true, independence, coverage } | { eligible: false, reasons: ExclusionReason[], independence, coverage }`.

- [ ] **Step 1: Shared fixture builder** — `tests/fixtures/editorial.ts`

```ts
import type { CandidateInput, EngineSource } from "../../convex/editorial/types";

export const HOUR = 60 * 60 * 1000;
export const NOW = 1_800_000_000_000;

export const src = (id: string, signalCategory: EngineSource["signalCategory"], overrides: Partial<EngineSource> = {}): EngineSource =>
  ({ id, signalCategory, independenceGroup: id, isAccessible: true, isPromotional: false, publishedAt: NOW - 12 * HOUR, ...overrides });

export const eligibleCandidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  localityBand: "direct_city",
  beat: "housing",
  relevanceBand: "policy_service_change",
  initiatingSignalAt: NOW - 24 * HOUR,
  now: NOW,
  sources: [src("official", "official_record"), src("news", "original_news")],
  coverage: { partitions: { general: "succeeded", community: "succeeded" }, reports: [] },
  hasTrendMomentum: false,
  isDuplicateOfCandidate: false,
  isSpeculative: false,
  isRoutineCrime: false,
  hasMaterialConflict: false,
  ...overrides,
});
```

- [ ] **Step 2: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../../convex/editorial/eligibility";
import { HOUR, NOW, eligibleCandidate, src } from "../../fixtures/editorial";

const reasonsOf = (r: ReturnType<typeof evaluateEligibility>) => (r.eligible ? [] : r.reasons);

describe("evaluateEligibility", () => {
  it("passes the baseline candidate", () => {
    expect(evaluateEligibility(eligibleCandidate()).eligible).toBe(true);
  });
  it("fails reddit-only", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources: [src("r", "community_discussion")] })))).toContain("insufficient_independence");
  });
  it("fails one primary source alone (stricter two-category gate)", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources: [src("o", "official_record")] })))).toContain("insufficient_independence");
  });
  it("fails duplicate release counted once", () => {
    const sources = [src("a", "original_news", { independenceGroup: "pr" }), src("b", "public_web", { independenceGroup: "pr" })];
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ sources })))).toContain("insufficient_independence");
  });
  it("fails when coverage pass failed", () => {
    const r = evaluateEligibility(eligibleCandidate({ coverage: { partitions: { general: "failed", community: "succeeded" }, reports: [] } }));
    expect(reasonsOf(r)).toContain("coverage_pass_incomplete");
  });
  it("fails with three original reports", () => {
    const reports = ["a", "b", "c"].map((id) => ({ id, independenceGroup: id, group: "general" as const }));
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ coverage: { partitions: { general: "succeeded", community: "succeeded" }, reports } })))).toContain("already_covered");
  });
  it("fails weak locality", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ localityBand: "none" })))).toContain("weak_locality");
  });
  it("fails pure promotion", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ relevanceBand: "promotion_only" })))).toContain("promotional");
  });
  it("fails stale initiating signal", () => {
    expect(reasonsOf(evaluateEligibility(eligibleCandidate({ initiatingSignalAt: NOW - 8 * 24 * HOUR })))).toContain("stale");
  });
  it("fails when a needed source is inaccessible", () => {
    const sources = [src("o", "official_record"), src("n", "original_news", { isAccessible: false })];
    const r = evaluateEligibility(eligibleCandidate({ sources }));
    expect(reasonsOf(r)).toEqual(expect.arrayContaining(["inaccessible_evidence", "insufficient_independence"]));
  });
  it("returns every failed reason, not just the first", () => {
    const r = evaluateEligibility(eligibleCandidate({ localityBand: "none", isDuplicateOfCandidate: true, isSpeculative: true, isRoutineCrime: true, beat: null }));
    expect(reasonsOf(r)).toEqual(expect.arrayContaining(["weak_locality", "duplicate", "speculative", "routine_crime", "no_beat_relevance"]));
  });
});
```

- [ ] **Step 3: `convex/editorial/eligibility.ts`**

```ts
import { DISCOVERY_WINDOW_MS, MAX_COVERAGE_REPORTS, MIN_INDEPENDENT_CATEGORIES } from "../config/ruleset";
import { coverageSummary, type CoverageSummary } from "./coverage";
import { independenceSummary, type IndependenceSummary } from "./independence";
import type { CandidateInput, ExclusionReason } from "./types";

export type EligibilityResult =
  | { eligible: true; independence: IndependenceSummary; coverage: CoverageSummary }
  | { eligible: false; reasons: ExclusionReason[]; independence: IndependenceSummary; coverage: CoverageSummary };

export function evaluateEligibility(input: CandidateInput): EligibilityResult {
  const independence = independenceSummary(input.sources);
  const coverage = coverageSummary(input.coverage);
  const reasons: ExclusionReason[] = [];

  if (input.localityBand === "none") reasons.push("weak_locality");
  if (input.now - input.initiatingSignalAt > DISCOVERY_WINDOW_MS) reasons.push("stale");
  if (independence.independentCategoryCount < MIN_INDEPENDENT_CATEGORIES) reasons.push("insufficient_independence");
  if (input.beat === null) reasons.push("no_beat_relevance");
  if (input.relevanceBand === "promotion_only") reasons.push("promotional");
  if (coverage.originalReportCount > MAX_COVERAGE_REPORTS) reasons.push("already_covered");
  if (input.sources.some((s) => !s.isAccessible)) reasons.push("inaccessible_evidence");
  if (coverage.passStatus !== "complete") reasons.push("coverage_pass_incomplete");
  if (input.isDuplicateOfCandidate) reasons.push("duplicate");
  if (input.isSpeculative) reasons.push("speculative");
  if (input.isRoutineCrime) reasons.push("routine_crime");

  return reasons.length === 0
    ? { eligible: true, independence, coverage }
    : { eligible: false, reasons, independence, coverage };
}
```

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/unit/editorial/eligibility` → PASS.

```bash
git add -A
git commit -m "feat(editorial): strict eligibility gate with machine-readable exclusion reasons"
```

---

### Task 19: 100-point score

**Files:**
- Create: `convex/editorial/scoring.ts`, `tests/unit/editorial/scoring.test.ts`

**Interfaces:**
- Consumes: `EligibilityResult`, `CandidateInput`.
- Produces: `calculateScore(input, eligibility) → Score | null` where `Score = { total: number; components: ScoreComponents }` and `ScoreComponents` matches `vScoreComponents` (Task 11): keys `milwaukeeEvidence`, `crossSource`, `freshness`, `coverageScarcity`, `relevance`, each `{ points, max, bandId, reason, evidenceIds }`. Returns `null` for ineligible candidates. Also exports `diagnosticCrossSourceBand(independence)` for the exclusion view.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "../../../convex/editorial/eligibility";
import { calculateScore, diagnosticCrossSourceBand } from "../../../convex/editorial/scoring";
import { HOUR, NOW, eligibleCandidate, src } from "../../fixtures/editorial";

const score = (overrides: Parameters<typeof eligibleCandidate>[0] = {}) => {
  const input = eligibleCandidate(overrides);
  return calculateScore(input, evaluateEligibility(input));
};
const reports = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `r${i}`, independenceGroup: `r${i}`, group: "general" as const }));
const cov = (k: number) => ({ partitions: { general: "succeeded", community: "succeeded" } as const, reports: reports(k) });

describe("calculateScore", () => {
  it("returns null for ineligible", () => {
    expect(score({ localityBand: "none" })).toBeNull();
  });
  it("total equals component sum and max is 100", () => {
    const s = score({ hasTrendMomentum: true })!;
    const sum = Object.values(s.components).reduce((a, c) => a + c.points, 0);
    expect(s.total).toBe(sum);
    expect(Object.values(s.components).reduce((a, c) => a + c.max, 0)).toBe(100);
  });
  it("locality bands", () => {
    expect(score()!.components.milwaukeeEvidence.points).toBe(25);
    expect(score({ localityBand: "county_city_effect" })!.components.milwaukeeEvidence.points).toBe(18);
    expect(score({ localityBand: "area_city_consequence" })!.components.milwaukeeEvidence.points).toBe(12);
  });
  it("cross-source bands", () => {
    expect(score()!.components.crossSource.points).toBe(15); // 2 incl primary
    expect(score({ sources: [src("o", "official_record"), src("n", "original_news"), src("e", "event")] })!.components.crossSource.points).toBe(20);
    expect(score({ sources: [src("n", "original_news"), src("e", "event")] })!.components.crossSource.points).toBe(10);
    expect(diagnosticCrossSourceBand(evaluateEligibility(eligibleCandidate({ sources: [src("o", "official_record")] })).independence).points).toBe(5);
  });
  it("freshness bands", () => {
    expect(score({ initiatingSignalAt: NOW - 10 * HOUR, hasTrendMomentum: true })!.components.freshness.points).toBe(15);
    expect(score({ initiatingSignalAt: NOW - 60 * HOUR })!.components.freshness.points).toBe(10);
    const old = [src("o", "official_record", { publishedAt: NOW - 5 * 24 * HOUR }), src("n", "original_news", { publishedAt: NOW - 6 * 24 * HOUR })];
    expect(score({ initiatingSignalAt: NOW - 5 * 24 * HOUR, sources: old })!.components.freshness.points).toBe(5);
  });
  it("coverage scarcity bands at 0/1/2 and ineligible at 3", () => {
    expect(score({ coverage: cov(0) })!.components.coverageScarcity.points).toBe(25);
    expect(score({ coverage: cov(1) })!.components.coverageScarcity.points).toBe(15);
    expect(score({ coverage: cov(2) })!.components.coverageScarcity.points).toBe(5);
    expect(score({ coverage: cov(3) })).toBeNull();
  });
  it("relevance bands", () => {
    expect(score()!.components.relevance.points).toBe(15);
    expect(score({ relevanceBand: "community_cultural_impact" })!.components.relevance.points).toBe(10);
    expect(score({ relevanceBand: "emerging_question" })!.components.relevance.points).toBe(5);
  });
  it("every component names its evidence and reason", () => {
    for (const c of Object.values(score()!.components)) {
      expect(c.reason.length).toBeGreaterThan(10);
      expect(c.bandId).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: `convex/editorial/scoring.ts`**

```ts
import type { EligibilityResult } from "./eligibility";
import type { IndependenceSummary } from "./independence";
import { CONFIRMING_CATEGORIES, type CandidateInput } from "./types";

export type ScoreComponent = { points: number; max: number; bandId: string; reason: string; evidenceIds: string[] };
export type ScoreComponents = {
  milwaukeeEvidence: ScoreComponent;
  crossSource: ScoreComponent;
  freshness: ScoreComponent;
  coverageScarcity: ScoreComponent;
  relevance: ScoreComponent;
};
export type Score = { total: number; components: ScoreComponents };

const HOUR = 60 * 60 * 1000;

function milwaukeeEvidence(input: CandidateInput): ScoreComponent {
  const ids = input.sources.map((s) => s.id);
  switch (input.localityBand) {
    case "direct_city": return { points: 25, max: 25, bandId: "locality.direct", reason: "Sources document a direct City of Milwaukee action, address, institution, or impact.", evidenceIds: ids };
    case "county_city_effect": return { points: 18, max: 25, bandId: "locality.county", reason: "A Milwaukee County development with a sourced city effect.", evidenceIds: ids };
    case "area_city_consequence": return { points: 12, max: 25, bandId: "locality.area", reason: "An area development with a specific sourced city consequence.", evidenceIds: ids };
    default: return { points: 0, max: 25, bandId: "locality.none", reason: "No sourced Milwaukee connection.", evidenceIds: [] };
  }
}

export function diagnosticCrossSourceBand(ind: IndependenceSummary): ScoreComponent {
  const ids = ind.groups.flatMap((g) => g.sourceIds);
  const n = ind.independentCategoryCount;
  if (n >= 3 && ind.hasPrimary) return { points: 20, max: 20, bandId: "cross.3plus_primary", reason: `${n} independent source categories, including a primary record.`, evidenceIds: ids };
  if (n === 2 && ind.hasPrimary) return { points: 15, max: 20, bandId: "cross.2_primary", reason: "Two independent source categories, including a primary record.", evidenceIds: ids };
  if (n === 2) return { points: 10, max: 20, bandId: "cross.2_secondary", reason: "Two independent non-primary public sources.", evidenceIds: ids };
  if (n === 1 && ind.hasPrimary) return { points: 5, max: 20, bandId: "cross.1_primary_diagnostic", reason: "One primary record only; fails the two-category gate (diagnostic band).", evidenceIds: ids };
  return { points: 0, max: 20, bandId: "cross.none", reason: "No independent confirming source categories.", evidenceIds: ids };
}

function freshness(input: CandidateInput): ScoreComponent {
  const age = input.now - input.initiatingSignalAt;
  const recent = input.sources.filter((s) => s.isAccessible && CONFIRMING_CATEGORIES.has(s.signalCategory) && s.publishedAt !== undefined && input.now - s.publishedAt <= 72 * HOUR);
  const ids = recent.map((s) => s.id);
  if (age <= 48 * HOUR && (input.hasTrendMomentum || recent.length >= 2)) return { points: 15, max: 15, bandId: "fresh.48h_momentum", reason: "Initiating signal within 48 hours with trend growth or repeated signals.", evidenceIds: ids };
  if (age <= 72 * HOUR || recent.length >= 2) return { points: 10, max: 15, bandId: "fresh.72h", reason: "Initiating signal within 72 hours, or two recent signals.", evidenceIds: ids };
  return { points: 5, max: 15, bandId: "fresh.7d", reason: "One qualifying signal within the seven-day window.", evidenceIds: ids };
}

function coverageScarcity(e: EligibilityResult): ScoreComponent {
  const n = e.coverage.originalReportCount;
  const ids = e.coverage.countedReportIds;
  if (n === 0) return { points: 25, max: 25, bandId: "coverage.0", reason: "No qualifying original local report found in the prior 30 days.", evidenceIds: ids };
  if (n === 1) return { points: 15, max: 25, bandId: "coverage.1", reason: "One qualifying original local report found in the prior 30 days.", evidenceIds: ids };
  if (n === 2) return { points: 5, max: 25, bandId: "coverage.2", reason: "Two qualifying original local reports found in the prior 30 days.", evidenceIds: ids };
  return { points: 0, max: 25, bandId: "coverage.3plus", reason: "Three or more qualifying original reports; fails eligibility.", evidenceIds: ids };
}

function relevance(input: CandidateInput): ScoreComponent {
  const ids = input.sources.map((s) => s.id);
  switch (input.relevanceBand) {
    case "policy_service_change": return { points: 15, max: 15, bandId: "relevance.policy", reason: "Documented policy, service, access, resource, safety, or spending change.", evidenceIds: ids };
    case "community_cultural_impact": return { points: 10, max: 15, bandId: "relevance.community", reason: "Documented community or cultural impact.", evidenceIds: ids };
    case "emerging_question": return { points: 5, max: 15, bandId: "relevance.emerging", reason: "Emerging beat question with unestablished impact.", evidenceIds: ids };
    default: return { points: 0, max: 15, bandId: "relevance.promotion", reason: "Pure promotion.", evidenceIds: [] };
  }
}

export function calculateScore(input: CandidateInput, eligibility: EligibilityResult): Score | null {
  if (!eligibility.eligible) return null;
  const components: ScoreComponents = {
    milwaukeeEvidence: milwaukeeEvidence(input),
    crossSource: diagnosticCrossSourceBand(eligibility.independence),
    freshness: freshness(input),
    coverageScarcity: coverageScarcity(eligibility),
    relevance: relevance(input),
  };
  const total = Object.values(components).reduce((sum, c) => sum + c.points, 0);
  return { total, components };
}
```

- [ ] **Step 3: Run and commit**

Run: `npm test -- tests/unit/editorial/scoring` → PASS.

```bash
git add -A
git commit -m "feat(editorial): fixed-band 100-point score with evidence references"
```

---

### Task 20: Label promotion, evaluate wrapper, correction recalculation

**Files:**
- Create: `convex/editorial/status.ts`, `tests/unit/editorial/status.test.ts`

**Interfaces:**
- Produces:
  - `derivePrimaryLabel({ eligible, coverage, hasMaterialConflict, needsReverification }) → ProductLabel` (one of `Worth a look`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`).
  - `evaluateCandidate(input: CandidateInput) → CandidateEvaluation = { status: "eligible"|"excluded", label, reasons, score, independence, coverage }`.
  - `applyCorrection(input, correction: Partial<Pick<CandidateInput, "beat"|"localityBand"|"relevanceBand">> & { sourceGroups?: Record<string,string>; sourceCategories?: Record<string, SignalCategory> }) → CandidateInput` (immutable).
  - `eligibilityTransition(before, after) → "none" | "No longer qualifies"`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyCorrection, derivePrimaryLabel, eligibilityTransition, evaluateCandidate } from "../../../convex/editorial/status";
import { eligibleCandidate, src } from "../../fixtures/editorial";

describe("status", () => {
  it("eligible + complete coverage ≤2 → Coverage gap", () => {
    expect(evaluateCandidate(eligibleCandidate()).label).toBe("Coverage gap");
  });
  it("failed coverage never yields the gap label even when everything else passes", () => {
    const e = evaluateCandidate(eligibleCandidate({ coverage: { partitions: { general: "failed", community: "succeeded" }, reports: [] } }));
    expect(e.status).toBe("excluded");
    expect(e.label).toBe("Worth a look");
  });
  it("material conflict shows Conflicting reports and keeps the candidate", () => {
    const e = evaluateCandidate(eligibleCandidate({ hasMaterialConflict: true }));
    expect(e.label).toBe("Conflicting reports");
    expect(e.status).toBe("eligible");
  });
  it("inaccessible needed source → Needs a recheck", () => {
    const e = evaluateCandidate(eligibleCandidate({ sources: [src("o", "official_record"), src("n", "original_news", { isAccessible: false })] }));
    expect(e.label).toBe("Needs a recheck");
    expect(e.status).toBe("excluded");
  });
  it("derivePrimaryLabel never returns the gap label without complete coverage", () => {
    expect(derivePrimaryLabel({ eligible: true, coveragePassStatus: "pending", originalReportCount: 0, hasMaterialConflict: false, needsReverification: false })).toBe("Worth a look");
  });
  it("a correction recalculates without touching disposition and does not mutate input", () => {
    const input = eligibleCandidate();
    const corrected = applyCorrection(input, { localityBand: "none" });
    expect(input.localityBand).toBe("direct_city");
    expect(evaluateCandidate(corrected).status).toBe("excluded");
    expect(evaluateCandidate(corrected)).not.toHaveProperty("disposition");
  });
  it("correcting duplicate-source grouping can restore eligibility", () => {
    const dup = eligibleCandidate({ sources: [src("a", "original_news", { independenceGroup: "pr" }), src("b", "official_record", { independenceGroup: "pr" })] });
    expect(evaluateCandidate(dup).status).toBe("excluded");
    const fixed = applyCorrection(dup, { sourceGroups: { b: "b" } });
    expect(evaluateCandidate(fixed).status).toBe("eligible");
    expect(eligibilityTransition(evaluateCandidate(dup), evaluateCandidate(fixed))).toBe("none");
    expect(eligibilityTransition(evaluateCandidate(fixed), evaluateCandidate(fixed))).toBe("none");
    expect(eligibilityTransition(evaluateCandidate(fixed), evaluateCandidate(dup))).toBe("No longer qualifies");
  });
});
```

- [ ] **Step 2: `convex/editorial/status.ts`**

```ts
import { coverageGapAllowed, type CoverageSummary } from "./coverage";
import { evaluateEligibility, type EligibilityResult } from "./eligibility";
import type { IndependenceSummary } from "./independence";
import { calculateScore, type Score } from "./scoring";
import type { CandidateInput, ExclusionReason, SignalCategory } from "./types";

export type PrimaryLabel = "Worth a look" | "Coverage gap" | "Conflicting reports" | "Needs a recheck";

export function derivePrimaryLabel(a: {
  eligible: boolean;
  coveragePassStatus: CoverageSummary["passStatus"];
  originalReportCount: number;
  hasMaterialConflict: boolean;
  needsReverification: boolean;
}): PrimaryLabel {
  if (a.needsReverification) return "Needs a recheck";
  if (a.hasMaterialConflict) return "Conflicting reports";
  if (a.eligible && coverageGapAllowed({ passStatus: a.coveragePassStatus, originalReportCount: a.originalReportCount, countedReportIds: [], groupsChecked: [] })) return "Coverage gap";
  return "Worth a look";
}

export type CandidateEvaluation = {
  status: "eligible" | "excluded";
  label: PrimaryLabel;
  reasons: ExclusionReason[];
  score: Score | null;
  independence: IndependenceSummary;
  coverage: CoverageSummary;
};

export function evaluateCandidate(input: CandidateInput): CandidateEvaluation {
  const eligibility: EligibilityResult = evaluateEligibility(input);
  const reasons = eligibility.eligible ? [] : eligibility.reasons;
  const label = derivePrimaryLabel({
    eligible: eligibility.eligible,
    coveragePassStatus: eligibility.coverage.passStatus,
    originalReportCount: eligibility.coverage.originalReportCount,
    hasMaterialConflict: input.hasMaterialConflict,
    needsReverification: reasons.includes("inaccessible_evidence"),
  });
  return {
    status: eligibility.eligible ? "eligible" : "excluded",
    label,
    reasons,
    score: calculateScore(input, eligibility),
    independence: eligibility.independence,
    coverage: eligibility.coverage,
  };
}

export type Correction = Partial<Pick<CandidateInput, "beat" | "localityBand" | "relevanceBand">> & {
  sourceGroups?: Record<string, string>;
  sourceCategories?: Record<string, SignalCategory>;
};

export function applyCorrection(input: CandidateInput, c: Correction): CandidateInput {
  const { sourceGroups, sourceCategories, ...scalars } = c;
  return {
    ...input,
    ...scalars,
    sources: input.sources.map((s) => ({
      ...s,
      independenceGroup: sourceGroups?.[s.id] ?? s.independenceGroup,
      signalCategory: sourceCategories?.[s.id] ?? s.signalCategory,
    })),
  };
}

export const eligibilityTransition = (before: CandidateEvaluation, after: CandidateEvaluation): "none" | "No longer qualifies" =>
  before.status === "eligible" && after.status === "excluded" ? "No longer qualifies" : "none";
```

- [ ] **Step 3: Run the whole engine suite and commit**

Run: `npm test -- tests/unit/editorial && npm run typecheck` → all PASS. Confirm fixtures cover: Reddit-only, failed coverage, duplicate release, conflicting claims, inaccessible citation, weak locality, pure promotion, every score band (they do — see Tasks 17–20).

```bash
git add -A
git commit -m "feat(editorial): label promotion, evaluateCandidate, immutable corrections, eligibility transitions"
```

---

### Task 21: Close out items 1–4

- [ ] **Step 1: Full check**

Run: `npm run check && npm run test:e2e && npm run build` → all green.

- [ ] **Step 2: Decision log** — create `docs/decisions/001-untitled-ui-over-shadcn.md` and `docs/decisions/002-rules-engine-pure-functions.md` using the format in the global CLAUDE.md (Decision / Why / Options / Chosen / Gave up / How we'll know / What actually happened — blank). Create `docs/LEARNING-LOG.md` with one dated entry.

- [ ] **Step 3: Push**

```bash
git add -A
git commit -m "docs: decision log entries for UI foundation and pure rules engine"
git push
```

Next plan: `2026-08-21-signalgap-evidence-slice.md` (checklist items 5–7, Review Pause 2).

---

## Self-review notes

- **Spec coverage (items 1–4):** Item 1 → Tasks 1–3. Item 2 → Tasks 4–10. Item 3 → Tasks 11–14. Item 4 → Tasks 15–20. Search-intent validator and budget-reservation concurrency (119/120/121) belong to item 5 and are deferred to the next plan on purpose.
- **Type consistency:** `ScoreComponents` keys in `scoring.ts` match `vScoreComponents` in `validators.ts`. `PrimaryLabel` is a subset of `vProductLabel`. `Beat` in `convex/config/beats.ts` and `src/lib/source-labels.ts` share the same three keys.
- **Known gap:** `scans.startScan` does not start the workflow yet (flagged with a `ponytail:` comment). That is item 8.
