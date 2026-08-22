# SignalGap Search + AI Implementation Plan (Checklist items 5–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SignalGap live eyes and a language brain: an approved-only SerpApi adapter that reserves budget, archives raw JSON, and normalizes six engines into one result shape; and five source-bound AI contracts that can suggest but never decide.

**Architecture:** Two layers, both behind internal-only Convex functions. `convex/integrations/serpapi/` owns query construction, HTTP, retry, raw archive, and engine normalization — a model can propose an *intent*, never a URL or a parameter. `convex/ai/` exposes one `generateStructured` boundary over the Vercel AI SDK; every operation is a strict Zod schema whose output is re-validated against stored source IDs before anything persists. The existing pure rules engine in `convex/editorial/` stays the only thing that sets eligibility, score, or a label.

**Tech Stack:** Convex 1.45 (actions, internal mutations, File Storage), `ai` 7.x with `@ai-sdk/anthropic` 4.x / `@ai-sdk/openai` 4.x, Zod 4, Vitest 4 (`unit` = node, `integration` = edge-runtime), SerpApi REST.

**Spec:** `docs/hackathon-build/spec.md` (authority), with `prd.md` and `checklist.md`. This plan covers **checklist items 5 and 6** (Linear MOO-731, MOO-732).

**Scope note — read this first.** The checklist groups items 5, 6 and 7 as one stretch ending at Review Pause 2. This plan deliberately stops after item 6. Item 7 is the vertical slice that renders whatever items 5–6 actually produce; writing its tasks now would mean predicting the exact shape of the evidence snapshot and the brief payload, and a plan that guesses its own interfaces is a plan that lies. Item 7 gets its own plan, written against the real interfaces, once this one lands. Nothing in item 7 is dropped — only sequenced.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

**Search**
- Engines, exactly: `google`, `google_news`, `google_trends_trending_now`, `google_events`, `youtube`, `google_maps`.
- Purposes, exactly: `discovery`, `corroboration`, `coverage`, `enrichment`.
- Location string: `"Milwaukee, Wisconsin, United States"`. Languages: `en`, `es`. Time windows: `7d`, `30d`, `current`.
- Budget per scan: discovery 16, coverage 20, corroboration 20, enrichment 30, reserve 34, **hard cap 120**. Already in `convex/config/searchBudget.ts`. No code path may call SerpApi without a successful reservation. Required coverage capacity is reserved before optional Maps/YouTube enrichment.
- Every live scan starts with the same **13 fixed discovery searches**: 1 Trends Trending Now, 3 English Google News (one per beat), 3 Google-indexed `r/milwaukee` (one per beat), 3 Spanish Google Search (one per beat), 3 official-domain Google Search (one per beat). (Google Events moved to conditional enrichment — decision 005, `docs/decisions/005-google-events-moves-to-enrichment.md`.)
- Search idempotency key: `scanId:purpose:templateId:normalizedQueryHash`.
- SerpApi HTTP: 60-second timeout; at most two retries for network errors, 429, and 5xx, with jittered delays near 2s and 8s. Never retry 4xx other than 429, invalid input, auth failure, cancelled work, policy rejection, or exhausted budget.
- The API key is appended inside the action and never written to `searchRuns.parameters`, never logged, never returned.
- Google-indexed Reddit: constrain with `site:reddit.com/r/milwaukee/comments/`; a result counts only if its URL matches `/r/milwaukee/comments/<id>/`; dedupe by post ID; always labelled `Unverified tip`; may initiate a candidate; **never** counts as corroboration.
- Initial Google-family calls use `gl=us`, `hl=en` or `hl=es`, the Milwaukee location where the engine supports it, and up to 10 results with no pagination. A second results page is a separately reserved supplemental search.
- Coverage renders **two** 30-day domain-disjunction queries per candidate: `coverage-general-01` over every general outlet domain and `coverage-community-01` over every community/culturally specific domain. Both must succeed for `coveragePassStatus = "complete"`.

**AI**
- Five operations, exactly: `analyzeResults`, `clusterSignals`, `classifyEvidence`, `planFollowUp`, `generateBrief`.
- Model idempotency key: `scanId:candidateId:operation:inputSnapshotHash:schemaVersion:promptVersion:modelId`.
- AI generation: 120-second timeout; at most two retries for network/429/5xx; **one** schema-invalid retry on the same provider, then optionally the configured fallback model, which creates a separate linked `modelRuns` row and a visible operational event. Never silently mix outputs from two models.
- Invalid output is stored as a failed model run and **never partially merged**.
- A model may not: reserve budget, execute a query, promote a claim to confirmed, set eligibility, apply `Coverage gap`, or assign a score. `planFollowUp` returns intents with no executable URL and no raw SerpApi parameters.
- Every source reference in model output is an opaque application ID supplied in the input. Any ID not present in the input invalidates the whole output. Any output field labelled a quotation must match a stored excerpt exactly.
- Spanish results keep original title, snippet, publisher, date and URL; translation is added beside the original and labelled as an AI translation. Translation never changes verification state and never makes two sources independent.
- **Decision 004 (binding):** every judgment field the rules engine reads (`localityBand`, `relevanceBand`, `beat`, `isSpeculative`, `isRoutineCrime`, `isDuplicateOfCandidate`, `hasMaterialConflict`) carries `basis: "deterministic" | "ai_suggested" | "editor"`. `localityBand` must try the deterministic path first via `isOfficialDomain`.

**Everything**
- Convex times are Unix milliseconds. Every public function has `args` and `returns` validators, requires Clerk identity, and derives `ownerId` server-side. Processing functions are `internalMutation` / `internalAction` only.
- Raw SerpApi JSON goes to Convex File Storage; `rawStorageId` is never returned to a browser.
- Secrets live only in Convex env: `SERPAPI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PRIMARY_MODEL`, `AI_FALLBACK_MODEL`, `AI_FALLBACK_ENABLED`. Never committed; `.env.example` carries names only.
- npm only. Commit after every task with `(MOO-731)` for items 5 tasks and `(MOO-732)` for item 6 tasks. Do not run `/simplify` or any refactor pass.
- `npx convex codegen` does **not** deploy. After adding or changing a Convex function that a CLI or e2e run will call, also run `npx convex dev --once`.
- Paid calls: fixtures by default. Live SerpApi and live model calls run only under `LIVE_TESTS=1` and must be bounded and announced.

---

## File Structure

```
convex/
  integrations/serpapi/
    contracts.ts        # SearchSpec, SourceResultInput, engine literals — types only
    canonical.ts        # canonicalizeUrl, extractRedditPostId, contentHash
    queryCatalog.ts     # the 16 frozen discovery templates + 2 coverage partitions
    client.ts           # timeout, retry, raw fetch; no Convex imports
    normalize.ts        # engine response -> SourceResultInput[]
    executeSearch.ts    # internalAction: reserve -> call -> archive -> ingest
  editorial/
    searchIntent.ts     # validateSearchIntent: model intent -> approved SearchSpec or rejection
  ai/
    provider.ts         # generateStructured boundary, primary/fallback, modelRuns rows
    contracts.ts        # Zod input/output schemas for the five operations
    prompts.ts          # versioned prompt builders
    validateOutput.ts   # source-binding, excerpt equality, enum/length checks
    analyzeResults.ts
    clusterSignals.ts
    classifyEvidence.ts
    planFollowUp.ts
    generateBrief.ts
  searchRuns.ts         # + internal reserve / complete / fail mutations
  sourceResults.ts      # internal ingest + owner-scoped reads
  modelRuns.ts          # internal create/complete + owner-scoped read

tests/
  unit/serpapi/         # catalog, canonicalization, intent validator, normalizers, client retry
  unit/ai/              # contracts, validateOutput, provider routing
  integration/          # search-storage slice, budget concurrency, model fallback, bilingual
  live/                 # opt-in bounded smoke tests
  fixtures/serpapi/     # redacted captured JSON per engine
  fixtures/evaluation/  # 15–20 reviewed Milwaukee packets + expected annotations
scripts/
  capture-serpapi-fixture.ts   # writes a redacted fixture from one live call
  evaluate-models.ts           # Sonnet vs fallback comparison report
```

---

# Part A — Item 5: SerpApi adapter (MOO-731)

### Task 1: Search contracts and the intent validator

**Files:**
- Create: `convex/integrations/serpapi/contracts.ts`, `convex/editorial/searchIntent.ts`, `tests/unit/serpapi/search-intent.test.ts`

**Interfaces:**
- Consumes: `SEARCH_BUDGET` (`convex/config/searchBudget.ts`), `Beat` (`convex/config/beats.ts`).
- Produces — every later task imports these:

```ts
// convex/integrations/serpapi/contracts.ts
export type SerpEngine = "google" | "google_news" | "google_trends_trending_now" | "google_events" | "youtube" | "google_maps";
export type SearchPurpose = "discovery" | "corroboration" | "coverage" | "enrichment";
export type TimeWindow = "7d" | "30d" | "current";
export type SearchLanguage = "en" | "es";
export const MILWAUKEE_LOCATION = "Milwaukee, Wisconsin, United States" as const;

export type SearchSpec = {
  templateId: string;
  engine: SerpEngine;
  purpose: SearchPurpose;
  query: string;
  location: typeof MILWAUKEE_LOCATION;
  language: SearchLanguage;
  timeWindow: TimeWindow;
  candidateId?: string;
};

export type SourceFamily = "news" | "official" | "event" | "video" | "map" | "community_discussion" | "public_web" | "trend";

export type SourceResultInput = {
  engine: SerpEngine;
  canonicalUrl: string;
  originalUrl: string;
  nativeId?: string;
  title: string;
  snippet: string;
  publisher?: string;
  author?: string;
  channel?: string;
  placeName?: string;
  publishedAt?: number;
  position?: number;
  originalLanguage: string;
  sourceFamily: SourceFamily;
};

// What a model is allowed to ask for. No URL, no engine parameters.
export type SearchIntent = {
  templateId: string;
  purpose: SearchPurpose;
  reason: string;
  candidateId?: string;
  /** Only substituted into a template's declared slots; never concatenated raw. */
  entityTerms?: string[];
};
```

- Produces: `validateSearchIntent(intent, ctx) → { ok: true; spec: SearchSpec } | { ok: false; reason: IntentRejection }` where `IntentRejection = "unknown_template" | "purpose_mismatch" | "empty_query" | "window_too_wide" | "raw_parameters" | "budget_exhausted" | "unapproved_domain"`. `ctx` is `{ now: number; remainingForPurpose: number; beat?: Beat }`.

- [ ] **Step 1: Write the failing test** — `tests/unit/serpapi/search-intent.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { validateSearchIntent } from "../../../convex/editorial/searchIntent";

const ctx = { now: 1_800_000_000_000, remainingForPurpose: 5 };

describe("validateSearchIntent", () => {
  it("accepts a known template and returns an approved spec", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "discovery", reason: "beat sweep" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.engine).toBe("google_news");
    expect(r.spec.location).toBe("Milwaukee, Wisconsin, United States");
    expect(r.spec.timeWindow).toBe("7d");
    expect(r.spec.query.length).toBeGreaterThan(0);
  });

  it("rejects an unknown template", () => {
    const r = validateSearchIntent({ templateId: "make-something-up", purpose: "discovery", reason: "x" }, ctx);
    expect(r).toEqual({ ok: false, reason: "unknown_template" });
  });

  it("rejects a purpose the template was not registered for", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "coverage", reason: "x" }, ctx);
    expect(r).toEqual({ ok: false, reason: "purpose_mismatch" });
  });

  it("rejects when the purpose has no budget left", () => {
    const r = validateSearchIntent({ templateId: "news-housing-en-01", purpose: "discovery", reason: "x" }, { ...ctx, remainingForPurpose: 0 });
    expect(r).toEqual({ ok: false, reason: "budget_exhausted" });
  });

  it("rejects raw SerpApi parameters smuggled through entity terms", () => {
    const r = validateSearchIntent(
      { templateId: "news-housing-en-01", purpose: "discovery", reason: "x", entityTerms: ["&api_key=abc"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "raw_parameters" });
  });

  it("rejects a URL smuggled through entity terms", () => {
    const r = validateSearchIntent(
      { templateId: "news-housing-en-01", purpose: "discovery", reason: "x", entityTerms: ["https://example.com/x"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "raw_parameters" });
  });

  it("rejects an entity term naming a domain outside the approved sets", () => {
    const r = validateSearchIntent(
      { templateId: "official-housing-01", purpose: "discovery", reason: "x", entityTerms: ["site:example.com"] },
      ctx,
    );
    expect(r).toEqual({ ok: false, reason: "unapproved_domain" });
  });

  it("rejects an empty entity term list that renders an empty query", () => {
    const r = validateSearchIntent({ templateId: "corroborate-entity-01", purpose: "corroboration", reason: "x", entityTerms: [] }, ctx);
    expect(r).toEqual({ ok: false, reason: "empty_query" });
  });
});
```

Run: `npm test -- tests/unit/serpapi/search-intent`
Expected: FAIL — cannot resolve `convex/editorial/searchIntent`.

- [ ] **Step 2: Write `convex/integrations/serpapi/contracts.ts`** — exactly the types block above.

- [ ] **Step 3: Write `convex/editorial/searchIntent.ts`**

```ts
import { getTemplate, renderQuery } from "../integrations/serpapi/queryCatalog";
import { MILWAUKEE_LOCATION, type SearchIntent, type SearchSpec } from "../integrations/serpapi/contracts";

export type IntentRejection =
  | "unknown_template" | "purpose_mismatch" | "empty_query"
  | "window_too_wide" | "raw_parameters" | "budget_exhausted" | "unapproved_domain";

export type IntentResult = { ok: true; spec: SearchSpec } | { ok: false; reason: IntentRejection };

export type IntentContext = { now: number; remainingForPurpose: number };

// A model may supply plain search words only. Everything else is rejected, not
// sanitised: an allowlist cannot be out-argued by an operator we failed to imagine.
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const CONTROL = /[\x00-\x1F\x7F]/;
const ALLOWED_TERM = /^[\p{L}\p{N} .,'’\-&/]{1,80}$/u;
const MAX_ENTITY_TERMS = 8;

const normalizeTerm = (term: string) => term.normalize("NFKC").replace(ZERO_WIDTH, "").trim();

export function validateSearchIntent(intent: SearchIntent, ctx: IntentContext): IntentResult {
  const template = getTemplate(intent.templateId);
  if (!template) return { ok: false, reason: "unknown_template" };
  if (!template.purposes.includes(intent.purpose)) return { ok: false, reason: "purpose_mismatch" };
  if (ctx.remainingForPurpose <= 0) return { ok: false, reason: "budget_exhausted" };

  const rawTerms = intent.entityTerms ?? [];
  if (rawTerms.length > MAX_ENTITY_TERMS) return { ok: false, reason: "raw_parameters" };

  // Normalized (not raw) terms are what get checked AND what get rendered into the
  // query — NFKC folds tricks like a fullwidth "site：" colon back to ASCII "site:"
  // so the domain check below still catches it.
  const terms = rawTerms.map(normalizeTerm);
  for (const term of terms) {
    if (CONTROL.test(term)) return { ok: false, reason: "raw_parameters" };
    if (/\bsite:/i.test(term)) return { ok: false, reason: "unapproved_domain" };
    if (!ALLOWED_TERM.test(term)) return { ok: false, reason: "raw_parameters" };
  }
  if (template.requiresTerms && terms.length === 0) return { ok: false, reason: "empty_query" };

  const query = renderQuery(template, { now: ctx.now, terms });
  if (query.trim().length === 0) return { ok: false, reason: "empty_query" };

  const windowRank = { current: 0, "7d": 1, "30d": 2 } as const;
  // ponytail: unreachable with today's catalog — every template's own timeWindow
  // already fits inside its purposes' maxWindowForPurpose. Guards a future template
  // whose declared window exceeds what a purpose is allowed to see.
  if (windowRank[template.timeWindow] > windowRank[template.maxWindowForPurpose[intent.purpose] ?? template.timeWindow]) {
    return { ok: false, reason: "window_too_wide" };
  }

  return {
    ok: true,
    spec: {
      templateId: template.id,
      engine: template.engine,
      purpose: intent.purpose,
      query,
      location: MILWAUKEE_LOCATION,
      language: template.language,
      timeWindow: template.timeWindow,
      candidateId: intent.candidateId,
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it now fails only on the missing catalog**

Run: `npm test -- tests/unit/serpapi/search-intent`
Expected: FAIL — cannot resolve `queryCatalog`. That is Task 2. Do not stub it; go to Task 2 and return here.

- [ ] **Step 5: Commit after Task 2 makes this green.** This task and Task 2 share one commit:

```bash
git add convex/integrations/serpapi convex/editorial/searchIntent.ts tests/unit/serpapi
git commit -m "feat(serpapi): search contracts, frozen query catalog, intent validator (MOO-731)"
```

---

### Task 2: The frozen query catalog

**Files:**
- Create: `convex/integrations/serpapi/queryCatalog.ts`, `tests/unit/serpapi/query-catalog.test.ts`

**Interfaces:**
- Consumes: `BEATS` (`convex/config/beats.ts`), `COVERAGE_OUTLETS` / `REQUIRED_COVERAGE_GROUPS` (`convex/config/coverageOutlets.ts`), `OFFICIAL_DOMAINS` (`convex/config/officialDomains.ts`), `QUERY_CATALOG_VERSION` (`convex/config/ruleset.ts`).
- Produces:
  - `type TemplateId` — a union of every frozen ID (13 discovery + 2 coverage + 3 enrichment + 2 supplemental). NOTE: this task originally froze 16 discovery IDs; Google Events moved to enrichment per `docs/decisions/005-google-events-moves-to-enrichment.md`, so the discovery list is 13. The code sample below is the pre-005 historical version — read `convex/integrations/serpapi/queryCatalog.ts` for current truth.
  - `type QueryTemplate = { id: TemplateId; engine: SerpEngine; language: SearchLanguage; timeWindow: TimeWindow; purposes: SearchPurpose[]; requiresTerms: boolean; maxWindowForPurpose: Partial<Record<SearchPurpose, TimeWindow>>; build: (args: { now: number; terms: string[] }) => string }`
  - `getTemplate(id) → QueryTemplate | undefined`
  - `renderQuery(template, { now, terms }) → string`
  - `DISCOVERY_TEMPLATE_IDS: readonly TemplateId[]` — exactly 13, in a stable order (decision 005: Google Events moved to enrichment; see `ENRICHMENT_TEMPLATE_IDS`).
  - `COVERAGE_TEMPLATE_IDS: readonly ["coverage-general-01", "coverage-community-01"]`

- [ ] **Step 1: Write the failing test** — `tests/unit/serpapi/query-catalog.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { COVERAGE_OUTLETS } from "../../../convex/config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../../convex/config/officialDomains";
import {
  COVERAGE_TEMPLATE_IDS, DISCOVERY_TEMPLATE_IDS, getTemplate, renderQuery,
} from "../../../convex/integrations/serpapi/queryCatalog";

const NOW = Date.parse("2026-08-22T12:00:00Z");
const render = (id: string) => renderQuery(getTemplate(id as never)!, { now: NOW, terms: ["Bronzeville apartments"] });

describe("query catalog", () => {
  it("freezes exactly the 16 discovery template ids from the spec", () => {
    expect([...DISCOVERY_TEMPLATE_IDS]).toEqual([
      "trend-milwaukee-01",
      "news-housing-en-01", "news-transport-en-01", "news-culture-en-01",
      "reddit-housing-01", "reddit-transport-01", "reddit-culture-01",
      "search-housing-es-01", "search-transport-es-01", "search-culture-es-01",
      "events-housing-01", "events-transport-01", "events-culture-01",
      "official-housing-01", "official-transport-01", "official-culture-01",
    ]);
  });

  it("uses one engine per family", () => {
    expect(getTemplate("trend-milwaukee-01")!.engine).toBe("google_trends_trending_now");
    expect(getTemplate("news-housing-en-01")!.engine).toBe("google_news");
    expect(getTemplate("reddit-housing-01")!.engine).toBe("google");
    expect(getTemplate("search-housing-es-01")!.engine).toBe("google");
    expect(getTemplate("events-housing-01")!.engine).toBe("google_events");
    expect(getTemplate("official-housing-01")!.engine).toBe("google");
  });

  it("constrains reddit discovery to indexed r/milwaukee comments with a rolling date", () => {
    const q = render("reddit-housing-01");
    expect(q).toContain("site:reddit.com/r/milwaukee/comments/");
    expect(q).toMatch(/after:2026-08-15/);
  });

  it("marks the Spanish templates as Spanish and the English ones as English", () => {
    expect(getTemplate("search-housing-es-01")!.language).toBe("es");
    expect(getTemplate("news-housing-en-01")!.language).toBe("en");
    expect(render("search-housing-es-01")).toContain("vivienda");
  });

  it("puts every approved official domain in the official templates", () => {
    const q = render("official-housing-01");
    for (const domain of OFFICIAL_DOMAINS) expect(q).toContain(`site:${domain}`);
  });

  it("renders both coverage partitions over the whole frozen catalog, 30 days", () => {
    expect([...COVERAGE_TEMPLATE_IDS]).toEqual(["coverage-general-01", "coverage-community-01"]);
    const general = render("coverage-general-01");
    for (const o of COVERAGE_OUTLETS.general) expect(general).toContain(`site:${o.domain}`);
    const community = render("coverage-community-01");
    for (const o of COVERAGE_OUTLETS.community) expect(community).toContain(`site:${o.domain}`);
    expect(getTemplate("coverage-general-01")!.timeWindow).toBe("30d");
    expect(getTemplate("coverage-community-01")!.timeWindow).toBe("30d");
  });

  it("does not leak one partition's domains into the other", () => {
    const general = render("coverage-general-01");
    for (const o of COVERAGE_OUTLETS.community) expect(general).not.toContain(o.domain);
  });

  it("requires entity terms only where the template has a slot", () => {
    expect(getTemplate("news-housing-en-01")!.requiresTerms).toBe(false);
    expect(getTemplate("coverage-general-01")!.requiresTerms).toBe(true);
    expect(getTemplate("corroborate-entity-01")!.requiresTerms).toBe(true);
  });

  it("every discovery template runs in the 7-day window except the live trend feed", () => {
    for (const id of DISCOVERY_TEMPLATE_IDS) {
      const t = getTemplate(id)!;
      expect(t.timeWindow).toBe(id === "trend-milwaukee-01" ? "current" : "7d");
    }
  });
});
```

Run: `npm test -- tests/unit/serpapi/query-catalog`
Expected: FAIL — module not found.

- [ ] **Step 2: Write `convex/integrations/serpapi/queryCatalog.ts`**

```ts
import { BEATS, type Beat } from "../../config/beats";
import { COVERAGE_OUTLETS } from "../../config/coverageOutlets";
import { OFFICIAL_DOMAINS } from "../../config/officialDomains";
import { DISCOVERY_WINDOW_MS } from "../../config/ruleset";
import type { SearchLanguage, SearchPurpose, SerpEngine, TimeWindow } from "./contracts";

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const siteDisjunction = (domains: readonly string[]) => `(${domains.map((d) => `site:${d}`).join(" OR ")})`;
const orTerms = (terms: readonly string[]) => `(${terms.join(" OR ")})`;
const quoted = (terms: readonly string[]) => terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");

export type QueryTemplate = {
  id: string;
  engine: SerpEngine;
  language: SearchLanguage;
  timeWindow: TimeWindow;
  purposes: SearchPurpose[];
  requiresTerms: boolean;
  maxWindowForPurpose: Partial<Record<SearchPurpose, TimeWindow>>;
  build: (args: { now: number; terms: string[] }) => string;
};

const BEAT_TERMS_ES: Record<Beat, string[]> = {
  housing: ["vivienda", "zonificación", "desarrollo", "vecindario", "desalojo"],
  transportation: ["transporte", "autobús", "calle", "bicicleta", "acceso", "construcción"],
  culture: ["arte", "cultura", "festival", "biblioteca", "museo", "restaurante"],
};

const REDDIT_TERMS: Record<Beat, string[]> = {
  housing: ["development", "zoning", "apartment", "demolished", "opening", "closing", '"what happened"'],
  transportation: ["transit", "bus", "traffic", "street", "bike", "access", '"does anyone know"', '"why is"'],
  culture: ["festival", "show", "restaurant", "bar", "venue", '"coming soon"', "shoutout", "rant"],
};

const EVENT_TERMS: Record<Beat, string[]> = {
  housing: ["housing", "neighborhood", "planning", "zoning", "development"],
  transportation: ["transit", "transportation", "street", "access", "public meeting"],
  culture: ["arts", "cultural", "venue", "library", "museum", "neighborhood"],
};

const beats = Object.keys(BEATS) as Beat[];
const discovery: SearchPurpose[] = ["discovery"];

const templates: QueryTemplate[] = [
  {
    id: "trend-milwaukee-01",
    engine: "google_trends_trending_now",
    language: "en",
    timeWindow: "current",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    // ponytail: Trending Now takes a supported geography, not our conceptual
    // location string. The adapter maps this to the Wisconsin geo parameter.
    build: () => "US-WI",
  },
  ...beats.map<QueryTemplate>((beat) => ({
    id: `news-${beat === "transportation" ? "transport" : beat}-en-01`,
    engine: "google_news",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(BEATS[beat].terms)}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `reddit-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: ({ now }) =>
      `site:reddit.com/r/milwaukee/comments/ ${orTerms(REDDIT_TERMS[beat])} after:${isoDate(now - DISCOVERY_WINDOW_MS)}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `search-${beat === "transportation" ? "transport" : beat}-es-01`,
    engine: "google",
    language: "es",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(BEAT_TERMS_ES[beat])}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `events-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google_events",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `Milwaukee ${orTerms(EVENT_TERMS[beat])}`,
  })),
  ...beats.map<QueryTemplate>((beat) => ({
    id: `official-${beat === "transportation" ? "transport" : beat}-01`,
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: discovery,
    requiresTerms: false,
    maxWindowForPurpose: {},
    build: () => `${siteDisjunction(OFFICIAL_DOMAINS)} ${orTerms(BEATS[beat].terms)}`,
  })),
  {
    id: "coverage-general-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["coverage"],
    requiresTerms: true,
    maxWindowForPurpose: { coverage: "30d" },
    build: ({ terms }) => `${siteDisjunction(COVERAGE_OUTLETS.general.map((o) => o.domain))} ${quoted(terms)}`,
  },
  {
    id: "coverage-community-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["coverage"],
    requiresTerms: true,
    maxWindowForPurpose: { coverage: "30d" },
    build: ({ terms }) => `${siteDisjunction(COVERAGE_OUTLETS.community.map((o) => o.domain))} ${quoted(terms)}`,
  },
  {
    id: "corroborate-entity-01",
    engine: "google",
    language: "en",
    timeWindow: "7d",
    purposes: ["corroboration"],
    requiresTerms: true,
    maxWindowForPurpose: { corroboration: "7d" },
    build: ({ terms }) => `Milwaukee ${quoted(terms)}`,
  },
  {
    id: "official-record-entity-01",
    engine: "google",
    language: "en",
    timeWindow: "30d",
    purposes: ["corroboration"],
    requiresTerms: true,
    maxWindowForPurpose: { corroboration: "30d" },
    build: ({ terms }) => `${siteDisjunction(OFFICIAL_DOMAINS)} ${quoted(terms)}`,
  },
];

export const DISCOVERY_TEMPLATE_IDS = [
  "trend-milwaukee-01",
  "news-housing-en-01", "news-transport-en-01", "news-culture-en-01",
  "reddit-housing-01", "reddit-transport-01", "reddit-culture-01",
  "search-housing-es-01", "search-transport-es-01", "search-culture-es-01",
  "events-housing-01", "events-transport-01", "events-culture-01",
  "official-housing-01", "official-transport-01", "official-culture-01",
] as const;

export const COVERAGE_TEMPLATE_IDS = ["coverage-general-01", "coverage-community-01"] as const;

export const SUPPLEMENTAL_TEMPLATE_IDS = ["corroborate-entity-01", "official-record-entity-01"] as const;

// Frozen union of every id a model may ask for — `getTemplate` still takes a plain
// `string` at the boundary since a model-supplied id is untrusted input; the byId
// lookup itself is the narrowing (a hit can only be one of these ids).
export type TemplateId =
  | (typeof DISCOVERY_TEMPLATE_IDS)[number]
  | (typeof COVERAGE_TEMPLATE_IDS)[number]
  | (typeof SUPPLEMENTAL_TEMPLATE_IDS)[number];

const byId = new Map(templates.map((t) => [t.id, t]));
export const getTemplate = (id: string): QueryTemplate | undefined => byId.get(id);
export const renderQuery = (t: QueryTemplate, args: { now: number; terms: string[] }) => t.build(args);
```

- [ ] **Step 3: Run both test files**

Run: `npm test -- tests/unit/serpapi && npm run typecheck && npm run lint`
Expected: all PASS. If the beat-id naming (`transport` vs `transportation`) fights you, keep the spec's template IDs — they are the frozen contract — and adapt the mapping, not the IDs.

- [ ] **Step 4: Commit** (the shared commit from Task 1 Step 5).

---

### Task 3: URL canonicalization, Reddit post IDs, content hash

**Files:**
- Create: `convex/integrations/serpapi/canonical.ts`, `tests/unit/serpapi/canonical.test.ts`

**Interfaces:**
- Produces: `canonicalizeUrl(url) → string`, `extractRedditPostId(url) → string | null`, `contentHash(parts: string[]) → string`, `canonicalKey(engine, canonicalUrl, nativeId?) → string`.

- [ ] **Step 1: Write the failing test** — `tests/unit/serpapi/canonical.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canonicalKey, canonicalizeUrl, contentHash, extractRedditPostId } from "../../../convex/integrations/serpapi/canonical";

describe("canonicalizeUrl", () => {
  it("lowercases the host, drops www and the fragment", () => {
    expect(canonicalizeUrl("https://WWW.JSOnline.com/story/a#top")).toBe("https://jsonline.com/story/a");
  });
  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(canonicalizeUrl("https://x.org/a?utm_source=n&id=7&fbclid=z&gclid=q")).toBe("https://x.org/a?id=7");
  });
  it("sorts remaining query parameters so order cannot create a duplicate", () => {
    expect(canonicalizeUrl("https://x.org/a?b=2&a=1")).toBe(canonicalizeUrl("https://x.org/a?a=1&b=2"));
  });
  it("drops a trailing slash except at the root", () => {
    expect(canonicalizeUrl("https://x.org/a/")).toBe("https://x.org/a");
    expect(canonicalizeUrl("https://x.org/")).toBe("https://x.org/");
  });
  it("returns the input unchanged when it cannot be parsed", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("extractRedditPostId", () => {
  it("reads the post id from an r/milwaukee comments URL", () => {
    expect(extractRedditPostId("https://www.reddit.com/r/milwaukee/comments/1abc23/some_slug/")).toBe("1abc23");
  });
  it("is case-insensitive on the subreddit segment", () => {
    expect(extractRedditPostId("https://reddit.com/r/Milwaukee/comments/1abc23/x")).toBe("1abc23");
  });
  it("rejects another subreddit", () => {
    expect(extractRedditPostId("https://reddit.com/r/wisconsin/comments/1abc23/x")).toBeNull();
  });
  it("rejects a subreddit listing page with no post", () => {
    expect(extractRedditPostId("https://reddit.com/r/milwaukee/")).toBeNull();
  });
  it("rejects a non-reddit URL", () => {
    expect(extractRedditPostId("https://example.com/r/milwaukee/comments/1abc23/x")).toBeNull();
  });
});

describe("contentHash and canonicalKey", () => {
  it("is stable for the same parts and different for changed ones", () => {
    expect(contentHash(["a", "b"])).toBe(contentHash(["a", "b"]));
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["a", "c"]));
  });
  it("prefers the engine-native id when one exists", () => {
    expect(canonicalKey("youtube", "https://youtube.com/watch?v=x", "x")).toBe("youtube:x");
    expect(canonicalKey("google", "https://x.org/a")).toBe("google:https://x.org/a");
  });
});
```

Run: `npm test -- tests/unit/serpapi/canonical` → FAIL.

- [ ] **Step 2: Write `convex/integrations/serpapi/canonical.ts`**

```ts
import type { SerpEngine } from "./contracts";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src",
]);

export function canonicalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const kept = [...parsed.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()));
  kept.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = "";
  for (const [k, v] of kept) parsed.searchParams.append(k, v);
  let out = parsed.toString();
  if (out.endsWith("/") && parsed.pathname !== "/") out = out.slice(0, -1);
  return out;
}

const REDDIT_POST = /^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com\/r\/milwaukee\/comments\/([a-z0-9]+)(?:\/|$)/i;

export function extractRedditPostId(url: string): string | null {
  const match = REDDIT_POST.exec(url);
  return match ? match[1] : null;
}

// ponytail: FNV-1a — we need a stable change-detection fingerprint, not a
// cryptographic digest, and Convex actions should not pull in node:crypto.
export function contentHash(parts: string[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts.join(" ")) {
    hash ^= part.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const canonicalKey = (engine: SerpEngine, canonicalUrl: string, nativeId?: string) =>
  nativeId ? `${engine}:${nativeId}` : `${engine}:${canonicalUrl}`;
```

- [ ] **Step 3: Run and commit**

Run: `npm test -- tests/unit/serpapi/canonical && npm run typecheck`

```bash
git add convex/integrations/serpapi/canonical.ts tests/unit/serpapi/canonical.test.ts
git commit -m "feat(serpapi): URL canonicalization, Reddit post ids, content hash (MOO-731)"
```

---

### Task 4: Atomic budget reservation

**Files:**
- Modify: `convex/searchRuns.ts`
- Create: `tests/integration/search-budget.test.ts`

**Interfaces:**
- Consumes: `SEARCH_BUDGET`, `SearchSpec`, `contentHash`.
- Produces (all `internalMutation`, callable only from actions/workflow):
  - `searchRuns.reserve({ scanId, spec }) → { runId: Id<"searchRuns">; reused: boolean } | { rejected: "budget_exhausted" | "scan_not_active" }`
  - `searchRuns.markRunning({ runId })`, `searchRuns.complete({ runId, resultCount, durationMs, rawStorageId })`, `searchRuns.fail({ runId, errorCode, errorMessage, durationMs })`
  - `idempotencyKeyFor(scanId, spec) → string` exported from `convex/integrations/serpapi/contracts.ts`, format `scanId:purpose:templateId:queryHash`.

- [ ] **Step 1: Write the failing test** — `tests/integration/search-budget.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const spec = (templateId: string) => ({
  templateId, engine: "google" as const, purpose: "discovery" as const,
  query: `q-${templateId}`, location: "Milwaukee, Wisconsin, United States" as const,
  language: "en" as const, timeWindow: "7d" as const,
});

async function ownedScan(t: ReturnType<typeof setup>, reserved = 0) {
  const alice = asUser(t, "alice");
  const ownerId = await alice.mutation(api.users.ensureCurrent, {});
  const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId, { searchesReserved: reserved })));
  return { scanId, ownerId };
}

describe("searchRuns.reserve", () => {
  it("reserves once and increments the scan counter", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    const r = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    expect(r).toMatchObject({ reused: false });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(1);
  });

  it("is idempotent: the same spec returns the same run without double-counting", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    const first = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    const second = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("news-housing-en-01") });
    expect(second).toMatchObject({ runId: (first as { runId: string }).runId, reused: true });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(1);
  });

  it("allows the 120th reservation and refuses the 121st", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t, 119);
    const ok = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("t-120") });
    expect(ok).toMatchObject({ reused: false });
    const over = await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("t-121") });
    expect(over).toEqual({ rejected: "budget_exhausted" });
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("never exceeds the cap under concurrent reservations", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t, 115);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.mutation(internal.searchRuns.reserve, { scanId, spec: spec(`race-${i}`) })),
    );
    const granted = results.filter((r) => "runId" in r).length;
    expect(granted).toBe(5);
    const scan = await t.run((ctx) => ctx.db.get(scanId));
    expect(scan?.searchesReserved).toBe(120);
  });

  it("refuses to reserve on a cancelled scan", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    await t.run((ctx) => ctx.db.patch(scanId, { status: "canceled" }));
    expect(await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("x") })).toEqual({ rejected: "scan_not_active" });
  });

  it("refuses to reserve once cancellation has been requested", async () => {
    const t = setup();
    const { scanId } = await ownedScan(t);
    await t.run((ctx) => ctx.db.patch(scanId, { cancelRequestedAt: 1 }));
    expect(await t.mutation(internal.searchRuns.reserve, { scanId, spec: spec("x") })).toEqual({ rejected: "scan_not_active" });
  });
});
```

Run: `npm test -- tests/integration/search-budget` → FAIL.

- [ ] **Step 2: Add `idempotencyKeyFor` to `convex/integrations/serpapi/contracts.ts`**

```ts
import { contentHash } from "./canonical";
export const idempotencyKeyFor = (scanId: string, spec: SearchSpec) =>
  `${scanId}:${spec.purpose}:${spec.templateId}:${contentHash([spec.query, spec.language, spec.timeWindow])}`;
```

- [ ] **Step 3: Add the reserve/complete/fail mutations to `convex/searchRuns.ts`**

```ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { SEARCH_BUDGET } from "./config/searchBudget";
import { QUERY_CATALOG_VERSION } from "./config/ruleset";
import { idempotencyKeyFor } from "./integrations/serpapi/contracts";
import * as V from "./lib/validators";

const vSearchSpec = v.object({
  templateId: v.string(),
  engine: V.vEngine,
  purpose: V.vPurpose,
  query: v.string(),
  location: v.literal("Milwaukee, Wisconsin, United States"),
  language: v.union(v.literal("en"), v.literal("es")),
  timeWindow: v.union(v.literal("7d"), v.literal("30d"), v.literal("current")),
  candidateId: v.optional(v.id("candidates")),
});

export const reserve = internalMutation({
  args: { scanId: v.id("scans"), spec: vSearchSpec },
  returns: v.union(
    v.object({ runId: v.id("searchRuns"), reused: v.boolean() }),
    v.object({ rejected: v.union(v.literal("budget_exhausted"), v.literal("scan_not_active")) }),
  ),
  handler: async (ctx, { scanId, spec }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return { rejected: "scan_not_active" as const };
    if (scan.cancelRequestedAt !== undefined) return { rejected: "scan_not_active" as const };
    if (scan.status !== "queued" && scan.status !== "running") return { rejected: "scan_not_active" as const };

    const idempotencyKey = idempotencyKeyFor(scanId, spec);
    const existing = await ctx.db
      .query("searchRuns")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { runId: existing._id, reused: true };

    // Convex mutations are serializable transactions, so this read-then-write
    // is atomic against concurrent reservations — that is what makes the cap hold.
    if (scan.searchesReserved >= Math.min(scan.searchBudgetLimit, SEARCH_BUDGET.hardCap)) {
      return { rejected: "budget_exhausted" as const };
    }
    await ctx.db.patch(scanId, { searchesReserved: scan.searchesReserved + 1 });

    const runId = await ctx.db.insert("searchRuns", {
      scanId, ownerId: scan.ownerId, idempotencyKey,
      templateId: spec.templateId, queryCatalogVersion: QUERY_CATALOG_VERSION,
      purpose: spec.purpose, engine: spec.engine, query: spec.query,
      parameters: {}, language: spec.language,
      status: "reserved", attemptCount: 0, resultCount: 0, durationMs: 0,
      reservedAt: Date.now(),
    });
    return { runId, reused: false };
  },
});

export const markRunning = internalMutation({
  args: { runId: v.id("searchRuns"), parameters: v.record(v.string(), v.string()) },
  returns: v.null(),
  handler: async (ctx, { runId, parameters }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    // The API key is appended inside the client and is never part of `parameters`.
    await ctx.db.patch(runId, { status: "running", attemptCount: run.attemptCount + 1, parameters });
    return null;
  },
});

export const complete = internalMutation({
  args: { runId: v.id("searchRuns"), resultCount: v.number(), durationMs: v.number(), rawStorageId: v.optional(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { runId, resultCount, durationMs, rawStorageId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    await ctx.db.patch(runId, { status: "succeeded", resultCount, durationMs, rawStorageId, completedAt: Date.now() });
    const scan = await ctx.db.get(run.scanId);
    if (scan) await ctx.db.patch(run.scanId, { searchesSucceeded: scan.searchesSucceeded + 1 });
    return null;
  },
});

export const fail = internalMutation({
  args: { runId: v.id("searchRuns"), errorCode: v.string(), errorMessage: v.string(), durationMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { runId, errorCode, errorMessage, durationMs }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    await ctx.db.patch(runId, { status: "failed", errorCode, errorMessage, durationMs, completedAt: Date.now() });
    const scan = await ctx.db.get(run.scanId);
    if (scan) await ctx.db.patch(run.scanId, { searchesFailed: scan.searchesFailed + 1 });
    return null;
  },
});
```

- [ ] **Step 4: Run, deploy, commit**

Run: `npx convex codegen && npm test -- tests/integration/search-budget && npm run typecheck && npm run lint && npx convex dev --once`
Expected: 6/6 pass; the concurrency case grants exactly 5.

```bash
git add convex/searchRuns.ts convex/integrations/serpapi/contracts.ts convex/_generated tests/integration/search-budget.test.ts
git commit -m "feat(serpapi): atomic budget reservation with idempotent search runs (MOO-731)"
```

---

### Task 5: SerpApi HTTP client with timeout and bounded retry

**Files:**
- Create: `convex/integrations/serpapi/client.ts`, `tests/unit/serpapi/client.test.ts`

**Interfaces:**
- Produces: `buildParams(spec) → Record<string, string>` (no API key) and
  `callSerpApi(spec, { apiKey, fetchImpl, sleep }) → { ok: true; json: unknown; durationMs: number; attempts: number; params: Record<string,string> } | { ok: false; errorCode: string; errorMessage: string; durationMs: number; attempts: number }`.
- `fetchImpl` and `sleep` are injected so tests never touch the network or the clock.

**Engine parameter mapping** — verify each against `https://serpapi.com/<engine>-api` before writing, and record what you verified in the report:

| `spec.engine` | SerpApi `engine` | Parameters built from the spec |
| --- | --- | --- |
| `google` | `google` | `q`, `location`, `gl=us`, `hl`, and `tbs=qdr:w` for `7d` / `qdr:m` for `30d`. **No `num`** — serpapi.com/search-api documents `start` for pagination but no `num`; the spec's "up to 10 results without pagination" is met by the default page size plus never sending `start`. |
| `google_news` | `google_news` | `q`, `gl=us`, `hl` — **and nothing else**. serpapi.com/google-news-api documents no `tbs` and no `location`. The time window is a `when:` operator **inside the query text**, rendered by the template (`7d` → `when:7d`, `30d` → `when:1m`) so that `searchRuns.query` equals what actually ran. `buildParams` must never mutate `spec.query`. |
| `google_trends_trending_now` | `google_trends_trending_now` | `geo` from the rendered query (`US-WI`), `hl=en` — **not** `location` |
| `google_events` | `google_events` | `q`, `location`, `gl=us`, `hl` |
| `youtube` | `youtube` | `search_query`, `gl=us`, `hl` |
| `google_maps` | `google_maps` | `q`, `location`, `type=search`, `hl` |

- [ ] **Step 1: Write the failing test** — `tests/unit/serpapi/client.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { buildParams, callSerpApi } from "../../../convex/integrations/serpapi/client";
import type { SearchSpec } from "../../../convex/integrations/serpapi/contracts";

const spec = (over: Partial<SearchSpec> = {}): SearchSpec => ({
  templateId: "news-housing-en-01", engine: "google_news", purpose: "discovery",
  query: "Milwaukee housing", location: "Milwaukee, Wisconsin, United States",
  language: "en", timeWindow: "7d", ...over,
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const status = (code: number) => new Response("{}", { status: code });
const opts = (fetchImpl: typeof fetch) => ({ apiKey: "secret", fetchImpl, sleep: async () => {} });

describe("buildParams", () => {
  it("never includes the API key", () => {
    expect(JSON.stringify(buildParams(spec()))).not.toContain("secret");
    expect(Object.keys(buildParams(spec()))).not.toContain("api_key");
  });
  it("maps Trending Now to geo, not location", () => {
    const p = buildParams(spec({ engine: "google_trends_trending_now", query: "US-WI", timeWindow: "current" }));
    expect(p.geo).toBe("US-WI");
    expect(p.location).toBeUndefined();
  });
  it("maps youtube to search_query", () => {
    expect(buildParams(spec({ engine: "youtube", query: "milwaukee common council" })).search_query).toBe("milwaukee common council");
  });
  it("carries the Spanish language through", () => {
    expect(buildParams(spec({ language: "es" })).hl).toBe("es");
  });
});

describe("callSerpApi", () => {
  it("returns the parsed body on first success", async () => {
    const fetchImpl = vi.fn(async () => ok({ news_results: [] })) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 twice then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? status(429) : ok({ news_results: [] }))) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attempts).toBe(3);
  });

  it("gives up after two retries and reports the code", async () => {
    const fetchImpl = vi.fn(async () => status(503)) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attempts).toBe(3);
      expect(r.errorCode).toBe("http_503");
    }
  });

  it("never retries a 400", async () => {
    const fetchImpl = vi.fn(async () => status(400)) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a 401", async () => {
    const fetchImpl = vi.fn(async () => status(401)) as unknown as typeof fetch;
    await callSerpApi(spec(), opts(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a SerpApi error field as a failure without retrying", async () => {
    const fetchImpl = vi.fn(async () => ok({ error: "Google hasn't returned any results" })) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("serpapi_error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the API key out of the failure message", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("connect failed https://serpapi.com/search.json?api_key=secret"); }) as unknown as typeof fetch;
    const r = await callSerpApi(spec(), opts(fetchImpl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).not.toContain("secret");
  });
});
```

Run: `npm test -- tests/unit/serpapi/client` → FAIL.

- [ ] **Step 2: Write `convex/integrations/serpapi/client.ts`**

```ts
import type { SearchSpec } from "./contracts";

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;          // one call plus two retries
const BACKOFF_MS = [2_000, 8_000];

const googleTbs = (w: SearchSpec["timeWindow"]) => (w === "7d" ? "qdr:w" : w === "30d" ? "qdr:m" : undefined);

export function buildParams(spec: SearchSpec): Record<string, string> {
  const base: Record<string, string> = { engine: spec.engine, hl: spec.language };
  switch (spec.engine) {
    case "google_trends_trending_now":
      return { ...base, geo: spec.query, hl: "en" };
    case "youtube":
      return { ...base, search_query: spec.query, gl: "us" };
    case "google_maps":
      return { ...base, q: spec.query, location: spec.location, type: "search" };
    case "google_events":
      return { ...base, q: spec.query, location: spec.location, gl: "us" };
    case "google_news": {
      const tbs = googleTbs(spec.timeWindow);
      return { ...base, q: spec.query, gl: "us", ...(tbs ? { tbs } : {}) };
    }
    case "google":
    default: {
      const tbs = googleTbs(spec.timeWindow);
      return { ...base, q: spec.query, location: spec.location, gl: "us", num: "10", ...(tbs ? { tbs } : {}) };
    }
  }
}

export type SerpApiCallResult =
  | { ok: true; json: unknown; durationMs: number; attempts: number; params: Record<string, string> }
  | { ok: false; errorCode: string; errorMessage: string; durationMs: number; attempts: number; params: Record<string, string> };

type CallOptions = { apiKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const redact = (message: string, apiKey: string) => message.split(apiKey).join("[redacted]").slice(0, 400);
const retriable = (code: number) => code === 429 || code >= 500;

export async function callSerpApi(spec: SearchSpec, options: CallOptions): Promise<SerpApiCallResult> {
  const { apiKey, fetchImpl = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = options;
  const params = buildParams(spec);
  const startedAt = Date.now();
  let lastCode = "unknown";
  let lastMessage = "no attempt completed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: apiKey })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        lastCode = `http_${response.status}`;
        lastMessage = `SerpApi returned ${response.status}`;
        if (!retriable(response.status)) break;
      } else {
        const json = (await response.json()) as { error?: string };
        if (json && typeof json === "object" && typeof json.error === "string") {
          return { ok: false, errorCode: "serpapi_error", errorMessage: redact(json.error, apiKey), durationMs: Date.now() - startedAt, attempts: attempt, params };
        }
        return { ok: true, json, durationMs: Date.now() - startedAt, attempts: attempt, params };
      }
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      lastCode = aborted ? "timeout" : "network_error";
      lastMessage = redact(error instanceof Error ? error.message : String(error), apiKey);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 8_000;
      await sleep(base + Math.floor(base * 0.25 * (attempt % 2 === 0 ? 1 : -1)));
    }
  }
  return { ok: false, errorCode: lastCode, errorMessage: lastMessage, durationMs: Date.now() - startedAt, attempts: MAX_ATTEMPTS, params };
}
```

Note: the jitter above is deterministic on purpose — `Math.random()` in Convex code makes runs non-reproducible. If SerpApi documents a `Retry-After` header, honour it instead of the fixed backoff and say so in the report.

- [ ] **Step 3: Run and commit**

Run: `npm test -- tests/unit/serpapi/client && npm run typecheck`

```bash
git add convex/integrations/serpapi/client.ts tests/unit/serpapi/client.test.ts
git commit -m "feat(serpapi): HTTP client with 60s timeout, bounded retry, key redaction (MOO-731)"
```

---

### Task 6: Engine normalizers and captured fixtures

**Files:**
- Create: `convex/integrations/serpapi/normalize.ts`, `scripts/capture-serpapi-fixture.ts`, `tests/fixtures/serpapi/*.json`, `tests/unit/serpapi/normalize.test.ts`

**Interfaces:**
- Consumes: `SourceResultInput`, `canonicalizeUrl`, `extractRedditPostId`, `canonicalKey`.
- Produces: `normalizeResponse(spec, json) → { results: SourceResultInput[]; skipped: number }`.

**Rules that are not negotiable:**
- Unknown or malformed entries are **counted in `skipped`, never coerced** into a result.
- `sourceFamily` by engine: `google_news` → `news`; `google_events` → `event`; `youtube` → `video`; `google_maps` → `map`; `google_trends_trending_now` → `trend`; `google` → `official` when the host is an approved official domain, `community_discussion` when `extractRedditPostId` returns an id, otherwise `public_web`.
- A `google` result whose URL contains `/r/` but is **not** an `r/milwaukee` comment permalink is skipped, not stored.
- `originalLanguage` comes from `spec.language`; translation happens later in `analyzeResults`.

- [ ] **Step 1: Capture the fixtures.** Write `scripts/capture-serpapi-fixture.ts` that takes a template ID, calls SerpApi once with `SERPAPI_API_KEY`, strips `search_metadata.*` ids and any `api_key` occurrence, and writes `tests/fixtures/serpapi/<engine>.json`. Run it once per engine with the key exported — **six live calls total; announce the cost before running.** If a key is not available yet, hand-write minimal fixtures that match the documented response shape for each engine and mark them `"_handwritten": true`, then replace them during item 10's live scan.

- [ ] **Step 2: Write the failing test** — `tests/unit/serpapi/normalize.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeResponse } from "../../../convex/integrations/serpapi/normalize";
import type { SearchSpec } from "../../../convex/integrations/serpapi/contracts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../../fixtures/serpapi/${name}.json`), "utf8"));

const spec = (over: Partial<SearchSpec>): SearchSpec => ({
  templateId: "t", engine: "google", purpose: "discovery", query: "q",
  location: "Milwaukee, Wisconsin, United States", language: "en", timeWindow: "7d", ...over,
});

describe("normalizeResponse", () => {
  it("maps google_news results to the news family with publisher and date", () => {
    const { results } = normalizeResponse(spec({ engine: "google_news" }), fixture("google_news"));
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.sourceFamily).toBe("news");
      expect(r.canonicalUrl).toMatch(/^https?:\/\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("maps youtube results to video and keeps the channel", () => {
    const { results } = normalizeResponse(spec({ engine: "youtube" }), fixture("youtube"));
    expect(results.every((r) => r.sourceFamily === "video")).toBe(true);
    expect(results.some((r) => r.channel !== undefined)).toBe(true);
  });

  it("maps google_maps results to map and keeps the place name", () => {
    const { results } = normalizeResponse(spec({ engine: "google_maps" }), fixture("google_maps"));
    expect(results.every((r) => r.sourceFamily === "map")).toBe(true);
    expect(results.some((r) => r.placeName !== undefined)).toBe(true);
  });

  it("maps google_events results to event", () => {
    const { results } = normalizeResponse(spec({ engine: "google_events" }), fixture("google_events"));
    expect(results.every((r) => r.sourceFamily === "event")).toBe(true);
  });

  it("maps trending searches to the trend family", () => {
    const { results } = normalizeResponse(
      spec({ engine: "google_trends_trending_now", timeWindow: "current" }),
      fixture("google_trends_trending_now"),
    );
    expect(results.every((r) => r.sourceFamily === "trend")).toBe(true);
  });

  it("classifies a google result on an official domain as official", () => {
    const json = { organic_results: [{ position: 1, title: "Common Council agenda", link: "https://city.milwaukee.gov/agenda/1", snippet: "..." }] };
    const { results } = normalizeResponse(spec({}), json);
    expect(results[0].sourceFamily).toBe("official");
  });

  it("classifies an r/milwaukee comment permalink as community discussion and keeps the post id", () => {
    const json = { organic_results: [{ position: 1, title: "Any word on the Bronzeville build?", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/", snippet: "..." }] };
    const { results } = normalizeResponse(spec({}), json);
    expect(results[0].sourceFamily).toBe("community_discussion");
    expect(results[0].nativeId).toBe("1abc23");
  });

  it("skips a reddit result that is not an r/milwaukee comment permalink", () => {
    const json = { organic_results: [{ position: 1, title: "x", link: "https://www.reddit.com/r/wisconsin/comments/9zz/x/", snippet: "..." }] };
    const { results, skipped } = normalizeResponse(spec({}), json);
    expect(results).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("counts malformed entries instead of coercing them", () => {
    const json = { organic_results: [{ position: 1 }, { link: "https://x.org/a", title: "ok", snippet: "s" }] };
    const { results, skipped } = normalizeResponse(spec({}), json);
    expect(results).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("returns an empty result set for an empty response without throwing", () => {
    expect(normalizeResponse(spec({}), {})).toEqual({ results: [], skipped: 0 });
  });

  it("carries the spec language onto every result", () => {
    const json = { organic_results: [{ position: 1, title: "Vivienda", link: "https://x.org/a", snippet: "s" }] };
    const { results } = normalizeResponse(spec({ language: "es" }), json);
    expect(results[0].originalLanguage).toBe("es");
  });
});
```

Run: `npm test -- tests/unit/serpapi/normalize` → FAIL.

- [ ] **Step 3: Write `convex/integrations/serpapi/normalize.ts`.** One small exported function per engine plus a dispatcher; each returns `SourceResultInput | null` and `null` means "skipped". Parse dates with `Date.parse` and drop `publishedAt` when it is `NaN` — never invent a timestamp. Use `isOfficialDomain` from `convex/config/officialDomains.ts` for the official check and `extractRedditPostId` for the Reddit check. Keep the file under 250 lines; if an engine's parsing grows past ~40 lines, give it its own file under `normalize/`.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/unit/serpapi && npm run typecheck && npm run lint`

```bash
git add convex/integrations/serpapi/normalize.ts scripts/capture-serpapi-fixture.ts tests/fixtures/serpapi tests/unit/serpapi/normalize.test.ts
git commit -m "feat(serpapi): engine normalizers with captured fixtures (MOO-731)"
```

---

### Task 7: `executeSearch` action and result ingestion

**Files:**
- Create: `convex/sourceResults.ts`, `convex/integrations/serpapi/executeSearch.ts`, `tests/integration/search-storage-slice.test.ts`

**Interfaces:**
- Produces:
  - `sourceResults.ingest` (`internalMutation`) `{ scanId, searchRunId, results: SourceResultInput[] } → { inserted: number; duplicates: number }` — dedupes on the `by_scan_canonical` index using `canonicalKey`.
  - `sourceResults.listForScan` (`query`, owner-scoped, paginated) returning safe fields only: no `ownerId`, no `contentHash` internals beyond what the evidence view needs.
  - `serpapi.executeSearch` (`internalAction`) `{ scanId, spec } → { runId, status: "succeeded" | "failed" | "skipped", resultCount }`. Order inside: reserve → (if reused and already succeeded, stop) → `markRunning` with the safe params → `callSerpApi` → archive raw JSON to File Storage → `normalizeResponse` → `ingest` → `complete` or `fail`.

- [ ] **Step 1: Write the failing integration test** — `tests/integration/search-storage-slice.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const SPEC = {
  templateId: "reddit-housing-01", engine: "google" as const, purpose: "discovery" as const,
  query: "site:reddit.com/r/milwaukee/comments/ (development)",
  location: "Milwaukee, Wisconsin, United States" as const, language: "en" as const, timeWindow: "7d" as const,
};

const BODY = {
  organic_results: [
    { position: 1, title: "Any word on the Bronzeville build?", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/", snippet: "Saw fencing go up" },
    { position: 2, title: "Duplicate", link: "https://www.reddit.com/r/milwaukee/comments/1abc23/any_word/?utm_source=x", snippet: "same post" },
  ],
};

async function scanFor(t: ReturnType<typeof setup>) {
  const alice = asUser(t, "alice");
  const ownerId = await alice.mutation(api.users.ensureCurrent, {});
  const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId)));
  return { scanId, alice };
}

describe("executeSearch slice", () => {
  it("reserves once, archives raw JSON, and ingests deduplicated results", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("succeeded");
    expect(r.resultCount).toBe(1); // the utm duplicate collapses onto the same post id

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].rawStorageId).toBeDefined();
    expect(JSON.stringify(runs[0].parameters)).not.toContain("test-key");
    expect(results).toHaveLength(1);
    expect(results[0].redditPostId).toBe("1abc23");
    expect(scan?.searchesReserved).toBe(1);
    expect(scan?.searchesSucceeded).toBe(1);
  });

  it("re-running the same spec does not double-reserve or duplicate results", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));

    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(scan?.searchesReserved).toBe(1);
  });

  it("records a failure without ingesting anything", async () => {
    const t = setup();
    const { scanId } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("failed");

    const { runs, results, scan } = await t.run(async (ctx) => ({
      runs: await ctx.db.query("searchRuns").collect(),
      results: await ctx.db.query("sourceResults").collect(),
      scan: await ctx.db.get(scanId),
    }));
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorCode).toBe("http_503");
    expect(results).toHaveLength(0);
    expect(scan?.searchesFailed).toBe(1);
  });

  it("skips without calling SerpApi when the budget is exhausted", async () => {
    const t = setup();
    const alice = asUser(t, "alice");
    const ownerId = await alice.mutation(api.users.ensureCurrent, {});
    const scanId = await t.run((ctx) => ctx.db.insert("scans", scanDoc(ownerId, { searchesReserved: 120 })));
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");

    const r = await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never exposes rawStorageId through the owner-scoped query", async () => {
    const t = setup();
    const { scanId, alice } = await scanFor(t);
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));
    await t.action(internal.integrations.serpapi.executeSearch.executeSearch, { scanId, spec: SPEC });

    const page = await alice.query(api.sourceResults.listForScan, { scanId, paginationOpts: { numItems: 25, cursor: null } });
    expect(JSON.stringify(page)).not.toMatch(/rawStorageId|api_key/);
    expect(page.page[0].canonicalUrl).toContain("reddit.com/r/milwaukee/comments/1abc23");
  });
});
```

Run: `npm test -- tests/integration/search-storage-slice` → FAIL.

- [ ] **Step 2: Write `convex/sourceResults.ts`** — the `ingest` internal mutation (loop the inputs, look up `by_scan_canonical`, skip an existing `canonicalKey`, insert otherwise with `discoveredAt: Date.now()`, `isAccessible: true`, `contentHash`) and the owner-scoped paginated `listForScan` query with an explicit `returns` validator that omits `ownerId` and `searchRunId`.

**Interface gap you must handle here.** The `sourceResults` table requires `sourceType` (`primary | secondary | discussion | unknown`), but `SourceResultInput` deliberately does not carry it — source type is an AI *suggestion* made later by `analyzeResults`, and normalization must stay deterministic. So `ingest` writes a deterministic starting value and never guesses: `discussion` when `sourceFamily === "community_discussion"`, `primary` when `sourceFamily === "official"`, otherwise `unknown`. Never write `secondary` at ingest time — that is a classification, not an observation. Add a test asserting exactly this mapping, including that a `news` result ingests as `unknown` rather than `secondary`.

- [ ] **Step 3: Write `convex/integrations/serpapi/executeSearch.ts`** as an `internalAction` following the order in the Interfaces block. Read the key with `process.env.SERPAPI_API_KEY` and throw a clear error if it is missing. Archive with `await ctx.storage.store(new Blob([JSON.stringify(json)], { type: "application/json" }))`.

- [ ] **Step 4: Run, deploy, commit**

Run: `npx convex codegen && npm test && npm run typecheck && npm run lint && npx convex dev --once`

```bash
git add convex/sourceResults.ts convex/integrations/serpapi/executeSearch.ts convex/_generated tests/integration/search-storage-slice.test.ts
git commit -m "feat(serpapi): executeSearch action with raw archive and deduplicated ingestion (MOO-731)"
```

---

### Task 8: Cascade the e2e reset (carried-in finding) and add the live smoke test

**Files:**
- Modify: `convex/testing.ts`
- Create: `tests/live/serpapi-smoke.test.ts`
- Modify: `package.json` (`test:live` already exists — confirm it points at `tests/live`)

- [ ] **Step 1: Cascade the reset.** `deleteScansForClerkUser` currently deletes `scans` rows only. Now that `searchRuns` and `sourceResults` exist, orphans would silently break `first-run.spec.ts`. Extend it to delete, for each scan: `searchRuns` (`by_scan_purpose`), `sourceResults` (`by_scan`), and their stored blobs via `ctx.storage.delete(rawStorageId)` when present. Return the scan count as before.

- [ ] **Step 2: Add an integration test** proving the cascade — insert a scan with one run, one result and one stored blob; call the mutation; assert all three are gone.

- [ ] **Step 3: Write the opt-in live smoke test** — `tests/live/serpapi-smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { callSerpApi } from "../../convex/integrations/serpapi/client";
import { getTemplate, renderQuery } from "../../convex/integrations/serpapi/queryCatalog";
import { normalizeResponse } from "../../convex/integrations/serpapi/normalize";
import { MILWAUKEE_LOCATION } from "../../convex/integrations/serpapi/contracts";

const live = process.env.LIVE_TESTS === "1" && !!process.env.SERPAPI_API_KEY;

describe.skipIf(!live)("single bounded SerpApi search", () => {
  it("returns normalizable Milwaukee results for one discovery template", async () => {
    const template = getTemplate("news-housing-en-01")!;
    const spec = {
      templateId: template.id, engine: template.engine, purpose: "discovery" as const,
      query: renderQuery(template, { now: Date.now(), terms: [] }),
      location: MILWAUKEE_LOCATION, language: template.language, timeWindow: template.timeWindow,
    };
    const result = await callSerpApi(spec, { apiKey: process.env.SERPAPI_API_KEY! });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { results, skipped } = normalizeResponse(spec, result.json);
    console.log(`live smoke: ${results.length} normalized, ${skipped} skipped`);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].canonicalUrl).toMatch(/^https?:\/\//);
  }, 90_000);
});
```

- [ ] **Step 3b: Prove the 120 cap under REAL concurrency (Ruling 7).** The 20-way test in Task 4 runs under `convex-test`, which takes a mutex per top-level transaction (`node_modules/convex-test/dist/index.js`) — the mutations never actually interleave, so that test catches ordering bugs but proves nothing about production. Checklist item 5 says "including under concurrency" and demo acceptance gate 5 says "Search count cannot exceed 120 under concurrency"; neither is satisfied until this step passes. Write `tests/live/reserve-concurrency.test.ts`, gated on `LIVE_TESTS === "1"`:

```ts
import { ConvexHttpClient } from "convex/browser";
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";

const live = process.env.LIVE_TESTS === "1" && !!process.env.NEXT_PUBLIC_CONVEX_URL;

describe.skipIf(!live)("reserve holds the cap under real concurrency", () => {
  it("grants exactly the remaining slots when 20 callers race", async () => {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    // Seed a scan at 115/120 through an internal test-only mutation, then race.
    const scanId = await client.mutation(internal.testing.seedScanAtReservation, { reserved: 115 });
    const specs = Array.from({ length: 20 }, (_, i) => ({
      templateId: "corroborate-entity-01", engine: "google" as const, purpose: "corroboration" as const,
      query: `race ${i}`, location: "Milwaukee, Wisconsin, United States" as const,
      language: "en" as const, timeWindow: "7d" as const,
    }));
    const results = await Promise.all(specs.map((spec) => client.mutation(internal.searchRuns.reserve, { scanId, spec })));
    expect(results.filter((r) => "runId" in r)).toHaveLength(5);
    const scan = await client.query(internal.testing.readScanCounters, { scanId });
    expect(scan.searchesReserved).toBe(120);
    await client.mutation(internal.testing.deleteScanById, { scanId });
  }, 120_000);
});
```

This makes **zero SerpApi calls** — it only exercises Convex mutations. Add the three tiny internal test-only helpers it needs to `convex/testing.ts` (`seedScanAtReservation`, `readScanCounters`, `deleteScanById`), all `internalMutation`/`internalQuery` so no browser can reach them. Run it against the dev deployment and paste the output. If it grants anything other than exactly 5, that is a **Critical** finding — stop and report it rather than adjusting the assertion.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck && npx convex dev --once`
Then, **announcing the cost first — this is exactly one paid SerpApi call**:
`SERPAPI_API_KEY=... LIVE_TESTS=1 npm run test:live`
Paste both outputs in the report. If no key is available, report the smoke test as ⚠️ not run and say so plainly.

- [ ] **Step 5: Commit and push**

```bash
git add convex/testing.ts tests/live tests/integration
git commit -m "feat(serpapi): cascade e2e reset, add bounded live smoke test (MOO-731)"
git push
```
Then confirm CI is green and record the run URL.

---

# Part B — Item 6: Source-bound AI contracts (MOO-732)

### Task 9: Provider boundary and model-run provenance

**Files:**
- Create: `convex/ai/provider.ts`, `convex/modelRuns.ts`, `tests/unit/ai/provider.test.ts`

**Interfaces:**
- Produces:

```ts
export type AiOperation = "analyzeResults" | "clusterSignals" | "classifyEvidence" | "planFollowUp" | "generateBrief";

export type GenerateStructuredArgs<T> = {
  operation: AiOperation;
  schema: z.ZodType<T>;
  schemaVersion: string;
  promptVersion: string;
  system: string;
  prompt: string;
  inputSnapshotHash: string;
  /** Injected in tests; defaults to the AI SDK generateObject. */
  generate?: GenerateFn;
};

export type GenerateOutcome<T> =
  | { ok: true; value: T; provider: string; modelId: string; attempts: number; usedFallback: boolean; usage: { inputTokens?: number; outputTokens?: number }; durationMs: number }
  | { ok: false; failure: "invalid_output" | "provider_error"; validationErrors: string[]; provider: string; modelId: string; attempts: number; usedFallback: boolean; durationMs: number };
```

- `generateStructured` is pure with respect to Convex — it takes an injected `generate` function so unit tests never call a provider. Persistence lives in `convex/modelRuns.ts`: `create` / `complete` / `invalidate` internal mutations, plus an owner-scoped read that never returns the prompt text.

**Routing rules the tests must pin:**
1. Primary model = `AI_PRIMARY_MODEL` via `@ai-sdk/anthropic`. Fallback = `AI_FALLBACK_MODEL` via `@ai-sdk/openai`, used only when `AI_FALLBACK_ENABLED === "true"`.
2. A schema-invalid response retries **once** on the primary. A second invalid response goes to the fallback if enabled, otherwise fails.
3. Network/429/5xx errors retry up to twice on the same provider and do **not** consume the schema-invalid retry.
4. A fallback attempt creates a **separate** `modelRuns` row linked by `fallbackFromRunId` with a `fallbackReason`.
5. Outputs from two models are never merged.

- [ ] **Step 1: Write the failing test** — `tests/unit/ai/provider.test.ts` with a fake `generate` that returns queued responses: two invalid then valid; always invalid with fallback disabled; a `429` then success; and a check that `usage` and `durationMs` are carried through. Assert the exact attempt counts and `usedFallback` for each.

- [ ] **Step 2: Write `convex/ai/provider.ts`.** Wrap `generateObject` from `ai`:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateObject, NoObjectGeneratedError } from "ai";
```

Model instances come from `process.env` at call time, never from a hard-coded string. Timeout 120s via `AbortSignal.timeout(120_000)`. Read usage as `result.usage.inputTokens` / `result.usage.outputTokens` (both may be `undefined` — store them as optional).

- [ ] **Step 3: Write `convex/modelRuns.ts`** with the internal create/complete/invalidate mutations writing every field the schema names (`promptVersion`, `schemaVersion`, `inputSnapshotHash`, `attempt`, `fallbackFromRunId`, `fallbackReason`, `validationErrors`, token counts, `estimatedCostUsd` when derivable).

- [ ] **Step 4: Run and commit**

Run: `npx convex codegen && npm test -- tests/unit/ai/provider && npm run typecheck && npm run lint`

```bash
git add convex/ai/provider.ts convex/modelRuns.ts convex/_generated tests/unit/ai
git commit -m "feat(ai): provider boundary with logged fallback and model-run provenance (MOO-732)"
```

---

### Task 10: Zod contracts, versioned prompts, and the output validator

**Files:**
- Create: `convex/ai/contracts.ts`, `convex/ai/prompts.ts`, `convex/ai/validateOutput.ts`, `tests/unit/ai/validate-output.test.ts`, `tests/unit/ai/contracts.test.ts`

**Interfaces:**
- Produces one input schema and one output schema per operation, each with a `SCHEMA_VERSION` constant, plus:
  - `validateAgainstSources(output, { knownSourceIds, excerptsBySourceId }) → { ok: true } | { ok: false; errors: string[] }`

**Validator rules — each gets its own test:**
1. Every `sourceResultIds` entry must be in `knownSourceIds`; one unknown ID invalidates the **entire** output.
2. Any field declared as an exact quotation must equal a stored excerpt for one of its cited sources, character for character.
3. Enum fields must be one of the schema's literals; strings have length ceilings (claims ≤ 400 chars, reasons ≤ 300, interview questions ≤ 200).
4. `confirmedFacts` blocks may only cite sources the deterministic layer already classified as confirming — the model cannot promote.
5. A translation field must not be present without its original-language counterpart.

Zod 4 note: avoid `.optional()` inside objects the model must fill; prefer `.nullable()` — some providers reject optional fields in structured output. Where a value is genuinely absent, use `z.string().nullable()` and normalize `null` to `undefined` after validation.

- [ ] **Step 1: Write the failing tests** covering all five rules above, using a small fake output object per operation.
- [ ] **Step 2: Write the three modules.** `prompts.ts` exports `buildPrompt(operation, input) → { system: string; prompt: string; promptVersion: string }`; each prompt states plainly that the model may suggest but not decide, must cite only supplied IDs, and must never invent a quotation.
- [ ] **Step 3: Run and commit**

```bash
git add convex/ai tests/unit/ai
git commit -m "feat(ai): Zod contracts, versioned prompts, source-binding validator (MOO-732)"
```

---

### Task 11: `analyzeResults` and `clusterSignals`

**Files:**
- Create: `convex/ai/analyzeResults.ts`, `convex/ai/clusterSignals.ts`, `tests/integration/ai-analyze-cluster.test.ts`

**Contracts:**
- `analyzeResults` in: normalized result IDs plus their stored title/snippet/publisher/date/language. Out, per result: detected language, faithful English translation when the original is not English, source-type suggestion, Milwaukee entities (organizations, streets, neighborhoods, agencies), dates, narrow claim candidates, potential human-source entities — every item carrying the source ID it came from.
- `clusterSignals` in: analyzed signals plus existing candidate fingerprints. Out: proposed clusters with a concise similarity basis, normalized entity keys, and suggested links to prior candidates.
- Deterministic layer afterwards: a cluster must contain at least one input result; source-family independence is applied by `convex/editorial/independence.ts` and **may split an AI cluster**. No embeddings, no vector store.

- [ ] **Step 1: Failing integration test** with a fake provider returning a fixed structured object: assert the translation sits beside the original and never replaces it; assert an unknown source ID in the model output fails the whole run and writes an `invalid` `modelRuns` row; assert a cluster containing zero input results is rejected.
- [ ] **Step 2: Implement both operations** as `internalAction`s that call `generateStructured`, then `validateAgainstSources`, then persist.
- [ ] **Step 3: Run and commit** — `feat(ai): analyzeResults and clusterSignals with source binding (MOO-732)`

---

### Task 12: `classifyEvidence` and `planFollowUp`, with decision-004 provenance

**Files:**
- Create: `convex/ai/classifyEvidence.ts`, `convex/ai/planFollowUp.ts`, `convex/editorial/judgment.ts`, `tests/unit/editorial/judgment.test.ts`, `tests/integration/ai-classify-plan.test.ts`

**This is where decision 004 lands.** Create `convex/editorial/judgment.ts`:

```ts
export type JudgmentBasis = "deterministic" | "ai_suggested" | "editor";
export type Judged<T> = { value: T; basis: JudgmentBasis; reason: string };

/** An official Milwaukee domain among the sources proves a direct city connection
 *  without asking a model. Returns null when no rule applies. */
export function deterministicLocality(hosts: string[]): Judged<"direct_city"> | null;

/** Editor beats AI beats rule — but the basis always travels with the value. */
export function resolveJudgment<T>(
  deterministic: Judged<T> | null,
  aiSuggested: T | null,
  editorOverride: T | null,
  aiReason: string,
): Judged<T> | null;
```

Tests: an official domain yields `direct_city` with basis `deterministic` and the AI suggestion is ignored; with no official domain the AI suggestion is used with basis `ai_suggested`; an editor override wins over both with basis `editor`; all three absent returns `null`.

`planFollowUp` output must contain no URL and no SerpApi parameter; every intent goes through `validateSearchIntent` and both accepted and rejected intents are logged so the demo can show the rejection.

- [ ] **Step 1: Failing tests** — the judgment table above, plus an integration test asserting a `planFollowUp` output containing `https://` or `api_key=` is rejected with reason `raw_parameters` and never executed.
- [ ] **Step 2: Implement.** `classifyEvidence` returns suggestions only; a suggestion can never mark a fact confirmed — confirmation is computed afterwards from qualifying sources.
- [ ] **Step 3: Run and commit** — `feat(ai): classifyEvidence, planFollowUp, judgment provenance per decision 004 (MOO-732)`

---

### Task 13: `generateBrief`

**Files:**
- Create: `convex/ai/generateBrief.ts`, `tests/integration/ai-generate-brief.test.ts`

**Contract:** in — an eligible candidate snapshot, confirmed-fact records, unverified/conflicting records, coverage records, potential-source records, and exact source metadata. Out — proposed reporting question; why the lead surfaced; confirmed facts with citations; unverified or conflicting claims; existing coverage; potential human sources; suggested interview questions.

**Validation before persistence:**
- Citations use only supplied source IDs.
- The confirmed-facts section accepts only evidence the deterministic layer already classified as confirmed.
- A section with no supporting evidence says so in cautious language — it is never filled with invented content.
- No generated quotations.
- The brief is labelled AI-drafted editorial assistance, not a publishable story.

- [ ] **Step 1: Failing tests** — a model output citing an unknown source is rejected whole; a model output putting a conflicting claim under confirmed facts is rejected; an empty coverage set produces the cautious sentence rather than filler; a generated quotation that does not match a stored excerpt is rejected.
- [ ] **Step 2: Implement** and persist a `briefVersions` row only after validation passes.
- [ ] **Step 3: Run and commit** — `feat(ai): source-bound reporting brief generation (MOO-732)`

---

### Task 14: Bilingual preservation and the model evaluation harness

**Files:**
- Create: `tests/integration/bilingual-evidence.test.ts`, `tests/fixtures/evaluation/*.json`, `scripts/evaluate-models.ts`, `docs/model-evaluation.md`

- [ ] **Step 1: Bilingual test.** A Spanish result keeps `title`/`snippet`/`publisher`/`publishedAt`/`canonicalUrl` untouched; `translatedTitle`/`translatedSnippet` are added; the translation is labelled AI-generated; translation alone never changes verification state and never makes two sources independent.
- [ ] **Step 2: Build 15–20 evaluation packets** in `tests/fixtures/evaluation/`, each a captured Milwaukee candidate plus human-reviewed expected annotations: which claims are source-supported, which sources are independent, whether a press release is repeated, what the Spanish meaning is, whether the cluster is correct.
- [ ] **Step 3: Write `scripts/evaluate-models.ts`** running the packets against the configured primary and fallback with identical prompt/schema versions, reporting per model: claim-to-source validity, citation completeness, conflict preservation, press-release and syndication detection, Spanish meaning preservation, clustering precision and over-merge rate, brief usefulness and cautiousness, invalid-output rate, latency, token use, estimated cost.
- [ ] **Step 4: Run it.** This makes real paid model calls — **announce the estimated cost and get Tarik's go-ahead before running.** Write the results table into `docs/model-evaluation.md` and name the chosen primary. Sonnet stays primary unless the evaluation shows a material traceability or quality deficit.
- [ ] **Step 5: Commit and push** — `feat(ai): bilingual preservation tests and model evaluation harness (MOO-732)`. Confirm CI green.

---

### Task 15: Close out items 5–6

- [ ] **Step 1:** `npm run check && npm run test:e2e && npm run build`, all green.
- [ ] **Step 2:** Write `docs/decisions/006-search-intents-not-urls.md` — why a model proposes a template ID plus plain terms instead of a query string, what that costs (the model cannot express a search we did not anticipate), and how we will know it was right. Same format as 003. Leave "What actually happened" blank.
- [ ] **Step 3:** Append a dated entry to `docs/LEARNING-LOG.md`.
- [ ] **Step 4:** Commit, push, confirm CI green, and report the live-call totals (SerpApi calls made, model calls made, estimated spend).

---

## Self-review notes

- **Spec coverage.** Item 5: Task 1–2 cover the approved `SearchSpec` and the frozen catalog including both coverage partitions; Task 3 covers canonicalization and Reddit post IDs; Task 4 covers atomic reservation at 119/120/121 and under concurrency; Task 5 covers the 60s timeout and two-retry policy; Task 6 covers all six engine normalizers and malformed-result counting; Task 7 covers the raw archive, dedupe, and the safe query log; Task 8 covers the opt-in live smoke. Item 6: Task 9 covers the provider boundary, one invalid-output retry, and logged fallback; Task 10 covers strict schemas, versioned prompts, and the known-source/exact-excerpt validator; Tasks 11–13 cover all five approved operations; Task 14 covers bilingual preservation and the 15–20 packet evaluation.
- **Deliberately not here:** the durable scan workflow (item 8), the ranked feed (item 9), and the evidence/brief UI (item 7). Item 7 gets its own plan against the interfaces this one produces — see the scope note at the top.
- **Type consistency.** `SearchSpec` in `contracts.ts` matches `vSearchSpec` in `searchRuns.ts` field for field. `SourceResultInput` matches the `sourceResults` table minus the fields the ingest mutation fills (`scanId`, `searchRunId`, `ownerId`, `discoveredAt`, `isAccessible`, `contentHash`, `canonicalKey`, `redditPostId`). `AiOperation` matches `vModelOperation` in `convex/lib/validators.ts`. `SourceFamily` matches `vSourceFamily`.
- **Known risk.** Task 6's fixtures may be hand-written if no SerpApi key exists when it runs; that is called out in the task and must be revisited during the live scan in item 10. Say so in the report rather than pretending the fixtures are captured.
