# SignalGap Evidence-to-Brief Vertical Slice Implementation Plan (Checklist item 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take one captured candidate packet all the way through — normalized source results become candidate membership, a versioned evidence snapshot, a deterministic eligibility verdict and score, and a validated brief — then render it so a journalist can trace any confirmed fact backward to an excerpt, a source URL, and the exact search that found it.

**Architecture:** Three layers, none of which invent anything. `convex/candidates/` turns AI-proposed clusters into persisted candidates, evidence snapshots and judgment provenance, calling the existing pure rules engine in `convex/editorial/` for every verdict. `convex/evidence.ts` exposes one owner-scoped read that assembles the whole evidence view in a single query. `src/components/evidence/` renders it as custom SignalGap components — not a stock dashboard — using only the Untitled UI primitives already vendored.

**Tech Stack:** Convex 1.45 (queries, internal mutations), React 19 / Next.js App Router, React Aria via the existing `src/components/ui/untitled/` primitives, Tailwind v4 with the tokens in `src/styles/theme.css`, Vitest 4 (`unit` = node, `integration` = edge-runtime, `live` = node/opt-in), Playwright.

**Spec:** `docs/hackathon-build/spec.md` (authority), with `prd.md` and `checklist.md`. This plan covers **checklist item 7** (Linear MOO-733) and ends at **Review Pause 2**.

**Predecessors:** items 5 and 6 are closed. This plan consumes their real interfaces, not predicted ones — every signature below was read out of the committed code on 2026-08-23 at `2199fda`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec and from committed code.

**The product claim this defends**
- SerpApi gives it live eyes. AI connects and interprets. **Transparent rules and a journalist decide what is credible.**
- AI may never set eligibility, a score, or the `Coverage gap` label. Nothing in this plan may add a path that lets it.
- Never weaken a locality, independence, coverage, evidence or citation rule to make the feed look fuller.

**Rules engine — already written, do not modify**
- `evaluateCandidate(input: CandidateInput): CandidateEvaluation` in `convex/editorial/status.ts` is the only thing that produces `status`, `label`, `reasons`, `score`, `independence`, `coverage`. Call it. Never re-derive any of those.
- `CandidateInput` (from `convex/editorial/types.ts`): `{ localityBand, beat, relevanceBand, initiatingSignalAt, now, sources: EngineSource[], coverage: CoverageInput, hasTrendMomentum, isDuplicateOfCandidate, isSpeculative, isRoutineCrime, hasMaterialConflict }`.
- `EngineSource`: `{ id: string; signalCategory: SignalCategory; role: SourceRole; independenceGroup: string; isAccessible: boolean; publishedAt?: number; isPromotional: boolean }`.
- `CandidateEvaluation.score` is `Score | null` — `null` whenever the candidate is excluded. An excluded candidate has no score, and the UI must not render one.
- `Score.components` has exactly five keys: `milwaukeeEvidence`, `crossSource`, `freshness`, `coverageScarcity`, `relevance`. Each is `{ points, max, bandId, reason, evidenceIds }`.
- `coverageGapAllowed(summary)` is `passStatus === "complete" && originalReportCount <= 2`. A failed coverage pass blocks `Coverage gap`, always.

**Judgment provenance — decision 004, binding**
- `Judged<T> = { value: T; basis: "deterministic" | "ai_suggested" | "editor"; reason: string }` in `convex/editorial/judgment.ts`.
- `resolveJudgment(deterministic, aiSuggested, editorOverride, aiReason)` — precedence is **editor > deterministic > AI**.
- `deterministicLocality(hosts: string[]): Judged<"direct_city"> | null` — an official Milwaukee domain settles locality without asking a model.
- `runClassifyEvidence` returns a `JudgmentSet` (seven fields). **This plan is where those get persisted and fed to the rules engine.** Ruling 3 assigned that wiring here.

**AI layer — already written, do not modify**
- Five operations in `convex/ai/`, each an exported plain async function plus a one-line `internalAction` wrapper: `runAnalyzeResults`, `runClusterSignals`, `runClassifyEvidence`, `runPlanFollowUp`, `runGenerateBrief`. The plain-function shape exists so tests inject a fake model; keep it and use it.
- `runGenerateBrief` writes the `briefVersions` row itself and patches `candidates.latestBriefVersion`. Do not write briefs by hand.
- Empty brief sections carry our fixed sentences from `EMPTY_SECTION_NOTES` in `convex/ai/generateBrief.ts`, with `sourceResultIds: []`. The UI must render those as an absence, never as a cited claim.
- A repeat AI call with an identical idempotency key returns `{ ok: false, reason: "already_generated" }` and makes **no** model call. That is correct; handle it, do not treat it as an error.

**Labels — exact strings, from `src/lib/source-labels.ts`**
- `Worth a look`, `Unverified tip`, `Coverage gap`, `Conflicting reports`, `Needs a recheck`, `No longer qualifies`, `Incomplete scan`, `Stopped early`, `Outdated`, `Saved copy`. Use `PRODUCT_LABELS` and `StatusLabel`; never type a label as a literal in a component.

**UI**
- Untitled UI (MIT only) is the sole primitive foundation. Search `src/components/ui/untitled/` before adding a primitive. Never copy a PRO component. No shadcn/ui, no Radix, no second token system.
- Add every copied component to `THIRD_PARTY_NOTICES.md` in the same change.
- Colors come from tokens in `src/styles/theme.css`. No ad-hoc hex in components.
- Status must be readable **without color**: `StatusLabel` renders visible text, and `data-tone` is decoration.
- Verify light mode, dark mode, keyboard focus, narrow width, and non-color status text.
- Keep client boundaries small — a component only becomes `"use client"` if it actually needs interactivity.

**Convex**
- Every public function: `args` **and** `returns` validators, Clerk identity via `requireUser`, server-derived `ownerId`. Processing functions are `internalMutation` / `internalAction` only.
- Raw SerpApi JSON lives in File Storage; `rawStorageId` is **never** returned to the browser.
- Times are Unix milliseconds.
- `npx convex codegen` does **not** deploy. After adding or changing a Convex function a CLI or e2e run will call, also run `npx convex dev --once`.
- Convex CLI commands need the env sourced: `set -a; . ./.env.local; set +a`.

**Process**
- npm only. Commit after every task. TDD for rules, adapters, schemas, validators and transitions.
- Never commit `.env*`. Paid API tests run only with `LIVE_TESTS=1`. **This plan makes zero paid calls** — every AI call in it goes through an injected fake model.
- Do not run `/simplify` or any refactor pass.
- Commit messages end with `(MOO-733)`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `convex/candidates/fingerprint.ts` | Pure: a stable candidate identity from normalized entity keys. No Convex imports. |
| `convex/candidates/toEngineSource.ts` | Pure: `sourceResults` row + `candidateSources` row → `EngineSource` for the rules engine. No Convex imports. |
| `convex/candidates/form.ts` | `internalMutation`: turn one AI cluster into a `candidates` row + `candidateSources` rows + a `candidateAppearances` row. |
| `convex/candidates/judgment.ts` | `internalMutation`: persist a `JudgmentSet` onto a candidate, and read it back as `CandidateInput` fields. |
| `convex/candidates/evaluate.ts` | `internalMutation`: assemble `CandidateInput`, call `evaluateCandidate`, write status/label/score/coverage back. The only writer of those fields. |
| `convex/candidates/snapshot.ts` | `internalMutation`: write a versioned `evidenceItems` snapshot from `classifyEvidence` output. Append-only. |
| `convex/evidence.ts` | Public owner-scoped `query`: assemble the entire evidence view for one candidate in one round trip. Never returns `rawStorageId`. |
| `convex/slice.ts` | `internalAction`: the end-to-end fixture pipeline — cluster → form → classify → snapshot → evaluate → brief. Exported plain function so tests inject a fake model. |
| `src/lib/evidence-view.ts` | Types shared by the evidence components, derived from `convex/evidence.ts`'s return validator. |
| `src/components/evidence/lead-card.tsx` | `LeadCard` — reporting question, score, sources, coverage, disposition. |
| `src/components/evidence/why-this-surfaced.tsx` | `WhyThisSurfaced` — the convergence sequence. The demo's central reveal. |
| `src/components/evidence/evidence-item.tsx` | `EvidenceItem` — one claim with its classification, language, translation and link. |
| `src/components/evidence/citation-trace.tsx` | `CitationTrace` — excerpt → source → the exact query that found it. |
| `src/components/evidence/coverage-audit.tsx` | `CoverageAudit` — the two-part pass, original-report grouping, and why a gap is or is not allowed. |
| `src/components/evidence/score-breakdown.tsx` | `ScoreBreakdown` — five components, bands, cited basis, and the judgment basis behind each band. |
| `src/components/evidence/reporting-brief.tsx` | `ReportingBrief` — AI-drafted sections, citations, version history, and the AI-assistance label. |
| `src/components/evidence/evidence-view.tsx` | The ordered assembly of the sections the spec names. |
| `src/app/workspace/leads/[candidateId]/page.tsx` | The route that renders one lead's evidence view. |
| `tests/fixtures/slice.ts` | One captured candidate packet, built from the real SerpApi fixtures. |
| `tests/integration/evidence-brief-vertical-slice.test.ts` | The pipeline end to end, with a fake model. |
| `tests/unit/evidence/*.test.ts` | Pure-function tests for fingerprint and source mapping. |
| `tests/e2e/evidence-vertical-slice.spec.ts` | The rendered trace, both themes, keyboard order. |

---

### Task 1: Candidate fingerprint and source mapping (pure)

**Files:**
- Create: `convex/candidates/fingerprint.ts`, `convex/candidates/toEngineSource.ts`
- Test: `tests/unit/evidence/fingerprint.test.ts`, `tests/unit/evidence/to-engine-source.test.ts`

**Interfaces:**
- Consumes: `SignalCategory`, `SourceRole`, `EngineSource` from `convex/editorial/types.ts`; `SourceFamily` from `convex/integrations/serpapi/contracts.ts`; `contentHash` from `convex/integrations/serpapi/canonical.ts`.
- Produces:
  ```ts
  export function candidateFingerprint(entityKeys: string[], beat: string | null): string;
  export function normalizeEntityKey(raw: string): string;
  export function signalCategoryFor(sourceFamily: SourceFamily): SignalCategory;
  export function toEngineSource(args: {
    sourceResultId: string;
    sourceFamily: SourceFamily;
    canonicalUrl: string;
    publisher: string | null;
    publishedAt: number | undefined;
    isAccessible: boolean;
    role: SourceRole;
    independenceGroupOverride: string | null;
    signalCategoryOverride: SignalCategory | null;
    isPromotional: boolean;
  }): EngineSource;
  export function defaultIndependenceGroup(canonicalUrl: string, publisher: string | null): string;
  ```

- [ ] **Step 1: Write the failing fingerprint test** — `tests/unit/evidence/fingerprint.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { candidateFingerprint, normalizeEntityKey } from "../../../convex/candidates/fingerprint";

describe("normalizeEntityKey", () => {
  it("lowercases, trims, and collapses inner whitespace", () => {
    expect(normalizeEntityKey("  Harambee   Neighborhood ")).toBe("harambee neighborhood");
  });

  it("strips accents so a Spanish and English mention of one place agree", () => {
    expect(normalizeEntityKey("rezonificación")).toBe("rezonificacion");
  });

  it("drops punctuation that carries no meaning", () => {
    expect(normalizeEntityKey("N. 3rd St.")).toBe("n 3rd st");
  });

  it("returns the empty string for whitespace only", () => {
    expect(normalizeEntityKey("   ")).toBe("");
  });
});

describe("candidateFingerprint", () => {
  it("is stable no matter what order the entity keys arrive in", () => {
    expect(candidateFingerprint(["Harambee", "rezoning"], "housing"))
      .toBe(candidateFingerprint(["rezoning", "Harambee"], "housing"));
  });

  it("ignores duplicates", () => {
    expect(candidateFingerprint(["Harambee", "Harambee", "rezoning"], "housing"))
      .toBe(candidateFingerprint(["Harambee", "rezoning"], "housing"));
  });

  it("separates two stories that share a beat but not their entities", () => {
    expect(candidateFingerprint(["Harambee"], "housing"))
      .not.toBe(candidateFingerprint(["Bay View"], "housing"));
  });

  it("separates the same entities on different beats", () => {
    expect(candidateFingerprint(["Harambee"], "housing"))
      .not.toBe(candidateFingerprint(["Harambee"], "culture"));
  });

  it("treats a null beat as its own bucket rather than throwing", () => {
    expect(candidateFingerprint(["Harambee"], null)).toMatch(/^[0-9a-f]{8}:/);
  });

  it("drops empty keys instead of letting them change the identity", () => {
    expect(candidateFingerprint(["Harambee", "  "], "housing"))
      .toBe(candidateFingerprint(["Harambee"], "housing"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/evidence/fingerprint.test.ts`
Expected: FAIL — `Cannot find module '../../../convex/candidates/fingerprint'`

- [ ] **Step 3: Write `convex/candidates/fingerprint.ts`**

```ts
import { contentHash } from "../integrations/serpapi/canonical";

/**
 * A candidate's identity has to survive across scans, or "this lead appeared
 * again on Tuesday" is not a thing we can say. It is built from normalized
 * entity keys plus the beat — never from a title, which rewords constantly.
 */
export function normalizeEntityKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip accents: rezonificación -> rezonificacion
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation carries no identity
    .replace(/\s+/g, " ")
    .trim();
}

export function candidateFingerprint(entityKeys: string[], beat: string | null): string {
  const keys = [...new Set(entityKeys.map(normalizeEntityKey).filter((k) => k.length > 0))].sort();
  return `${contentHash(keys)}:${beat ?? "unassigned"}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/evidence/fingerprint.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing source-mapping test** — `tests/unit/evidence/to-engine-source.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { defaultIndependenceGroup, signalCategoryFor, toEngineSource } from "../../../convex/candidates/toEngineSource";

const base = {
  sourceResultId: "src_1",
  sourceFamily: "news" as const,
  canonicalUrl: "https://jsonline.com/story/2026/rezoning",
  publisher: "Milwaukee Journal Sentinel",
  publishedAt: 1_700_000_000_000,
  isAccessible: true,
  role: "corroborating" as const,
  independenceGroupOverride: null,
  signalCategoryOverride: null,
  isPromotional: false,
};

describe("signalCategoryFor", () => {
  it("maps every source family the normalizers can emit", () => {
    expect(signalCategoryFor("news")).toBe("original_news");
    expect(signalCategoryFor("official")).toBe("official_record");
    expect(signalCategoryFor("event")).toBe("event");
    expect(signalCategoryFor("video")).toBe("video");
    expect(signalCategoryFor("map")).toBe("map");
    expect(signalCategoryFor("community_discussion")).toBe("community_discussion");
    expect(signalCategoryFor("public_web")).toBe("public_web");
    expect(signalCategoryFor("trend")).toBe("trend");
  });
});

describe("defaultIndependenceGroup", () => {
  it("groups by host, so two stories on one site are one lineage", () => {
    expect(defaultIndependenceGroup("https://jsonline.com/a", null))
      .toBe(defaultIndependenceGroup("https://jsonline.com/b", null));
  });

  it("ignores a www prefix", () => {
    expect(defaultIndependenceGroup("https://www.jsonline.com/a", null))
      .toBe(defaultIndependenceGroup("https://jsonline.com/b", null));
  });

  it("keeps two different outlets apart", () => {
    expect(defaultIndependenceGroup("https://jsonline.com/a", null))
      .not.toBe(defaultIndependenceGroup("https://tmj4.com/a", null));
  });

  it("falls back to the publisher when the URL will not parse", () => {
    expect(defaultIndependenceGroup("not a url", "Outlet A")).toBe("publisher:outlet a");
  });

  it("falls back to the source id itself when there is nothing else", () => {
    expect(defaultIndependenceGroup("not a url", null)).toBe("ungrouped");
  });
});

describe("toEngineSource", () => {
  it("produces exactly the shape the rules engine takes", () => {
    expect(toEngineSource(base)).toEqual({
      id: "src_1",
      signalCategory: "original_news",
      role: "corroborating",
      independenceGroup: "host:jsonline.com",
      isAccessible: true,
      publishedAt: 1_700_000_000_000,
      isPromotional: false,
    });
  });

  it("lets an editor correction override the independence group", () => {
    expect(toEngineSource({ ...base, independenceGroupOverride: "press-release-250412" }).independenceGroup)
      .toBe("press-release-250412");
  });

  it("lets an editor correction override the signal category", () => {
    expect(toEngineSource({ ...base, signalCategoryOverride: "public_web" }).signalCategory).toBe("public_web");
  });

  it("omits publishedAt entirely when there is no date, rather than inventing one", () => {
    expect(toEngineSource({ ...base, publishedAt: undefined })).not.toHaveProperty("publishedAt");
  });

  it("carries an inaccessible source through instead of dropping it", () => {
    expect(toEngineSource({ ...base, isAccessible: false }).isAccessible).toBe(false);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run tests/unit/evidence/to-engine-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `convex/candidates/toEngineSource.ts`**

```ts
import type { EngineSource, SignalCategory, SourceRole } from "../editorial/types";
import type { SourceFamily } from "../integrations/serpapi/contracts";

/**
 * The normalizers speak in source FAMILIES (what engine produced this). The rules
 * engine speaks in signal CATEGORIES (what kind of evidence this is). This is the
 * one place the two vocabularies meet, so the mapping is auditable in a single
 * eight-line table rather than scattered across call sites.
 */
const CATEGORY_BY_FAMILY: Record<SourceFamily, SignalCategory> = {
  news: "original_news",
  official: "official_record",
  event: "event",
  video: "video",
  map: "map",
  community_discussion: "community_discussion",
  public_web: "public_web",
  trend: "trend",
};

export const signalCategoryFor = (family: SourceFamily): SignalCategory => CATEGORY_BY_FAMILY[family];

/**
 * Independence is about lineage, not brand. Host is the honest default: two
 * stories on one site are one original report. Real syndication (the same press
 * release under three mastheads) is detected later and recorded as an override —
 * we never guess a publisher relationship here.
 */
export function defaultIndependenceGroup(canonicalUrl: string, publisher: string | null): string {
  try {
    return `host:${new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, "")}`;
  } catch {
    return publisher ? `publisher:${publisher.toLowerCase()}` : "ungrouped";
  }
}

export function toEngineSource(args: {
  sourceResultId: string;
  sourceFamily: SourceFamily;
  canonicalUrl: string;
  publisher: string | null;
  publishedAt: number | undefined;
  isAccessible: boolean;
  role: SourceRole;
  independenceGroupOverride: string | null;
  signalCategoryOverride: SignalCategory | null;
  isPromotional: boolean;
}): EngineSource {
  const source: EngineSource = {
    id: args.sourceResultId,
    signalCategory: args.signalCategoryOverride ?? signalCategoryFor(args.sourceFamily),
    role: args.role,
    independenceGroup: args.independenceGroupOverride ?? defaultIndependenceGroup(args.canonicalUrl, args.publisher),
    isAccessible: args.isAccessible,
    isPromotional: args.isPromotional,
  };
  // Absent is absent. An invented date would move the freshness score.
  if (args.publishedAt !== undefined) source.publishedAt = args.publishedAt;
  return source;
}
```

- [ ] **Step 8: Run both test files and watch them pass**

Run: `npx vitest run tests/unit/evidence`
Expected: PASS, 17 tests.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (One pre-existing warning in `convex/auth.config.ts` is expected and is not yours.)

- [ ] **Step 10: Commit**

```bash
git add convex/candidates tests/unit/evidence
git commit -m "feat(candidates): stable fingerprint and source-family to signal-category mapping (MOO-733)"
```

---

### Task 2: Form a candidate from an AI cluster

**Files:**
- Create: `convex/candidates/form.ts`
- Create: `tests/integration/candidate-formation.test.ts`

**Interfaces:**
- Consumes: `candidateFingerprint` from Task 1; `defaultIndependenceGroup`, `signalCategoryFor` from Task 1; the `candidates`, `candidateSources`, `candidateAppearances` tables in `convex/schema.ts`.
- Produces:
  ```ts
  export const formFromCluster: internalMutation; // args: { scanId, cluster, beat, workingTitle }
  // returns: { candidateId: Id<"candidates">; created: boolean; sourceCount: number }
  //        | { rejected: "scan_not_found" | "no_valid_sources" }
  ```

**Rules this task must hold:**
1. A cluster's source ids are untrusted — every one is re-checked against `sourceResults` **for this scan** before it becomes membership.
2. Re-running the same cluster is idempotent on `(ownerId, fingerprint)`: the candidate is reused, `lastSeenAt` moves, and no duplicate `candidateSources` row appears.
3. The **first** source becomes `initiating`; the rest become `corroborating`. Role is structural, not a judgment.
4. A new candidate starts `status: "processing"` with label `Worth a look` and disposition `new`. **Task 4 is the only thing allowed to change status, label or score.**

- [ ] **Step 1: Write the failing test** — `tests/integration/candidate-formation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

async function seed(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const otherScanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const source = (over: Record<string, unknown>) => ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: `k${Math.random()}`, canonicalUrl: "https://jsonline.com/a", originalUrl: "https://jsonline.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h", ...over,
    });

    const officialId = await source({
      sourceFamily: "official" as const, canonicalUrl: "https://city.milwaukee.gov/agenda",
      title: "Common Council agenda 250412", snippet: "Rezoning of the 3000 block.",
    });
    const newsId = await source({ title: "Neighbors question rezoning", snippet: "They say they were not notified." });
    const foreignId = await ctx.db.insert("sourceResults", {
      scanId: otherScanId, searchRunId, ownerId,
      canonicalKey: "k-foreign", canonicalUrl: "https://elsewhere.com/x", originalUrl: "https://elsewhere.com/x",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h",
    });

    return { ownerId, scanId, otherScanId, officialId, newsId, foreignId };
  });
}

const cluster = (ids: Id<"sourceResults">[], entityKeys = ["Harambee", "rezoning"]) => ({
  sourceResultIds: ids as string[],
  similarityBasis: "Both describe the same Common Council agenda item.",
  entityKeys,
  suggestedExistingCandidateId: null,
});

describe("formFromCluster", () => {
  it("creates one candidate, one membership row per source, and one appearance", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);

    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "Harambee rezoning",
    });

    expect("candidateId" in result).toBe(true);
    if (!("candidateId" in result)) return;
    expect(result.created).toBe(true);
    expect(result.sourceCount).toBe(2);

    const { candidate, memberships, appearances } = await t.run(async (ctx) => ({
      candidate: (await ctx.db.get(result.candidateId)) as Doc<"candidates">,
      memberships: await ctx.db.query("candidateSources").collect(),
      appearances: await ctx.db.query("candidateAppearances").collect(),
    }));

    expect(candidate.status).toBe("processing");
    expect(candidate.beat).toBe("housing");
    expect(candidate.currentTitle).toBe("Harambee rezoning");
    expect(memberships).toHaveLength(2);
    expect(appearances).toHaveLength(1);
    expect(appearances[0].scanId).toBe(scanId);
  });

  it("makes the first source initiating and the rest corroborating", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "T",
    });

    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships.find((m) => m.sourceResultId === officialId)?.role).toBe("initiating");
    expect(memberships.find((m) => m.sourceResultId === newsId)?.role).toBe("corroborating");
  });

  it("records that the AI proposed the membership", async () => {
    const t = setup();
    const { scanId, officialId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId]), beat: "housing", workingTitle: "T",
    });
    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships[0].addedBy).toBe("ai_suggestion");
  });

  it("derives the signal category from the source family, not from anything the model said", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "T",
    });
    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships.find((m) => m.sourceResultId === officialId)?.signalCategory).toBe("official_record");
    expect(memberships.find((m) => m.sourceResultId === newsId)?.signalCategory).toBe("original_news");
  });

  it("reuses the candidate on a second identical cluster and does not duplicate membership", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    const args = { scanId, cluster: cluster([officialId, newsId]), beat: "housing", workingTitle: "T" };

    const first = await t.mutation(internal.candidates.form.formFromCluster, args);
    const second = await t.mutation(internal.candidates.form.formFromCluster, args);

    expect("candidateId" in first && "candidateId" in second).toBe(true);
    if (!("candidateId" in first) || !("candidateId" in second)) return;
    expect(second.candidateId).toBe(first.candidateId);
    expect(second.created).toBe(false);

    const memberships = await t.run(async (ctx) => await ctx.db.query("candidateSources").collect());
    expect(memberships).toHaveLength(2);
  });

  it("ignores a source id belonging to a different scan", async () => {
    const t = setup();
    const { scanId, officialId, foreignId } = await seed(t);
    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId, foreignId]), beat: "housing", workingTitle: "T",
    });
    expect("candidateId" in result && result.sourceCount).toBe(1);
  });

  it("refuses a cluster whose sources are all unusable rather than creating an empty candidate", async () => {
    const t = setup();
    const { scanId, foreignId } = await seed(t);
    const result = await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([foreignId]), beat: "housing", workingTitle: "T",
    });
    expect(result).toEqual({ rejected: "no_valid_sources" });
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(0);
  });

  it("keeps two clusters with different entities as two candidates", async () => {
    const t = setup();
    const { scanId, officialId, newsId } = await seed(t);
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([officialId], ["Harambee"]), beat: "housing", workingTitle: "A",
    });
    await t.mutation(internal.candidates.form.formFromCluster, {
      scanId, cluster: cluster([newsId], ["Bay View"]), beat: "housing", workingTitle: "B",
    });
    expect(await t.run(async (ctx) => await ctx.db.query("candidates").collect())).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/candidate-formation.test.ts`
Expected: FAIL — `internal.candidates.form` does not exist.

- [ ] **Step 3: Write `convex/candidates/form.ts`**

```ts
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import * as V from "../lib/validators";
import { candidateFingerprint } from "./fingerprint";
import { defaultIndependenceGroup, signalCategoryFor } from "./toEngineSource";

/**
 * Turns one AI-proposed cluster into persisted candidate membership.
 *
 * The model proposed the grouping. Nothing it proposed is trusted here: every
 * source id is re-read from `sourceResults` and checked against THIS scan, and
 * every signal category is derived from the stored source family rather than
 * from anything the model said about it.
 */
export const formFromCluster = internalMutation({
  args: {
    scanId: v.id("scans"),
    cluster: v.object({
      sourceResultIds: v.array(v.string()),
      similarityBasis: v.string(),
      entityKeys: v.array(v.string()),
      suggestedExistingCandidateId: v.union(v.string(), v.null()),
    }),
    beat: V.vBeat,
    workingTitle: v.string(),
  },
  returns: v.union(
    v.object({ candidateId: v.id("candidates"), created: v.boolean(), sourceCount: v.number() }),
    v.object({ rejected: v.union(v.literal("scan_not_found"), v.literal("no_valid_sources")) }),
  ),
  handler: async (ctx, { scanId, cluster, beat, workingTitle }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return { rejected: "scan_not_found" as const };

    // Re-read every proposed source. A row that does not exist, or belongs to a
    // different scan, is silently dropped — it cannot become evidence.
    const sources = [];
    for (const raw of cluster.sourceResultIds) {
      const row = await ctx.db.get(raw as Id<"sourceResults">).catch(() => null);
      if (!row || !("scanId" in row) || row.scanId !== scanId) continue;
      sources.push(row);
    }
    if (sources.length === 0) return { rejected: "no_valid_sources" as const };

    const fingerprint = candidateFingerprint(cluster.entityKeys, beat);
    const now = Date.now();

    const existing = await ctx.db
      .query("candidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", scan.ownerId).eq("fingerprint", fingerprint))
      .unique();

    let candidateId: Id<"candidates">;
    let created = false;
    if (existing) {
      candidateId = existing._id;
      await ctx.db.patch(candidateId, { lastSeenAt: now, updatedAt: now });
    } else {
      created = true;
      candidateId = await ctx.db.insert("candidates", {
        ownerId: scan.ownerId, fingerprint,
        currentTitle: workingTitle,
        reportingQuestion: "",
        beat,
        // "processing" until the rules engine has run. Task 4 is the only writer
        // of status, label and score.
        status: "processing",
        primaryLabel: "Worth a look",
        disposition: "new",
        latestEvidenceVersion: 0,
        independentCategoryCount: 0,
        coverageOriginalCount: 0,
        coveragePassStatus: "pending",
        firstSeenAt: now, lastSeenAt: now, updatedAt: now,
      });
    }

    for (const [index, source] of sources.entries()) {
      const alreadyMember = await ctx.db
        .query("candidateSources")
        .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
        .filter((q) => q.eq(q.field("sourceResultId"), source._id))
        .unique();
      if (alreadyMember) continue;

      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId: source._id,
        // Structural, not a judgment: the first source is what started the lead.
        role: index === 0 ? "initiating" : "corroborating",
        independenceGroup: defaultIndependenceGroup(source.canonicalUrl, source.publisher ?? null),
        signalCategory: signalCategoryFor(source.sourceFamily),
        addedBy: "ai_suggestion",
      });
    }

    const appearance = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .unique();
    if (!appearance) {
      await ctx.db.insert("candidateAppearances", {
        candidateId, scanId, ownerId: scan.ownerId,
        statusAtScan: "processing", labelAtScan: "Worth a look", dispositionAtScan: "new",
      });
    }

    return { candidateId, created, sourceCount: sources.length };
  },
});
```

- [ ] **Step 4: Regenerate Convex types, then run the test**

Run: `npx convex codegen && npx vitest run tests/integration/candidate-formation.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/candidates/form.ts convex/_generated tests/integration/candidate-formation.test.ts
git commit -m "feat(candidates): form candidates from AI clusters with re-checked membership (MOO-733)"
```

---

### Task 3: Persist judgment provenance (decision 004 wiring)

**Files:**
- Create: `convex/candidates/judgment.ts`
- Modify: `convex/schema.ts` — add one optional field to `candidates`
- Create: `tests/integration/judgment-persistence.test.ts`

**Interfaces:**
- Consumes: `JudgmentSet` from `convex/ai/classifyEvidence.ts`; `Judged`, `resolveJudgment`, `deterministicLocality` from `convex/editorial/judgment.ts`.
- Produces:
  ```ts
  export const vJudgmentRecord;                 // Convex validator for the stored shape
  export const saveJudgment: internalMutation;  // args: { candidateId, judgment, editorOverrides? }
  export const readJudgment: internalQuery;     // args: { candidateId } -> JudgmentRecord | null
  export type JudgmentRecord = {
    localityBand: { value: string; basis: string; reason: string } | null;
    relevanceBand: { value: string; basis: string; reason: string } | null;
    beat: { value: string; basis: string; reason: string } | null;
    isSpeculative: { value: boolean; basis: string; reason: string };
    isRoutineCrime: { value: boolean; basis: string; reason: string };
    isDuplicateOfCandidate: { value: boolean; basis: string; reason: string };
    hasMaterialConflict: { value: boolean; basis: string; reason: string };
  };
  ```

**Why the schema changes here:** decision 004 says every judgment field the rules engine reads must record who set it. There is nowhere on `candidates` to put that today. One optional record field is the smallest change that makes the claim true; it is additive and no existing row breaks.

- [ ] **Step 1: Add the schema field** — `convex/schema.ts`

Inside the `candidates` table definition, after `scoreComponents: v.optional(V.vScoreComponents),`, add:

```ts
    // Decision 004: every judgment field the rules engine reads records WHO set
    // it — a rule, the AI, or an editor. Optional because candidates created
    // before classification runs have no judgment yet.
    judgment: v.optional(V.vJudgmentRecord),
```

- [ ] **Step 2: Add the validator** — `convex/lib/validators.ts`

Append:

```ts
const vJudgedString = v.union(v.null(), v.object({ value: v.string(), basis: vJudgmentBasis, reason: v.string() }));
const vJudgedBoolean = v.object({ value: v.boolean(), basis: vJudgmentBasis, reason: v.string() });

export const vJudgmentBasis = v.union(v.literal("deterministic"), v.literal("ai_suggested"), v.literal("editor"));

export const vJudgmentRecord = v.object({
  localityBand: vJudgedString,
  relevanceBand: vJudgedString,
  beat: vJudgedString,
  isSpeculative: vJudgedBoolean,
  isRoutineCrime: vJudgedBoolean,
  isDuplicateOfCandidate: vJudgedBoolean,
  hasMaterialConflict: vJudgedBoolean,
});
```

Note: `vJudgmentBasis` is referenced above its own declaration in the source order shown — move the `export const vJudgmentBasis` line **above** `vJudgedString` when you paste it, so the file reads top-down.

- [ ] **Step 3: Write the failing test** — `tests/integration/judgment-persistence.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const judged = (value: string, basis: string, reason = "r") => ({ value, basis, reason });
const flag = (value: boolean, basis = "ai_suggested") => ({ value, basis, reason: "flagged by the model" });

const fullJudgment = {
  localityBand: judged("direct_city", "deterministic", "an official Milwaukee source is cited: city.milwaukee.gov"),
  relevanceBand: judged("policy_service_change", "ai_suggested"),
  beat: judged("housing", "ai_suggested"),
  isSpeculative: flag(false),
  isRoutineCrime: flag(false),
  isDuplicateOfCandidate: flag(false),
  hasMaterialConflict: flag(true),
};

async function seedCandidate(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    return { ownerId, scanId, candidateId };
  });
}

describe("judgment persistence", () => {
  it("stores all seven fields with their basis", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);

    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });

    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(Object.keys(stored.judgment ?? {})).toHaveLength(7);
    expect(stored.judgment?.localityBand?.basis).toBe("deterministic");
    expect(stored.judgment?.hasMaterialConflict.basis).toBe("ai_suggested");
  });

  it("moves the beat onto the candidate when the judgment names one", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: { ...fullJudgment, beat: judged("culture", "ai_suggested") },
    });
    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(stored.beat).toBe("culture");
  });

  it("lets an editor override a field and records the basis as editor", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);

    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: fullJudgment,
      editorOverrides: { localityBand: "none", hasMaterialConflict: false },
    });

    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(stored.judgment?.localityBand).toEqual({ value: "none", basis: "editor", reason: "set by an editor" });
    expect(stored.judgment?.hasMaterialConflict).toEqual({ value: false, basis: "editor", reason: "set by an editor" });
  });

  it("an editor override beats the deterministic rule, not just the AI", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, {
      candidateId, judgment: fullJudgment, editorOverrides: { localityBand: "county_city_effect" },
    });
    const stored = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    // fullJudgment.localityBand arrived with basis "deterministic"; the editor still wins.
    expect(stored.judgment?.localityBand?.value).toBe("county_city_effect");
    expect(stored.judgment?.localityBand?.basis).toBe("editor");
  });

  it("reads back null for a candidate that has never been classified", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    expect(await t.query(internal.candidates.judgment.readJudgment, { candidateId })).toBeNull();
  });

  it("reads back exactly what was written", async () => {
    const t = setup();
    const { candidateId } = await seedCandidate(t);
    await t.mutation(internal.candidates.judgment.saveJudgment, { candidateId, judgment: fullJudgment });
    expect(await t.query(internal.candidates.judgment.readJudgment, { candidateId })).toEqual(fullJudgment);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx convex codegen && npx vitest run tests/integration/judgment-persistence.test.ts`
Expected: FAIL — `internal.candidates.judgment` does not exist.

- [ ] **Step 5: Write `convex/candidates/judgment.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import * as V from "../lib/validators";

/**
 * Decision 004. The rules engine reads seven judgment fields; together they are
 * worth 40 of 100 points and they gate exclusions. Storing them without storing
 * WHO set them would make "deterministic rules decide" untrue.
 *
 * Precedence is editor > deterministic > AI, and it is applied here rather than
 * in the caller so there is exactly one place where an override can win.
 */

const vEditorOverrides = v.object({
  localityBand: v.optional(v.string()),
  relevanceBand: v.optional(v.string()),
  beat: v.optional(v.string()),
  isSpeculative: v.optional(v.boolean()),
  isRoutineCrime: v.optional(v.boolean()),
  isDuplicateOfCandidate: v.optional(v.boolean()),
  hasMaterialConflict: v.optional(v.boolean()),
});

const EDITOR_REASON = "set by an editor";

export const saveJudgment = internalMutation({
  args: {
    candidateId: v.id("candidates"),
    judgment: V.vJudgmentRecord,
    editorOverrides: v.optional(vEditorOverrides),
  },
  returns: v.null(),
  handler: async (ctx, { candidateId, judgment, editorOverrides = {} }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return null;

    const overrideString = (
      current: { value: string; basis: string; reason: string } | null,
      override: string | undefined,
    ) => (override === undefined ? current : { value: override, basis: "editor" as const, reason: EDITOR_REASON });

    const overrideBoolean = (
      current: { value: boolean; basis: string; reason: string },
      override: boolean | undefined,
    ) => (override === undefined ? current : { value: override, basis: "editor" as const, reason: EDITOR_REASON });

    const resolved = {
      localityBand: overrideString(judgment.localityBand, editorOverrides.localityBand),
      relevanceBand: overrideString(judgment.relevanceBand, editorOverrides.relevanceBand),
      beat: overrideString(judgment.beat, editorOverrides.beat),
      isSpeculative: overrideBoolean(judgment.isSpeculative, editorOverrides.isSpeculative),
      isRoutineCrime: overrideBoolean(judgment.isRoutineCrime, editorOverrides.isRoutineCrime),
      isDuplicateOfCandidate: overrideBoolean(judgment.isDuplicateOfCandidate, editorOverrides.isDuplicateOfCandidate),
      hasMaterialConflict: overrideBoolean(judgment.hasMaterialConflict, editorOverrides.hasMaterialConflict),
    };

    const patch: Record<string, unknown> = { judgment: resolved, updatedAt: Date.now() };
    // The candidate's own beat column mirrors the judgment so the feed can filter
    // on it without unpacking the record.
    if (resolved.beat && (resolved.beat.value === "housing" || resolved.beat.value === "transportation" || resolved.beat.value === "culture")) {
      patch.beat = resolved.beat.value;
    }
    await ctx.db.patch(candidateId, patch);
    return null;
  },
});

export const readJudgment = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.union(v.null(), V.vJudgmentRecord),
  handler: async (ctx, { candidateId }) => {
    const candidate = await ctx.db.get(candidateId);
    return candidate?.judgment ?? null;
  },
});
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx convex codegen && npx vitest run tests/integration/judgment-persistence.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole suite — a schema change touches everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. If `tests/integration/schema-validation.test.ts` fails, the new field is not optional or the validator is wrong — fix the validator, not the test.

- [ ] **Step 8: Deploy the schema change**

Run: `set -a; . ./.env.local; set +a; npx convex dev --once`
Expected: `Convex functions ready!`

- [ ] **Step 9: Commit**

```bash
git add convex/schema.ts convex/lib/validators.ts convex/candidates/judgment.ts convex/_generated tests/integration/judgment-persistence.test.ts
git commit -m "feat(candidates): persist judgment provenance per decision 004 (MOO-733)"
```

---

### Task 4: Evaluate a candidate with the rules engine

**Files:**
- Create: `convex/candidates/evaluate.ts`
- Create: `tests/integration/candidate-evaluation.test.ts`

**Interfaces:**
- Consumes: `evaluateCandidate` from `convex/editorial/status.ts`; `toEngineSource` from Task 1; `readJudgment` from Task 3.
- Produces:
  ```ts
  export const evaluate: internalMutation; // args: { scanId, candidateId, now? }
  // returns: { status: "eligible" | "excluded"; label: string; scoreTotal: number | null; reasons: string[] }
  //        | { rejected: "candidate_not_found" | "no_judgment" }
  ```

**Rules this task must hold — the load-bearing ones in the whole plan:**
1. This mutation is the **only** writer of `candidates.status`, `primaryLabel`, `scoreTotal`, `scoreComponents`, `independentCategoryCount`, `coverageOriginalCount`, `coveragePassStatus`.
2. It never computes a verdict itself. It assembles `CandidateInput` and calls `evaluateCandidate`. Every returned field comes from that call.
3. An excluded candidate gets `scoreTotal: undefined` and `scoreComponents: undefined`. Not zero. Not a stale value from a previous run.
4. Without a stored judgment it refuses with `no_judgment` rather than guessing bands — a guessed band is a fabricated 40 points.

- [ ] **Step 1: Write the failing test** — `tests/integration/candidate-evaluation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const judged = (value: string, basis = "ai_suggested") => ({ value, basis, reason: "r" });
const flag = (value: boolean) => ({ value, basis: "ai_suggested", reason: "r" });

const strongJudgment = {
  localityBand: judged("direct_city", "deterministic"),
  relevanceBand: judged("policy_service_change"),
  beat: judged("housing"),
  isSpeculative: flag(false),
  isRoutineCrime: flag(false),
  isDuplicateOfCandidate: flag(false),
  hasMaterialConflict: flag(false),
};

async function seed(
  t: ReturnType<typeof setup>,
  opts: { families: ("official" | "news" | "community_discussion")[]; accessible?: boolean; coverage?: "pending" | "complete" },
) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "Harambee rezoning", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: NOW, lastSeenAt: NOW, updatedAt: NOW,
      judgment: strongJudgment,
    });

    const ids: Id<"sourceResults">[] = [];
    for (const [i, family] of opts.families.entries()) {
      const sourceResultId = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`,
        canonicalUrl: family === "official" ? "https://city.milwaukee.gov/a" : `https://outlet${i}.com/a`,
        originalUrl: "https://x.com/a",
        engine: "google" as const, sourceFamily: family, sourceType: "unknown" as const,
        title: `t${i}`, snippet: `s${i}`, originalLanguage: "en",
        publishedAt: NOW - DAY, discoveredAt: NOW,
        isAccessible: opts.accessible ?? true, contentHash: "h",
      });
      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId,
        role: i === 0 ? ("initiating" as const) : ("corroborating" as const),
        independenceGroup: `host:outlet${i}`,
        signalCategory: family === "official" ? ("official_record" as const)
          : family === "news" ? ("original_news" as const) : ("community_discussion" as const),
        addedBy: "ai_suggestion" as const,
      });
      ids.push(sourceResultId);
    }
    return { ownerId, scanId, candidateId, ids };
  });
}

const read = async (t: ReturnType<typeof setup>, id: Id<"candidates">) =>
  (await t.run(async (ctx) => await ctx.db.get(id))) as Doc<"candidates">;

describe("candidate evaluation", () => {
  it("writes an eligible verdict with a score when two independent categories confirm", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    expect("status" in result && result.status).toBe("eligible");
    const candidate = await read(t, candidateId);
    expect(candidate.status).toBe("eligible");
    expect(candidate.scoreTotal).toBeGreaterThan(0);
    expect(Object.keys(candidate.scoreComponents ?? {})).toHaveLength(5);
  });

  it("makes the five score components add up to the total", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    const sum = Object.values(candidate.scoreComponents ?? {}).reduce((acc, c) => acc + c.points, 0);
    expect(sum).toBe(candidate.scoreTotal);
  });

  it("excludes a candidate whose only source is community discussion, and stores no score", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["community_discussion"] });

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    expect("status" in result && result.status).toBe("excluded");
    const candidate = await read(t, candidateId);
    expect(candidate.scoreTotal).toBeUndefined();
    expect(candidate.scoreComponents).toBeUndefined();
  });

  it("clears a previous score when a re-evaluation turns the candidate excluded", async () => {
    const t = setup();
    const { scanId, candidateId, ids } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect((await read(t, candidateId)).scoreTotal).toBeGreaterThan(0);

    // Every source goes dark; the candidate can no longer stand up.
    await t.run(async (ctx) => {
      for (const id of ids) await ctx.db.patch(id, { isAccessible: false });
    });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    expect(candidate.status).toBe("excluded");
    expect(candidate.scoreTotal).toBeUndefined();
  });

  it("refuses to evaluate a candidate that has no stored judgment", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.run(async (ctx) => await ctx.db.patch(candidateId, { judgment: undefined }));

    expect(await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW }))
      .toEqual({ rejected: "no_judgment" });
  });

  it("uses the editor's band over the model's when an editor has overridden it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.run(async (ctx) => await ctx.db.patch(candidateId, {
      judgment: { ...strongJudgment, localityBand: { value: "none", basis: "editor", reason: "set by an editor" } },
    }));

    const result = await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect("status" in result && result.status).toBe("excluded");
    expect("reasons" in result && result.reasons).toContain("weak_locality");
  });

  it("records the independence and coverage counts the engine computed", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["official", "news"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });

    const candidate = await read(t, candidateId);
    expect(candidate.independentCategoryCount).toBe(2);
    expect(candidate.coveragePassStatus).toBe("pending");
  });

  it("never leaves a candidate in processing after evaluating it", async () => {
    const t = setup();
    const { scanId, candidateId } = await seed(t, { families: ["community_discussion"] });
    await t.mutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now: NOW });
    expect((await read(t, candidateId)).status).not.toBe("processing");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/candidate-evaluation.test.ts`
Expected: FAIL — `internal.candidates.evaluate` does not exist.

- [ ] **Step 3: Write `convex/candidates/evaluate.ts`**

```ts
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { COVERAGE_WINDOW_MS } from "../config/ruleset";
import { evaluateCandidate } from "../editorial/status";
import type { CandidateInput, CoverageInput, EngineSource, LocalityBand, RelevanceBand } from "../editorial/types";
import { toEngineSource } from "./toEngineSource";

/**
 * The single writer of a candidate's verdict.
 *
 * Nothing here decides anything. It assembles the input the pure rules engine
 * takes, calls `evaluateCandidate`, and writes back exactly what came out. If a
 * verdict ever looks wrong, the bug is in `convex/editorial/`, not here — and
 * that separation is the whole product claim.
 */
export const evaluate = internalMutation({
  args: { scanId: v.id("scans"), candidateId: v.id("candidates"), now: v.optional(v.number()) },
  returns: v.union(
    v.object({
      status: v.union(v.literal("eligible"), v.literal("excluded")),
      label: v.string(),
      scoreTotal: v.union(v.number(), v.null()),
      reasons: v.array(v.string()),
    }),
    v.object({ rejected: v.union(v.literal("candidate_not_found"), v.literal("no_judgment")) }),
  ),
  handler: async (ctx, { scanId, candidateId, now = Date.now() }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { rejected: "candidate_not_found" as const };

    // No judgment means no bands. Guessing a band is fabricating 40 points.
    const judgment = candidate.judgment;
    if (!judgment) return { rejected: "no_judgment" as const };

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();

    const sources: EngineSource[] = [];
    const coverageReports: CoverageInput["reports"] = [];
    let initiatingSignalAt = now;

    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      if (!row) continue;

      if (membership.role === "coverage") {
        // Coverage reports are counted separately from confirming sources; the
        // 30-day window is what makes a report count as prior coverage at all.
        if (row.publishedAt !== undefined && now - row.publishedAt <= COVERAGE_WINDOW_MS) {
          coverageReports.push({
            id: row._id as string,
            independenceGroup: membership.independenceGroup,
            group: membership.signalCategory === "official_record" ? "general" : "general",
          });
        }
        continue;
      }

      if (membership.role === "initiating" && row.publishedAt !== undefined) initiatingSignalAt = row.publishedAt;

      sources.push(toEngineSource({
        sourceResultId: row._id as string,
        sourceFamily: row.sourceFamily,
        canonicalUrl: row.canonicalUrl,
        publisher: row.publisher ?? null,
        publishedAt: row.publishedAt,
        isAccessible: row.isAccessible,
        role: membership.role,
        independenceGroupOverride: membership.independenceGroup,
        signalCategoryOverride: membership.signalCategory,
        isPromotional: false,
      }));
    }

    const coverage: CoverageInput = {
      partitions: {
        general: candidate.coveragePassStatus === "complete" ? "succeeded" : candidate.coveragePassStatus === "failed" ? "failed" : "pending",
        community: candidate.coveragePassStatus === "complete" ? "succeeded" : candidate.coveragePassStatus === "failed" ? "failed" : "pending",
      },
      reports: coverageReports,
    };

    const input: CandidateInput = {
      localityBand: (judgment.localityBand?.value ?? "none") as LocalityBand,
      relevanceBand: (judgment.relevanceBand?.value ?? "promotion_only") as RelevanceBand,
      beat: (judgment.beat?.value ?? null) as CandidateInput["beat"],
      initiatingSignalAt,
      now,
      sources,
      coverage,
      hasTrendMomentum: sources.some((s) => s.signalCategory === "trend"),
      isDuplicateOfCandidate: judgment.isDuplicateOfCandidate.value,
      isSpeculative: judgment.isSpeculative.value,
      isRoutineCrime: judgment.isRoutineCrime.value,
      hasMaterialConflict: judgment.hasMaterialConflict.value,
    };

    const verdict = evaluateCandidate(input);

    await ctx.db.patch(candidateId, {
      status: verdict.status,
      primaryLabel: verdict.label,
      // Excluded means no score. Not zero, and never a stale score from before.
      scoreTotal: verdict.score?.total,
      scoreComponents: verdict.score?.components,
      independentCategoryCount: verdict.independence.independentCategoryCount,
      coverageOriginalCount: verdict.coverage.originalReportCount,
      coveragePassStatus: verdict.coverage.passStatus,
      updatedAt: Date.now(),
    });

    const appearance = await ctx.db
      .query("candidateAppearances")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .unique();
    if (appearance) {
      await ctx.db.patch(appearance._id, {
        statusAtScan: verdict.status,
        labelAtScan: verdict.label,
        scoreAtScan: verdict.score?.total,
        coverageCountAtScan: verdict.coverage.originalReportCount,
        categoryCountAtScan: verdict.independence.independentCategoryCount,
      });
    }

    return { status: verdict.status, label: verdict.label, scoreTotal: verdict.score?.total ?? null, reasons: verdict.reasons };
  },
});
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx convex codegen && npx vitest run tests/integration/candidate-evaluation.test.ts`
Expected: PASS, 8 tests.

If `scoreTotal: undefined` does not clear a previously set value, Convex needs an explicit `undefined` in the patch — it does accept `undefined` to unset an optional field. Confirm by reading the row, not by assuming.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add convex/candidates/evaluate.ts convex/_generated tests/integration/candidate-evaluation.test.ts
git commit -m "feat(candidates): the rules engine is the only writer of status, label and score (MOO-733)"
```

---

### Task 5: Versioned evidence snapshot

**Files:**
- Create: `convex/candidates/snapshot.ts`
- Create: `tests/integration/evidence-snapshot.test.ts`

**Interfaces:**
- Consumes: `ClassifyEvidenceOutput` from `convex/ai/contracts.ts`; the `evidenceItems` table.
- Produces:
  ```ts
  export const writeSnapshot: internalMutation;
  // args: { scanId, candidateId, items, modelRunId }
  // returns: { evidenceVersion: number; written: number } | { rejected: "candidate_not_found" }
  ```

**Rules this task must hold:**
1. Snapshots are **append-only**. A new snapshot is a new `evidenceVersion`; nothing from an earlier version is edited or deleted.
2. `kind` may never be `confirmed_fact` from this path. Confirmation is computed by the deterministic layer, and this mutation refuses anything else.
3. A source id not in this candidate's membership is refused — the whole write, not just that row.
4. `requiresReverification` is derived from the stored source's `isAccessible`, never from the model.

- [ ] **Step 1: Write the failing test** — `tests/integration/evidence-snapshot.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

async function seed(t: ReturnType<typeof setup>, opts: { accessible?: boolean } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: now, updatedAt: now });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));
    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fp", currentTitle: "T", reportingQuestion: "",
      beat: "housing" as const, status: "processing" as const, primaryLabel: "Worth a look" as const,
      disposition: "new" as const, latestEvidenceVersion: 0,
      independentCategoryCount: 0, coverageOriginalCount: 0, coveragePassStatus: "pending" as const,
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
    });
    const sourceResultId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k", canonicalUrl: "https://jsonline.com/a", originalUrl: "https://jsonline.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "Neighbors question rezoning", snippet: "They say they were not notified.",
      originalLanguage: "en", discoveredAt: now,
      isAccessible: opts.accessible ?? true, contentHash: "h",
    });
    const orphanId = await ctx.db.insert("sourceResults", {
      scanId, searchRunId, ownerId,
      canonicalKey: "k2", canonicalUrl: "https://other.com/a", originalUrl: "https://other.com/a",
      engine: "google" as const, sourceFamily: "news" as const, sourceType: "unknown" as const,
      title: "t", snippet: "s", originalLanguage: "en", discoveredAt: now,
      isAccessible: true, contentHash: "h",
    });
    await ctx.db.insert("candidateSources", {
      candidateId, scanId, sourceResultId, role: "initiating" as const,
      independenceGroup: "host:jsonline.com", signalCategory: "original_news" as const, addedBy: "ai_suggestion" as const,
    });
    const modelRunId = await ctx.db.insert("modelRuns", {
      scanId, candidateId, ownerId, operation: "classifyEvidence" as const,
      idempotencyKey: "k", provider: "anthropic", modelId: "claude-sonnet-5",
      promptVersion: "2", schemaVersion: "1", inputSnapshotHash: "h",
      status: "succeeded" as const, attempt: 1, startedAt: now,
    });
    return { ownerId, scanId, candidateId, sourceResultId, orphanId, modelRunId };
  });
}

const item = (ids: string[], over: Record<string, unknown> = {}) => ({
  sourceResultIds: ids,
  kind: "unverified_signal",
  claimText: "Neighbors say they were not notified.",
  exactExcerpt: null,
  originalLanguageText: null,
  translatedText: null,
  ...over,
});

describe("evidence snapshot", () => {
  it("writes version 1 and moves the candidate's latestEvidenceVersion", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });

    expect(result).toEqual({ evidenceVersion: 1, written: 1 });
    const candidate = (await t.run(async (ctx) => await ctx.db.get(candidateId))) as Doc<"candidates">;
    expect(candidate.latestEvidenceVersion).toBe(1);
  });

  it("appends version 2 without touching version 1", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    const args = { scanId, candidateId, modelRunId, items: [item([sourceResultId])] };

    await t.mutation(internal.candidates.snapshot.writeSnapshot, args);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      ...args, items: [item([sourceResultId], { claimText: "A second look at the same claim." })],
    });

    const rows = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.evidenceVersion).sort()).toEqual([1, 2]);
    expect(rows.find((r) => r.evidenceVersion === 1)?.claimText).toBe("Neighbors say they were not notified.");
  });

  it("refuses the whole snapshot when any kind is confirmed_fact", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId]), item([sourceResultId], { kind: "confirmed_fact" })],
    });

    expect(result).toEqual({ rejected: "cannot_confirm" });
    expect(await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())).toHaveLength(0);
  });

  it("refuses the whole snapshot when an item cites a source outside this candidate", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, orphanId, modelRunId } = await seed(t);

    const result = await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId]), item([orphanId])],
    });

    expect(result).toEqual({ rejected: "source_not_in_candidate" });
    expect(await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())).toHaveLength(0);
  });

  it("marks an item as needing recheck when its source is not reachable", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t, { accessible: false });

    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });

    const rows = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(rows[0].requiresReverification).toBe(true);
  });

  it("records which model run produced the item", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId, items: [item([sourceResultId])],
    });
    const rows = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(rows[0].createdByModelRunId).toBe(modelRunId);
    expect(rows[0].classificationBasis).toBe("ai_suggested");
  });

  it("keeps a translation beside its original", async () => {
    const t = setup();
    const { scanId, candidateId, sourceResultId, modelRunId } = await seed(t);
    await t.mutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId,
      items: [item([sourceResultId], { originalLanguageText: "Se aprobó.", translatedText: "It was approved." })],
    });
    const rows = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(rows[0].originalLanguageText).toBe("Se aprobó.");
    expect(rows[0].translatedText).toBe("It was approved.");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/evidence-snapshot.test.ts`
Expected: FAIL — `internal.candidates.snapshot` does not exist.

- [ ] **Step 3: Write `convex/candidates/snapshot.ts`**

```ts
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import * as V from "../lib/validators";

/**
 * Writes one versioned evidence snapshot.
 *
 * Append-only on purpose: an editor has to be able to see what the system
 * believed last Tuesday, not only what it believes now. Nothing from an earlier
 * version is ever edited or removed.
 */
export const writeSnapshot = internalMutation({
  args: {
    scanId: v.id("scans"),
    candidateId: v.id("candidates"),
    modelRunId: v.id("modelRuns"),
    items: v.array(v.object({
      sourceResultIds: v.array(v.string()),
      kind: v.string(),
      claimText: v.string(),
      exactExcerpt: v.union(v.string(), v.null()),
      originalLanguageText: v.union(v.string(), v.null()),
      translatedText: v.union(v.string(), v.null()),
    })),
  },
  returns: v.union(
    v.object({ evidenceVersion: v.number(), written: v.number() }),
    v.object({ rejected: v.union(
      v.literal("candidate_not_found"),
      v.literal("cannot_confirm"),
      v.literal("source_not_in_candidate"),
    ) }),
  ),
  handler: async (ctx, { scanId, candidateId, modelRunId, items }) => {
    const candidate = await ctx.db.get(candidateId);
    if (!candidate) return { rejected: "candidate_not_found" as const };

    // Confirmation is computed from qualifying sources by the deterministic
    // layer. Nothing arriving through this path may claim it — and one bad item
    // rejects the whole snapshot, because a half-written snapshot is a snapshot
    // an editor would trust.
    if (items.some((i) => i.kind === "confirmed_fact")) return { rejected: "cannot_confirm" as const };

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_scan", (q) => q.eq("candidateId", candidateId).eq("scanId", scanId))
      .collect();
    const memberIds = new Set(memberships.map((m) => m.sourceResultId as string));
    if (items.some((i) => i.sourceResultIds.some((id) => !memberIds.has(id)))) {
      return { rejected: "source_not_in_candidate" as const };
    }

    const accessibleById = new Map<string, boolean>();
    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      accessibleById.set(membership.sourceResultId as string, row?.isAccessible ?? false);
    }

    const evidenceVersion = candidate.latestEvidenceVersion + 1;
    for (const item of items) {
      await ctx.db.insert("evidenceItems", {
        candidateId, scanId, ownerId: candidate.ownerId,
        evidenceVersion,
        kind: item.kind as never,
        claimText: item.claimText,
        sourceResultIds: item.sourceResultIds as Id<"sourceResults">[],
        exactExcerpt: item.exactExcerpt ?? undefined,
        originalLanguageText: item.originalLanguageText ?? undefined,
        translatedText: item.translatedText ?? undefined,
        classificationBasis: "ai_suggested",
        // Derived from the stored source, never from the model's opinion of it.
        requiresReverification: item.sourceResultIds.some((id) => accessibleById.get(id) === false),
        createdByModelRunId: modelRunId,
      });
    }

    await ctx.db.patch(candidateId, { latestEvidenceVersion: evidenceVersion, updatedAt: Date.now() });
    return { evidenceVersion, written: items.length };
  },
});
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx convex codegen && npx vitest run tests/integration/evidence-snapshot.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add convex/candidates/snapshot.ts convex/_generated tests/integration/evidence-snapshot.test.ts
git commit -m "feat(candidates): append-only versioned evidence snapshots (MOO-733)"
```

---

### Task 6: The end-to-end fixture pipeline

**Files:**
- Create: `convex/slice.ts`
- Create: `tests/fixtures/slice.ts`
- Create: `tests/integration/evidence-brief-vertical-slice.test.ts`

**Interfaces:**
- Consumes: `runClusterSignals`, `runClassifyEvidence`, `runGenerateBrief` from `convex/ai/`; `formFromCluster` (Task 2), `saveJudgment` (Task 3), `evaluate` (Task 4), `writeSnapshot` (Task 5).
- Produces:
  ```ts
  export async function runSliceForScan(
    ctx: ActionCtx,
    args: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[]; now?: number },
    generate?: GenerateFn,
  ): Promise<SliceOutcome>;

  export type SliceOutcome = {
    candidates: Array<{
      candidateId: Id<"candidates">;
      status: "eligible" | "excluded";
      label: string;
      scoreTotal: number | null;
      evidenceVersion: number | null;
      briefId: Id<"briefVersions"> | null;
      failures: string[];
    }>;
  };

  export const runSlice: internalAction; // one-line wrapper, no `generate` arg
  ```

**Why a plain function plus a wrapper:** Convex validates action arguments before the handler runs, so a function value can never travel through `args`. Tests reach the pipeline by calling `runSliceForScan` directly with a fake model. This is the same shape as `runExecuteSearch` and the five AI operations; do not invent a different one.

- [ ] **Step 1: Write the fixture** — `tests/fixtures/slice.ts`

```ts
import type { Id } from "../../convex/_generated/dataModel";

/**
 * One captured Milwaukee candidate packet: an official agenda record, an English
 * news story, a Spanish news story from a different outlet, and an r/milwaukee
 * comment thread. Chosen so the slice exercises every branch the demo shows —
 * two independent confirming categories, a bilingual source, and a community
 * post that must stay non-confirming.
 */
export const SLICE_SOURCES = [
  {
    key: "official",
    sourceFamily: "official" as const,
    canonicalUrl: "https://city.milwaukee.gov/agenda/250412",
    title: "Common Council agenda item 250412",
    snippet: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
    publisher: null,
    originalLanguage: "en",
    engine: "google" as const,
  },
  {
    key: "news",
    sourceFamily: "news" as const,
    canonicalUrl: "https://jsonline.com/story/harambee-rezoning",
    title: "Neighbors question Harambee rezoning timeline",
    snippet: "Residents say they learned of the proposal a week before the vote.",
    publisher: "Milwaukee Journal Sentinel",
    originalLanguage: "en",
    engine: "google_news" as const,
  },
  {
    key: "spanish",
    sourceFamily: "news" as const,
    canonicalUrl: "https://elconquistador.example/rezonificacion-harambee",
    title: "Vecinos cuestionan la rezonificación de Harambee",
    snippet: "Los residentes dicen que se enteraron una semana antes de la votación.",
    publisher: "El Conquistador",
    originalLanguage: "es",
    engine: "google" as const,
  },
  {
    key: "reddit",
    sourceFamily: "community_discussion" as const,
    canonicalUrl: "https://reddit.com/r/milwaukee/comments/abc123/harambee_rezoning",
    title: "Anyone know what's happening with the Harambee rezoning?",
    snippet: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
    publisher: null,
    originalLanguage: "en",
    engine: "google" as const,
  },
] as const;

export type SliceSourceKey = (typeof SLICE_SOURCES)[number]["key"];

/** Builds the fake model's answers, keyed to whatever ids the test actually inserted. */
export function sliceModelAnswers(ids: Record<SliceSourceKey, Id<"sourceResults">>) {
  return {
    clusterSignals: {
      clusters: [{
        sourceResultIds: [ids.official, ids.news, ids.spanish, ids.reddit] as string[],
        similarityBasis: "All four describe the same Common Council rezoning item in Harambee.",
        entityKeys: ["Harambee", "rezoning", "Common Council"],
        suggestedExistingCandidateId: null,
      }],
    },
    classifyEvidence: {
      beatSuggestion: "housing",
      localityBandSuggestion: "area_city_consequence",
      relevanceBandSuggestion: "policy_service_change",
      flags: { isSpeculative: false, isRoutineCrime: false, isDuplicateOfCandidate: false, hasMaterialConflict: false },
      items: [
        {
          sourceResultIds: [ids.official as string],
          kind: "existing_coverage",
          claimText: "The rezoning is agenda item 250412.",
          exactExcerpt: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
          originalLanguageText: null, translatedText: null,
          sourceTypeSuggestion: "primary", independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "The parcel is in Milwaukee's Harambee neighborhood.",
          accessibilityConcern: false, repeatsPressRelease: false,
          reason: "The council's own agenda names the item.",
        },
        {
          sourceResultIds: [ids.news as string],
          kind: "unverified_signal",
          claimText: "Residents say they learned of the proposal a week before the vote.",
          exactExcerpt: "Residents say they learned of the proposal a week before the vote.",
          originalLanguageText: null, translatedText: null,
          sourceTypeSuggestion: "secondary", independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "Reported by a Milwaukee outlet about a Milwaukee parcel.",
          accessibilityConcern: false, repeatsPressRelease: false,
          reason: "One local outlet reported it; nobody else has yet.",
        },
        {
          sourceResultIds: [ids.spanish as string],
          kind: "unverified_signal",
          claimText: "Neighbors say they were notified a week before the vote.",
          exactExcerpt: null,
          originalLanguageText: "Los residentes dicen que se enteraron una semana antes de la votación.",
          translatedText: "Residents say they found out a week before the vote.",
          sourceTypeSuggestion: "secondary", independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "A Spanish-language Milwaukee outlet covering the same parcel.",
          accessibilityConcern: false, repeatsPressRelease: false,
          reason: "Independent outlet, same claim.",
        },
        {
          sourceResultIds: [ids.reddit as string],
          kind: "potential_source",
          claimText: "A resident reports surveyors on MLK Drive.",
          exactExcerpt: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
          originalLanguageText: null, translatedText: null,
          sourceTypeSuggestion: "discussion", independenceGroupSuggestion: null,
          relationship: "supports",
          milwaukeeConnection: "Posted in r/milwaukee about an MLK Drive block.",
          accessibilityConcern: false, repeatsPressRelease: false,
          reason: "Community discussion. Never confirmation — a lead to call, not a fact.",
        },
      ],
    },
    generateBrief: {
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      whySurfaced: "An official agenda item and two independent local outlets describe the same rezoning.",
      confirmedFacts: [],
      unverifiedClaims: [{
        text: "Residents say they learned of the proposal a week before the vote.",
        sourceResultIds: [ids.news as string],
        exactExcerpt: "Residents say they learned of the proposal a week before the vote.",
      }],
      conflicts: [],
      existingCoverage: [],
      potentialHumanSources: [{
        text: "A resident who saw surveyors on MLK Drive.",
        sourceResultIds: [ids.reddit as string],
        exactExcerpt: null,
      }],
      interviewQuestions: [
        "How much notice does the city owe residents before a rezoning vote?",
        "Who signed off on the notification schedule for item 250412?",
      ],
    },
  };
}
```

- [ ] **Step 2: Write `convex/slice.ts`**

```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { runClassifyEvidence } from "./ai/classifyEvidence";
import { runClusterSignals } from "./ai/clusterSignals";
import { runGenerateBrief } from "./ai/generateBrief";
import type { GenerateFn } from "./ai/provider";

/**
 * One captured scan, end to end: cluster the results, form candidates, classify
 * the evidence, snapshot it, let the RULES decide, then write the brief.
 *
 * Ordering is the point. Evaluation runs before the brief, so the brief is
 * generated against a candidate whose confirmed sources were settled by
 * `evaluateCandidate` and not by anything a model said.
 *
 * Extracted from the internalAction wrapper so tests inject a fake model: Convex
 * validates action args before the handler runs, so a function value can never
 * travel through `args`.
 */

export type SliceCandidateOutcome = {
  candidateId: Id<"candidates">;
  status: "eligible" | "excluded";
  label: string;
  scoreTotal: number | null;
  evidenceVersion: number | null;
  briefId: Id<"briefVersions"> | null;
  failures: string[];
};

export type SliceOutcome = { ok: true; candidates: SliceCandidateOutcome[] } | { ok: false; reason: string; errors: string[] };

export async function runSliceForScan(
  ctx: ActionCtx,
  { scanId, sourceResultIds, now = Date.now() }: { scanId: Id<"scans">; sourceResultIds: Id<"sourceResults">[]; now?: number },
  generate?: GenerateFn,
): Promise<SliceOutcome> {
  const signals = sourceResultIds.map((id) => ({ sourceResultId: id, entityKeys: [], claimSummary: "" }));
  const clustered = await runClusterSignals(ctx, { scanId, signals }, generate);
  if (!clustered.ok) return { ok: false, reason: clustered.reason, errors: clustered.errors };

  const candidates: SliceCandidateOutcome[] = [];

  for (const cluster of clustered.clusters) {
    const failures: string[] = [];

    const formed = await ctx.runMutation(internal.candidates.form.formFromCluster, {
      scanId, cluster,
      // The rules engine takes a beat; the model's beat suggestion arrives with
      // classification a moment later and can move it.
      beat: "housing",
      workingTitle: cluster.similarityBasis.slice(0, 120),
    });
    if ("rejected" in formed) continue;
    const { candidateId } = formed;

    const memberIds = cluster.sourceResultIds as Id<"sourceResults">[];

    const classified = await runClassifyEvidence(ctx, { scanId, candidateId, sourceResultIds: memberIds }, generate);
    if (!classified.ok) {
      candidates.push({ candidateId, status: "excluded", label: "Worth a look", scoreTotal: null, evidenceVersion: null, briefId: null, failures: [`classify: ${classified.reason}`] });
      continue;
    }

    await ctx.runMutation(internal.candidates.judgment.saveJudgment, {
      candidateId,
      judgment: {
        localityBand: classified.judgment.localityBand,
        relevanceBand: classified.judgment.relevanceBand,
        beat: classified.judgment.beat,
        isSpeculative: classified.judgment.isSpeculative,
        isRoutineCrime: classified.judgment.isRoutineCrime,
        isDuplicateOfCandidate: classified.judgment.isDuplicateOfCandidate,
        hasMaterialConflict: classified.judgment.hasMaterialConflict,
      },
    });

    const snapshot = await ctx.runMutation(internal.candidates.snapshot.writeSnapshot, {
      scanId, candidateId, modelRunId: classified.modelRunId,
      items: classified.suggestions.items.map((i) => ({
        sourceResultIds: i.sourceResultIds,
        kind: i.kind,
        claimText: i.claimText,
        exactExcerpt: i.exactExcerpt,
        originalLanguageText: i.originalLanguageText,
        translatedText: i.translatedText,
      })),
    });
    const evidenceVersion = "evidenceVersion" in snapshot ? snapshot.evidenceVersion : null;
    if ("rejected" in snapshot) failures.push(`snapshot: ${snapshot.rejected}`);

    // The rules decide, and they decide BEFORE the brief is written.
    const verdict = await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });
    if ("rejected" in verdict) {
      candidates.push({ candidateId, status: "excluded", label: "Worth a look", scoreTotal: null, evidenceVersion, briefId: null, failures: [...failures, `evaluate: ${verdict.rejected}`] });
      continue;
    }

    let briefId: Id<"briefVersions"> | null = null;
    const brief = await runGenerateBrief(ctx, { scanId, candidateId }, generate);
    if (brief.ok) briefId = brief.briefId;
    // "already_generated" means the identical brief exists; that is a success,
    // not a failure, and it deliberately costs no model call.
    else if (brief.reason !== "already_generated") failures.push(`brief: ${brief.reason}`);

    candidates.push({
      candidateId, status: verdict.status, label: verdict.label,
      scoreTotal: verdict.scoreTotal, evidenceVersion, briefId, failures,
    });
  }

  return { ok: true, candidates };
}

export const runSlice = internalAction({
  args: { scanId: v.id("scans"), sourceResultIds: v.array(v.id("sourceResults")) },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      candidates: v.array(v.object({
        candidateId: v.id("candidates"),
        status: v.union(v.literal("eligible"), v.literal("excluded")),
        label: v.string(),
        scoreTotal: v.union(v.number(), v.null()),
        evidenceVersion: v.union(v.number(), v.null()),
        briefId: v.union(v.id("briefVersions"), v.null()),
        failures: v.array(v.string()),
      })),
    }),
    v.object({ ok: v.literal(false), reason: v.string(), errors: v.array(v.string()) }),
  ),
  handler: async (ctx, args) => await runSliceForScan(ctx, args),
});
```

- [ ] **Step 3: Write the failing integration test** — `tests/integration/evidence-brief-vertical-slice.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import { runSliceForScan } from "../../convex/slice";
import { SLICE_SOURCES, sliceModelAnswers, type SliceSourceKey } from "../fixtures/slice";
import { scanDoc, searchRunDoc } from "../fixtures/factories";
import { setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

/** Answers the fake model gives, chosen by which operation the prompt names. */
function scriptedModel(answers: ReturnType<typeof sliceModelAnswers>): GenerateFn {
  return async ({ system }) => {
    const object =
      /Group the supplied signals/.test(system) ? answers.clusterSignals
      : /suggest how each piece of evidence/.test(system) ? answers.classifyEvidence
      : answers.generateBrief;
    return { object, usage: { inputTokens: 100, outputTokens: 50 } };
  };
}

async function seedScan(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", searchRunDoc(scanId, ownerId));

    const ids = {} as Record<SliceSourceKey, Id<"sourceResults">>;
    for (const [i, source] of SLICE_SOURCES.entries()) {
      ids[source.key] = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`, canonicalUrl: source.canonicalUrl, originalUrl: source.canonicalUrl,
        engine: source.engine, sourceFamily: source.sourceFamily, sourceType: "unknown" as const,
        title: source.title, snippet: source.snippet,
        publisher: source.publisher ?? undefined,
        originalLanguage: source.originalLanguage,
        publishedAt: NOW - DAY, discoveredAt: NOW,
        isAccessible: true, contentHash: `h${i}`,
      });
    }
    return { ownerId, scanId, ids };
  });
}

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("evidence-to-brief vertical slice", () => {
  it("takes one captured packet from source results to a written brief", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    const model = scriptedModel(sliceModelAnswers(ids));

    const outcome = await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, model));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates).toHaveLength(1);

    const [candidate] = outcome.candidates;
    expect(candidate.failures).toEqual([]);
    expect(candidate.evidenceVersion).toBe(1);
    expect(candidate.briefId).not.toBeNull();
  });

  it("lets the RULES set the verdict, overruling the model's weaker locality guess", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const candidate = (await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0])) as Doc<"candidates">;
    // The model suggested "area_city_consequence"; an official Milwaukee domain
    // is among the sources, so the deterministic rule wins.
    expect(candidate.judgment?.localityBand?.value).toBe("direct_city");
    expect(candidate.judgment?.localityBand?.basis).toBe("deterministic");
  });

  it("counts two independent confirming categories and keeps Reddit out of them", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const candidate = (await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0])) as Doc<"candidates">;
    expect(candidate.independentCategoryCount).toBe(2);
    expect(candidate.status).toBe("eligible");
  });

  it("writes no confirmed fact, because the model was never allowed to claim one", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const evidence = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    expect(evidence.every((e) => e.kind !== "confirmed_fact")).toBe(true);
  });

  it("puts OUR cautious sentence in the empty confirmed-facts section of the brief", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const brief = (await t.run(async (ctx) => (await ctx.db.query("briefVersions").collect())[0])) as Doc<"briefVersions">;
    expect(brief.confirmedFacts).toHaveLength(1);
    expect(brief.confirmedFacts[0].sourceResultIds).toEqual([]);
    expect(brief.confirmedFacts[0].text).toMatch(/independently confirmed/i);
  });

  it("keeps the Spanish original beside its translation all the way into the snapshot", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, scriptedModel(sliceModelAnswers(ids))));

    const evidence = (await t.run(async (ctx) => await ctx.db.query("evidenceItems").collect())) as Doc<"evidenceItems">[];
    const bilingual = evidence.find((e) => e.translatedText !== undefined);
    expect(bilingual?.originalLanguageText).toMatch(/residentes/);
    expect(bilingual?.translatedText).toMatch(/residents/i);

    const spanishSource = (await t.run(async (ctx) => await ctx.db.get(ids.spanish))) as Doc<"sourceResults">;
    expect(spanishSource.title).toBe(SLICE_SOURCES[2].title);
  });

  it("running it twice does not duplicate the candidate, the brief, or the spend", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    let calls = 0;
    const answers = sliceModelAnswers(ids);
    const counting: GenerateFn = async (args) => { calls++; return await scriptedModel(answers)(args); };

    await t.action(async (ctx) => await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, counting));
    const firstCalls = calls;
    await t.action(async (ctx) => await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, counting));

    const { candidates, briefs } = await t.run(async (ctx) => ({
      candidates: await ctx.db.query("candidates").collect(),
      briefs: await ctx.db.query("briefVersions").collect(),
    }));
    expect(candidates).toHaveLength(1);
    expect(briefs).toHaveLength(1);
    // The second pass asks the model strictly fewer times than the first.
    expect(calls - firstCalls).toBeLessThan(firstCalls);
  });

  it("reports a failure per candidate instead of throwing when the model output is unusable", async () => {
    const t = setup();
    const { scanId, ids } = await seedScan(t);
    const answers = sliceModelAnswers(ids);
    const broken: GenerateFn = async ({ system }) => {
      if (/suggest how each piece of evidence/.test(system)) {
        return { object: { ...answers.classifyEvidence, items: [] }, usage: {} };
      }
      return await scriptedModel(answers)({ system } as never);
    };

    const outcome = await t.action(async (ctx) =>
      await runSliceForScan(ctx, { scanId, sourceResultIds: Object.values(ids), now: NOW }, broken));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidates[0].failures.join(" ")).toMatch(/classify/);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx convex codegen && npx vitest run tests/integration/evidence-brief-vertical-slice.test.ts`
Expected: PASS, 8 tests.

If the scripted model picks the wrong answer, print `system` in the fake and match on the actual instruction text in `convex/ai/prompts.ts` — do not loosen an assertion to make it pass.

- [ ] **Step 5: Typecheck, lint, full suite, deploy**

Run: `npm run typecheck && npm run lint && npm test`
Then: `set -a; . ./.env.local; set +a; npx convex dev --once`
Expected: all green, deploy succeeds.

- [ ] **Step 6: Commit**

```bash
git add convex/slice.ts convex/_generated tests/fixtures/slice.ts tests/integration/evidence-brief-vertical-slice.test.ts
git commit -m "feat(slice): one captured packet from source results to a written brief (MOO-733)"
```

---

### Task 7: The evidence read query

**Files:**
- Create: `convex/evidence.ts`
- Create: `src/lib/evidence-view.ts`
- Create: `tests/integration/evidence-query.test.ts`

**Interfaces:**
- Consumes: everything Tasks 2–6 wrote.
- Produces:
  ```ts
  export const forCandidate: query; // args: { candidateId } -> EvidenceView | null
  ```
  and in `src/lib/evidence-view.ts`:
  ```ts
  export type EvidenceView = {
    candidate: { id, title, reportingQuestion, beat, status, label, disposition, scoreTotal, updatedAt };
    judgment: JudgmentRecord | null;
    score: { total: number; components: Array<{ key, label, points, max, bandId, reason }> } | null;
    whySurfaced: Array<{ category, label, sourceResultId, title, publisher, publishedAt }>;
    evidence: Array<{ id, kind, claimText, exactExcerpt, originalLanguageText, translatedText, requiresReverification, sources: EvidenceSource[] }>;
    coverage: { passStatus, originalReportCount, gapAllowed, reports: EvidenceSource[] };
    brief: { version, reportingQuestion, whySurfaced, sections: Record<string, Block[]>, interviewQuestions, modelRunId } | null;
    queryLog: Array<{ templateId, purpose, engine, query, status, resultCount, durationMs }>;
  };
  export type EvidenceSource = {
    sourceResultId, title, snippet, canonicalUrl, publisher, publishedAt,
    sourceFamily, sourceType, originalLanguage, translatedTitle, translatedSnippet,
    isAccessible, role, signalCategory, independenceGroup,
    foundByQuery: string | null,
  };
  ```

**Rules this task must hold:**
1. Owner-scoped. A candidate belonging to someone else returns `null`, not a partial view.
2. `rawStorageId` is never in the return validator. Not optional — absent.
3. `foundByQuery` is the **stored** `searchRuns.query` for the run that produced the source. That is the traceability chain's last link and it must be the executed text, not a reconstruction.
4. Only the **latest** `evidenceVersion` is returned. Earlier versions exist and are reachable later (item 9's history); this view is the current snapshot.
5. An inaccessible source stays in the list, marked. It never disappears.

- [ ] **Step 1: Write the failing test** — `tests/integration/evidence-query.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GenerateFn } from "../../convex/ai/provider";
import { runSliceForScan } from "../../convex/slice";
import { SLICE_SOURCES, sliceModelAnswers, type SliceSourceKey } from "../fixtures/slice";
import { scanDoc } from "../fixtures/factories";
import { asUser, setup } from "./helpers";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const QUERY_TEXT = 'site:city.milwaukee.gov "Harambee rezoning"';

function scriptedModel(answers: ReturnType<typeof sliceModelAnswers>): GenerateFn {
  return async ({ system }) => ({
    object:
      /Group the supplied signals/.test(system) ? answers.clusterSignals
      : /suggest how each piece of evidence/.test(system) ? answers.classifyEvidence
      : answers.generateBrief,
    usage: { inputTokens: 10, outputTokens: 5 },
  });
}

async function seedAndRun(t: ReturnType<typeof setup>) {
  const seeded = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("users", { clerkUserId: "stranger", createdAt: NOW, updatedAt: NOW });
    const scanId = await ctx.db.insert("scans", scanDoc(ownerId) as never);
    const searchRunId = await ctx.db.insert("searchRuns", {
      scanId, ownerId, idempotencyKey: "idem", templateId: "official-housing-01",
      queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google" as const,
      query: QUERY_TEXT, parameters: { gl: "us", hl: "en" }, language: "en" as const,
      status: "succeeded" as const, attemptCount: 1, resultCount: 4, durationMs: 800,
      reservedAt: NOW, completedAt: NOW,
    });

    const ids = {} as Record<SliceSourceKey, Id<"sourceResults">>;
    for (const [i, source] of SLICE_SOURCES.entries()) {
      ids[source.key] = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `k${i}`, canonicalUrl: source.canonicalUrl, originalUrl: source.canonicalUrl,
        engine: source.engine, sourceFamily: source.sourceFamily, sourceType: "unknown" as const,
        title: source.title, snippet: source.snippet,
        publisher: source.publisher ?? undefined,
        originalLanguage: source.originalLanguage,
        publishedAt: NOW - DAY, discoveredAt: NOW,
        isAccessible: source.key !== "reddit", contentHash: `h${i}`,
      });
    }
    return { ownerId, scanId, ids };
  });

  await t.action(async (ctx) =>
    await runSliceForScan(ctx, { scanId: seeded.scanId, sourceResultIds: Object.values(seeded.ids), now: NOW },
      scriptedModel(sliceModelAnswers(seeded.ids))));

  const candidateId = await t.run(async (ctx) => (await ctx.db.query("candidates").collect())[0]._id);
  return { ...seeded, candidateId };
}

beforeEach(() => {
  process.env.AI_PRIMARY_MODEL = "claude-sonnet-5";
  process.env.AI_FALLBACK_ENABLED = "false";
});

describe("evidence.forCandidate", () => {
  it("returns null to a signed-in user who does not own the candidate", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    expect(await asUser(t, "stranger").query(api.evidence.forCandidate, { candidateId })).toBeNull();
  });

  it("gives the owner the whole view in one call", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });

    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.candidate.status).toBe("eligible");
    expect(view.evidence.length).toBeGreaterThan(0);
    expect(view.brief).not.toBeNull();
    expect(view.queryLog.length).toBeGreaterThan(0);
  });

  it("shows why this surfaced with at least two distinct categories", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const categories = new Set(view.whySurfaced.map((w) => w.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it("traces every evidence source back to the exact executed query", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const sources = view.evidence.flatMap((e) => e.sources);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source.foundByQuery).toBe(QUERY_TEXT);
  });

  it("returns all five score components with their bands", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.score?.components).toHaveLength(5);
    expect(view.score?.components.map((c) => c.key).sort()).toEqual([
      "coverageScarcity", "crossSource", "freshness", "milwaukeeEvidence", "relevance",
    ]);
    expect(view.score?.components.reduce((sum, c) => sum + c.points, 0)).toBe(view.score?.total);
  });

  it("keeps an unreachable source visible rather than dropping it", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    const sources = view.evidence.flatMap((e) => e.sources);
    expect(sources.some((s) => !s.isAccessible)).toBe(true);
  });

  it("says plainly whether a coverage gap is allowed", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.coverage.passStatus).toBe("pending");
    // A coverage pass that has not completed can never support a gap claim.
    expect(view.coverage.gapAllowed).toBe(false);
  });

  it("carries the judgment basis so an editor can ask who decided", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    if (!view) throw new Error("no view");

    expect(view.judgment?.localityBand?.basis).toBe("deterministic");
  });

  it("never returns a raw storage id", async () => {
    const t = setup();
    const { candidateId } = await seedAndRun(t);
    const view = await asUser(t, "owner").query(api.evidence.forCandidate, { candidateId });
    expect(JSON.stringify(view)).not.toMatch(/rawStorageId/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/evidence-query.test.ts`
Expected: FAIL — `api.evidence` does not exist.

- [ ] **Step 3: Write `convex/evidence.ts`**

Build the return validator field-for-field against the `EvidenceView` type above. The shape below is the handler; write the `returns` validator to match it exactly, since Convex checks it at runtime and a mismatch is the fastest way to find a typo.

```ts
import { v } from "convex/values";
import { query } from "./_generated/server";
import { coverageGapAllowed } from "./editorial/coverage";
import { requireUser } from "./lib/auth";
import * as V from "./lib/validators";

const SCORE_LABELS = {
  milwaukeeEvidence: "Milwaukee evidence",
  crossSource: "Independent sources",
  freshness: "Freshness",
  coverageScarcity: "Coverage scarcity",
  relevance: "Beat relevance",
} as const;

const CATEGORY_LABELS = {
  official_record: "Official record",
  original_news: "Local reporting",
  event: "Public event",
  video: "Video",
  map: "Place",
  community_discussion: "Community discussion",
  public_web: "Public web",
  trend: "Search trend",
} as const;

/**
 * One owner-scoped read that assembles the whole evidence view.
 *
 * It is one query on purpose: the demo's central move is opening a lead and
 * following a fact backward, and a view stitched from six round trips shows a
 * different set of half-loaded panels every time.
 *
 * `rawStorageId` is absent from the return validator, not optional. Raw SerpApi
 * JSON never reaches a browser.
 */
export const forCandidate = query({
  args: { candidateId: v.id("candidates") },
  // returns: write the validator to match the handler's shape exactly.
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, { candidateId }) => {
    const user = await requireUser(ctx);
    const candidate = await ctx.db.get(candidateId);
    if (!candidate || candidate.ownerId !== user._id) return null;

    const memberships = await ctx.db
      .query("candidateSources")
      .withIndex("by_candidate_role", (q) => q.eq("candidateId", candidateId))
      .collect();

    // Source detail, plus the exact query text that found each one. That last
    // link is what makes the trace end at something a person can re-run.
    const sourceById = new Map<string, Record<string, unknown>>();
    const queryLog: Record<string, unknown>[] = [];
    const seenRuns = new Set<string>();

    for (const membership of memberships) {
      const row = await ctx.db.get(membership.sourceResultId);
      if (!row) continue;
      const run = await ctx.db.get(row.searchRunId);
      if (run && !seenRuns.has(run._id as string)) {
        seenRuns.add(run._id as string);
        queryLog.push({
          templateId: run.templateId, purpose: run.purpose, engine: run.engine,
          query: run.query, status: run.status, resultCount: run.resultCount, durationMs: run.durationMs,
        });
      }
      sourceById.set(row._id as string, {
        sourceResultId: row._id, title: row.title, snippet: row.snippet,
        canonicalUrl: row.canonicalUrl, publisher: row.publisher ?? null,
        publishedAt: row.publishedAt ?? null,
        sourceFamily: row.sourceFamily, sourceType: row.sourceType,
        originalLanguage: row.originalLanguage,
        translatedTitle: row.translatedTitle ?? null, translatedSnippet: row.translatedSnippet ?? null,
        isAccessible: row.isAccessible,
        role: membership.role, signalCategory: membership.signalCategory,
        independenceGroup: membership.independenceGroup,
        foundByQuery: run?.query ?? null,
      });
    }

    const allEvidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .collect();
    const latestVersion = candidate.latestEvidenceVersion;
    const evidence = allEvidence
      .filter((e) => e.evidenceVersion === latestVersion)
      .map((e) => ({
        id: e._id, kind: e.kind, claimText: e.claimText,
        exactExcerpt: e.exactExcerpt ?? null,
        originalLanguageText: e.originalLanguageText ?? null,
        translatedText: e.translatedText ?? null,
        requiresReverification: e.requiresReverification,
        sources: e.sourceResultIds.map((id) => sourceById.get(id as string)).filter(Boolean),
      }));

    // `Why this surfaced` is the convergence: one entry per distinct signal
    // category among the confirming, non-coverage sources.
    const whySurfaced = [...new Map(
      [...sourceById.values()]
        .filter((s) => s.role !== "coverage")
        .map((s) => [s.signalCategory as string, {
          category: s.signalCategory,
          label: CATEGORY_LABELS[s.signalCategory as keyof typeof CATEGORY_LABELS],
          sourceResultId: s.sourceResultId, title: s.title,
          publisher: s.publisher, publishedAt: s.publishedAt,
        }]),
    ).values()];

    const score = candidate.scoreTotal === undefined || candidate.scoreComponents === undefined ? null : {
      total: candidate.scoreTotal,
      components: (Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((key) => ({
        key,
        label: SCORE_LABELS[key],
        ...candidate.scoreComponents![key],
      })),
    };

    const coverageSources = [...sourceById.values()].filter((s) => s.role === "coverage");
    const coverage = {
      passStatus: candidate.coveragePassStatus,
      originalReportCount: candidate.coverageOriginalCount,
      gapAllowed: coverageGapAllowed({
        passStatus: candidate.coveragePassStatus,
        originalReportCount: candidate.coverageOriginalCount,
      } as never),
      reports: coverageSources,
    };

    const briefs = await ctx.db
      .query("briefVersions")
      .withIndex("by_candidate_version", (q) => q.eq("candidateId", candidateId))
      .order("desc")
      .take(1);
    const brief = briefs[0] ? {
      version: briefs[0].version,
      reportingQuestion: briefs[0].reportingQuestion,
      whySurfaced: briefs[0].whySurfaced,
      sections: {
        confirmedFacts: briefs[0].confirmedFacts,
        unverifiedClaims: briefs[0].unverifiedClaims,
        conflicts: briefs[0].conflicts,
        existingCoverage: briefs[0].existingCoverage,
        potentialHumanSources: briefs[0].potentialHumanSources,
      },
      interviewQuestions: briefs[0].interviewQuestions,
      modelRunId: briefs[0].modelRunId ?? null,
    } : null;

    return {
      candidate: {
        id: candidate._id, title: candidate.currentTitle,
        reportingQuestion: brief?.reportingQuestion ?? candidate.reportingQuestion,
        beat: candidate.beat, status: candidate.status, label: candidate.primaryLabel,
        disposition: candidate.disposition, scoreTotal: candidate.scoreTotal ?? null,
        updatedAt: candidate.updatedAt,
      },
      judgment: candidate.judgment ?? null,
      score, whySurfaced, evidence, coverage, brief, queryLog,
    };
  },
});
```

- [ ] **Step 4: Replace `v.any()` with the real validator**

`v.any()` is a placeholder to get the handler running; a public query with `v.any()` is not acceptable in this codebase. Write the full object validator now, mirroring the handler's return shape field for field, and re-run the test. The runtime validator failing is how you find a field you forgot.

- [ ] **Step 5: Write `src/lib/evidence-view.ts`**

```ts
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/**
 * The components take their types from the query itself, so a field renamed in
 * Convex breaks the build rather than rendering blank.
 */
export type EvidenceView = NonNullable<FunctionReturnType<typeof api.evidence.forCandidate>>;
export type EvidenceSource = EvidenceView["evidence"][number]["sources"][number];
export type EvidenceEntry = EvidenceView["evidence"][number];
export type ScoreComponentView = NonNullable<EvidenceView["score"]>["components"][number];
export type BriefView = NonNullable<EvidenceView["brief"]>;
```

- [ ] **Step 6: Run the test, typecheck, lint, deploy**

Run: `npx convex codegen && npx vitest run tests/integration/evidence-query.test.ts && npm run typecheck && npm run lint`
Then: `set -a; . ./.env.local; set +a; npx convex dev --once`
Expected: PASS, 9 tests; deploy succeeds.

- [ ] **Step 7: Commit**

```bash
git add convex/evidence.ts src/lib/evidence-view.ts convex/_generated tests/integration/evidence-query.test.ts
git commit -m "feat(evidence): one owner-scoped query that assembles the whole evidence view (MOO-733)"
```

---

### Task 8: The evidence components

**Files:**
- Create: `src/components/evidence/lead-card.tsx`, `why-this-surfaced.tsx`, `evidence-item.tsx`, `citation-trace.tsx`, `coverage-audit.tsx`, `score-breakdown.tsx`, `reporting-brief.tsx`, `evidence-view.tsx`
- Create: `src/app/workspace/leads/[candidateId]/page.tsx`
- Modify: `THIRD_PARTY_NOTICES.md` **only if** a new Untitled UI primitive is copied

**Interfaces:**
- Consumes: the types in `src/lib/evidence-view.ts` (Task 7); `StatusLabel` from `src/components/ui/editorial/status-label.tsx`; `PRODUCT_LABELS`, `BEAT_TEXT` from `src/lib/source-labels.ts`; `Badge` and `Button` from `src/components/ui/untitled/`.
- Produces: the seven named components, each a default-exported named function taking exactly one typed prop.

**Rules this task must hold:**
1. **Server components by default.** Only `evidence-view.tsx` needs `"use client"`, because it owns the expand/collapse state. The rest are pure rendering.
2. Colors come from tokens. Search `src/styles/theme.css` before typing any color; there is no ad-hoc hex.
3. Every status is legible without color. `StatusLabel` prints the word.
4. Confirmed facts and AI-drafted prose are **visually distinct** — the spec requires it. Use a rule and a label, not a colour difference alone.
5. A brief section carrying our empty-section sentence (`sourceResultIds: []`) renders as an **absence note**, never as a cited claim.
6. `ReportingBrief` carries a visible "AI-drafted editorial assistance — not a publishable story" label. This is the item-7 deliverable that closes the gap left open in item 6.
7. Section order is exactly the spec's: question/disposition; score breakdown; `Why this surfaced`; confirmed facts; unverified signals; conflicts; reverification; coverage; potential human sources; query log; brief versions.

- [ ] **Step 1: Check what primitives already exist**

Run: `ls src/components/ui/untitled/ && cat THIRD_PARTY_NOTICES.md`
Only `badge.tsx` and `button.tsx` are vendored today. If you need another primitive, copy it from Untitled UI **MIT** only, and add it to `THIRD_PARTY_NOTICES.md` **in this same commit**. If plain semantic HTML plus tokens will do, use that instead — a `<dl>` is not worth a dependency.

- [ ] **Step 2: Write `src/components/evidence/score-breakdown.tsx`**

```tsx
import type { EvidenceView } from "@/lib/evidence-view";

/**
 * All five deterministic components, always. A score that showed only its total
 * would be exactly the black box this product exists to avoid.
 */
export function ScoreBreakdown({ score, judgment }: { score: EvidenceView["score"]; judgment: EvidenceView["judgment"] }) {
  if (!score) {
    return (
      <p className="text-sm text-muted">
        This lead did not qualify, so it has no score. The reasons are listed above.
      </p>
    );
  }

  return (
    <section aria-labelledby="score-heading" className="border-t border-rule pt-4">
      <h2 id="score-heading" className="font-editorial text-xl">
        Score <span className="font-ui text-base text-muted">{score.total} of 100</span>
      </h2>
      <dl className="mt-3 divide-y divide-rule">
        {score.components.map((component) => (
          <div key={component.key} className="grid grid-cols-[1fr_auto] gap-x-4 py-2">
            <dt className="font-ui text-sm">{component.label}</dt>
            <dd className="font-ui text-sm tabular-nums">{component.points} / {component.max}</dd>
            <dd className="col-span-2 text-sm text-muted">{component.reason}</dd>
          </div>
        ))}
      </dl>
      {judgment?.localityBand ? (
        <p className="mt-3 text-xs text-muted">
          Milwaukee connection set by{" "}
          {judgment.localityBand.basis === "deterministic" ? "a rule" : judgment.localityBand.basis === "editor" ? "an editor" : "AI suggestion"}
          : {judgment.localityBand.reason}
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Write `src/components/evidence/why-this-surfaced.tsx`**

```tsx
import type { EvidenceView } from "@/lib/evidence-view";

/**
 * The demo's central reveal: several independent kinds of source converging on
 * one story. It leads the evidence view because convergence is the reason the
 * lead exists at all.
 */
export function WhyThisSurfaced({ items }: { items: EvidenceView["whySurfaced"] }) {
  return (
    <section aria-labelledby="why-heading" className="border-t border-rule pt-4">
      <h2 id="why-heading" className="font-editorial text-xl">Why this surfaced</h2>
      <ol className="mt-3 flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.sourceResultId} className="grid grid-cols-[auto_1fr] gap-3">
            <span aria-hidden className="font-ui text-sm tabular-nums text-muted">{index + 1}</span>
            <div>
              <p className="font-ui text-xs uppercase tracking-wide text-muted">{item.label}</p>
              <p className="text-sm">{item.title}</p>
              {item.publisher ? <p className="text-xs text-muted">{item.publisher}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">
        {items.length === 1
          ? "Only one kind of source so far. One source is a tip, not a lead."
          : `${items.length} different kinds of source describe the same story.`}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Write `src/components/evidence/citation-trace.tsx`**

```tsx
import type { EvidenceSource } from "@/lib/evidence-view";

/**
 * The last link in the chain: excerpt, then the source, then the exact search
 * that found it. A journalist can re-run that query themselves — which is the
 * whole point of showing it.
 */
export function CitationTrace({ source, excerpt }: { source: EvidenceSource; excerpt: string | null }) {
  return (
    <div className="border-l-2 border-rule pl-3">
      {excerpt ? <blockquote className="font-editorial text-sm italic">“{excerpt}”</blockquote> : null}
      <p className="mt-1 text-sm">
        <a href={source.canonicalUrl} rel="noreferrer noopener" target="_blank" className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--focus)]">
          {source.title}
        </a>
      </p>
      <p className="text-xs text-muted">
        {[source.publisher, source.publishedAt ? new Date(source.publishedAt).toLocaleDateString() : null, source.sourceType]
          .filter(Boolean).join(" · ")}
      </p>
      {source.originalLanguage !== "en" && source.translatedTitle ? (
        <p className="mt-1 text-xs text-muted">
          Original in {source.originalLanguage}. AI translation: “{source.translatedTitle}”
        </p>
      ) : null}
      {!source.isAccessible ? (
        <p className="mt-1 text-xs text-[var(--status-caution)]">
          This link did not load when we checked. Needs a recheck.
        </p>
      ) : null}
      {source.foundByQuery ? (
        <p className="mt-1 font-mono text-xs text-muted">Found by: {source.foundByQuery}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write `src/components/evidence/evidence-item.tsx`**

```tsx
import { CitationTrace } from "./citation-trace";
import type { EvidenceEntry } from "@/lib/evidence-view";

const KIND_TEXT = {
  confirmed_fact: "Confirmed by the rules",
  unverified_signal: "Unverified",
  conflicting_claim: "Conflicting",
  existing_coverage: "Existing coverage",
  potential_source: "Potential source",
} as const;

export function EvidenceItem({ entry }: { entry: EvidenceEntry }) {
  return (
    <article className="border-t border-rule py-3">
      <p className="font-ui text-xs uppercase tracking-wide text-muted">
        {KIND_TEXT[entry.kind as keyof typeof KIND_TEXT] ?? entry.kind}
        {entry.requiresReverification ? " · Needs a recheck" : ""}
      </p>
      <p className="mt-1 text-sm">{entry.claimText}</p>
      {entry.originalLanguageText ? (
        <p className="mt-1 text-sm text-muted">
          <span className="font-ui text-xs uppercase tracking-wide">Original</span>{" "}{entry.originalLanguageText}
        </p>
      ) : null}
      {entry.translatedText ? (
        <p className="mt-1 text-sm text-muted">
          <span className="font-ui text-xs uppercase tracking-wide">AI translation</span>{" "}{entry.translatedText}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {entry.sources.map((source) => (
          <CitationTrace key={source.sourceResultId} source={source} excerpt={entry.exactExcerpt} />
        ))}
      </div>
    </article>
  );
}
```

- [ ] **Step 6: Write `src/components/evidence/coverage-audit.tsx`**

```tsx
import { CitationTrace } from "./citation-trace";
import type { EvidenceView } from "@/lib/evidence-view";

/**
 * A coverage gap is a claim about the absence of reporting, so it may only be
 * made when the check actually finished. Saying "no coverage found" after a
 * failed pass would be the most damaging thing this product could get wrong.
 */
export function CoverageAudit({ coverage }: { coverage: EvidenceView["coverage"] }) {
  const status =
    coverage.passStatus === "complete"
      ? `The 30-day check completed. ${coverage.originalReportCount} original ${coverage.originalReportCount === 1 ? "report" : "reports"} found.`
      : coverage.passStatus === "failed"
        ? "The 30-day check did not complete, so prior coverage is unknown."
        : "The 30-day coverage check has not run yet.";

  return (
    <section aria-labelledby="coverage-heading" className="border-t border-rule pt-4">
      <h2 id="coverage-heading" className="font-editorial text-xl">Existing coverage</h2>
      <p className="mt-2 text-sm">{status}</p>
      <p className="mt-1 text-sm text-muted">
        {coverage.gapAllowed
          ? "This lead can be labelled a coverage gap."
          : "This lead cannot be labelled a coverage gap."}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {coverage.reports.map((report) => (
          <CitationTrace key={report.sourceResultId} source={report} excerpt={null} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Write `src/components/evidence/reporting-brief.tsx`**

```tsx
import type { BriefView } from "@/lib/evidence-view";

const SECTION_TITLES = {
  confirmedFacts: "Confirmed facts",
  unverifiedClaims: "Unverified or conflicting claims",
  conflicts: "Conflicts",
  existingCoverage: "Existing coverage",
  potentialHumanSources: "Potential human sources",
} as const;

/**
 * Closes the gap item 6 deliberately left open: the brief now SAYS what it is.
 * A block with no citations is an absence note we wrote, not a claim — it is
 * rendered as muted prose so it can never be mistaken for sourced material.
 */
export function ReportingBrief({ brief }: { brief: BriefView | null }) {
  if (!brief) return <p className="text-sm text-muted">No brief has been written for this lead yet.</p>;

  return (
    <section aria-labelledby="brief-heading" className="border-t border-rule pt-4">
      <h2 id="brief-heading" className="font-editorial text-xl">Reporting brief</h2>
      <p className="mt-1 font-ui text-xs uppercase tracking-wide text-[var(--status-caution)]">
        AI-drafted editorial assistance — not a publishable story. Version {brief.version}.
      </p>

      <p className="mt-3 font-editorial text-lg">{brief.reportingQuestion}</p>
      <p className="mt-2 text-sm">{brief.whySurfaced}</p>

      {(Object.keys(SECTION_TITLES) as (keyof typeof SECTION_TITLES)[]).map((key) => (
        <div key={key} className="mt-4">
          <h3 className="font-ui text-sm font-medium">{SECTION_TITLES[key]}</h3>
          <ul className="mt-1 flex flex-col gap-2">
            {brief.sections[key].map((block, index) => (
              <li key={index} className={block.sourceResultIds.length === 0 ? "text-sm italic text-muted" : "text-sm"}>
                {block.text}
                {block.sourceResultIds.length > 0 ? (
                  <span className="ml-1 font-ui text-xs text-muted">
                    ({block.sourceResultIds.length} {block.sourceResultIds.length === 1 ? "source" : "sources"})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-4">
        <h3 className="font-ui text-sm font-medium">Suggested interview questions</h3>
        <ol className="mt-1 list-decimal pl-5 text-sm">
          {brief.interviewQuestions.map((question) => <li key={question}>{question}</li>)}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Write `src/components/evidence/lead-card.tsx`**

```tsx
import { StatusLabel } from "@/components/ui/editorial/status-label";
import { BEAT_TEXT } from "@/lib/source-labels";
import type { EvidenceView } from "@/lib/evidence-view";

export function LeadCard({ candidate, sourceCount, coverage }: {
  candidate: EvidenceView["candidate"];
  sourceCount: number;
  coverage: EvidenceView["coverage"];
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel label={candidate.label as never} />
        <span className="font-ui text-xs text-muted">{BEAT_TEXT[candidate.beat as keyof typeof BEAT_TEXT]}</span>
      </div>
      <h1 className="font-editorial text-3xl">{candidate.reportingQuestion || candidate.title}</h1>
      <p className="font-ui text-sm text-muted">
        {candidate.scoreTotal === null ? "No score — this lead did not qualify" : `${candidate.scoreTotal} of 100`}
        {" · "}{sourceCount} {sourceCount === 1 ? "source" : "sources"}
        {" · "}{coverage.originalReportCount} prior {coverage.originalReportCount === 1 ? "report" : "reports"}
        {" · "}{candidate.disposition}
      </p>
    </header>
  );
}
```

- [ ] **Step 9: Write `src/components/evidence/evidence-view.tsx` and the route**

`evidence-view.tsx` assembles the sections **in the spec's order** and is the only `"use client"` file here, because it owns the query subscription.

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CoverageAudit } from "./coverage-audit";
import { EvidenceItem } from "./evidence-item";
import { LeadCard } from "./lead-card";
import { ReportingBrief } from "./reporting-brief";
import { ScoreBreakdown } from "./score-breakdown";
import { WhyThisSurfaced } from "./why-this-surfaced";

const KIND_SECTIONS = [
  { kind: "confirmed_fact", heading: "Confirmed facts" },
  { kind: "unverified_signal", heading: "Unverified signals" },
  { kind: "conflicting_claim", heading: "Conflicting claims" },
  { kind: "potential_source", heading: "Potential human sources" },
] as const;

export function EvidenceViewPanel({ candidateId }: { candidateId: Id<"candidates"> }) {
  const view = useQuery(api.evidence.forCandidate, { candidateId });

  if (view === undefined) return <p className="text-sm text-muted">Loading this lead…</p>;
  if (view === null) return <p className="text-sm text-muted">This lead is not available.</p>;

  const sourceCount = new Set(view.evidence.flatMap((e) => e.sources.map((s) => s.sourceResultId))).size;
  const needsRecheck = view.evidence.filter((e) => e.requiresReverification);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-8">
      <LeadCard candidate={view.candidate} sourceCount={sourceCount} coverage={view.coverage} />
      <ScoreBreakdown score={view.score} judgment={view.judgment} />
      <WhyThisSurfaced items={view.whySurfaced} />

      {KIND_SECTIONS.map(({ kind, heading }) => {
        const entries = view.evidence.filter((e) => e.kind === kind);
        return (
          <section key={kind} aria-labelledby={`section-${kind}`} className="border-t border-rule pt-4">
            <h2 id={`section-${kind}`} className="font-editorial text-xl">{heading}</h2>
            {entries.length === 0
              ? <p className="mt-2 text-sm italic text-muted">Nothing in this section for this lead.</p>
              : entries.map((entry) => <EvidenceItem key={entry.id} entry={entry} />)}
          </section>
        );
      })}

      {needsRecheck.length > 0 ? (
        <section aria-labelledby="recheck-heading" className="border-t border-rule pt-4">
          <h2 id="recheck-heading" className="font-editorial text-xl">Needs a recheck</h2>
          {needsRecheck.map((entry) => <EvidenceItem key={`recheck-${entry.id}`} entry={entry} />)}
        </section>
      ) : null}

      <CoverageAudit coverage={view.coverage} />
      <ReportingBrief brief={view.brief} />

      <section aria-labelledby="query-log-heading" className="border-t border-rule pt-4">
        <h2 id="query-log-heading" className="font-editorial text-xl">Query log</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {view.queryLog.map((run, index) => (
            <li key={`${run.templateId}-${index}`} className="text-sm">
              <span className="font-mono text-xs">{run.query}</span>
              <span className="block text-xs text-muted">
                {run.engine} · {run.purpose} · {run.status} · {run.resultCount} results · {run.durationMs}ms
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

And `src/app/workspace/leads/[candidateId]/page.tsx`:

```tsx
import { EvidenceViewPanel } from "@/components/evidence/evidence-view";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default async function LeadPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <EvidenceViewPanel candidateId={candidateId as Id<"candidates">} />;
}
```

- [ ] **Step 10: Build and inspect by hand**

Run: `npm run typecheck && npm run lint && npm run build`
Then run the app and open one lead: `npm run dev`

Check all of these, and write down what you saw:
- Light mode and dark mode.
- Keyboard only: `Tab` through the page. Focus is visible on every link. Tab order follows reading order.
- Narrow width (375px): no horizontal scrolling.
- Turn colour off (browser grayscale filter): every status is still readable as text.
- Confirmed facts and AI-drafted prose look different from each other.

- [ ] **Step 11: Update `THIRD_PARTY_NOTICES.md` if you copied a primitive**

If you copied nothing, say so in the commit body rather than leaving it ambiguous.

- [ ] **Step 12: Commit**

```bash
git add src/components/evidence src/app/workspace/leads src/lib/evidence-view.ts THIRD_PARTY_NOTICES.md
git commit -m "feat(ui): custom evidence components and the lead evidence view (MOO-733)"
```

---

### Task 9: The rendered trace, end to end

**Files:**
- Create: `tests/e2e/evidence-vertical-slice.spec.ts`
- Modify: `convex/testing.ts` — add a fixture seeder the e2e run can call
- Modify: `docs/HANDOFF.md`, `docs/LEARNING-LOG.md`

**Interfaces:**
- Consumes: `runSliceForScan` (Task 6); `SLICE_SOURCES`, `sliceModelAnswers` (Task 6); the route from Task 8.
- Produces: `seedSliceFixture` — an `internalMutation` in `convex/testing.ts` that inserts the fixture scan, search run and source results for a given Clerk user and returns the ids, so the Playwright global setup can build a lead without a model call.

- [ ] **Step 1: Add the seeder to `convex/testing.ts`**

It must reuse `purgeScan` on teardown so the e2e reset stays honest, and it must **not** call a model — the e2e run seeds the finished state directly.

The seeded data mirrors `tests/fixtures/slice.ts` so the e2e run and the integration test agree. **`status`, `primaryLabel` and `scoreTotal` are never hand-written** — the seeder calls the same `evaluate` mutation the pipeline uses, so the verdict on screen is the rules engine's, and the e2e test actually proves something about the engine.

Add to the top of `convex/testing.ts`:

```ts
import { internal } from "./_generated/api";
```

(already imported for `raceReserve`), and append:

```ts
/**
 * Seeds one finished lead for the e2e run: the same four Milwaukee sources the
 * integration fixture uses, already clustered, classified, snapshotted and
 * briefed. It makes NO model call — the e2e suite must not depend on a paid
 * service, and what it is testing is the rendering, not the model.
 */
const SLICE_SOURCES = [
  { family: "official" as const, engine: "google" as const, language: "en",
    url: "https://city.milwaukee.gov/agenda/250412",
    title: "Common Council agenda item 250412",
    snippet: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive.",
    publisher: undefined as string | undefined, accessible: true },
  { family: "news" as const, engine: "google_news" as const, language: "en",
    url: "https://jsonline.com/story/harambee-rezoning",
    title: "Neighbors question Harambee rezoning timeline",
    snippet: "Residents say they learned of the proposal a week before the vote.",
    publisher: "Milwaukee Journal Sentinel", accessible: true },
  { family: "news" as const, engine: "google" as const, language: "es",
    url: "https://elconquistador.example/rezonificacion-harambee",
    title: "Vecinos cuestionan la rezonificación de Harambee",
    snippet: "Los residentes dicen que se enteraron una semana antes de la votación.",
    publisher: "El Conquistador", accessible: true },
  { family: "community_discussion" as const, engine: "google" as const, language: "en",
    url: "https://reddit.com/r/milwaukee/comments/abc123/harambee_rezoning",
    title: "Anyone know what's happening with the Harambee rezoning?",
    snippet: "Saw surveyors on MLK yesterday. Nobody I know got a notice.",
    publisher: undefined, accessible: false },
];

const SLICE_QUERY = 'site:city.milwaukee.gov "Harambee rezoning"';

export const seedSliceFixture = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.object({ scanId: v.id("scans"), candidateId: v.id("candidates") }),
  handler: async (ctx, { clerkUserId }): Promise<{ scanId: Id<"scans">; candidateId: Id<"candidates"> }> => {
    const now = Date.now();
    const day = 86_400_000;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    const ownerId = existingUser?._id
      ?? (await ctx.db.insert("users", { clerkUserId, createdAt: now, updatedAt: now }));

    const scanId = await ctx.db.insert("scans", {
      ownerId, marketKey: MARKET_KEY,
      rulesetVersion: RULESET_VERSION, queryCatalogVersion: QUERY_CATALOG_VERSION,
      status: "completed", stage: "briefs", startedAt: now - 60_000, completedAt: now,
      searchBudgetLimit: SEARCH_BUDGET.hardCap,
      searchesReserved: 1, searchesSucceeded: 1, searchesFailed: 0,
      eligibleCount: 1, excludedCount: 0, processingCount: 0,
      failureSummaries: [], isSavedDemo: false,
    });

    const searchRunId = await ctx.db.insert("searchRuns", {
      scanId, ownerId, idempotencyKey: `${scanId}:discovery:official-housing-01:fixture`,
      templateId: "official-housing-01", queryCatalogVersion: QUERY_CATALOG_VERSION,
      purpose: "discovery", engine: "google",
      query: SLICE_QUERY, parameters: { gl: "us", hl: "en" }, language: "en",
      status: "succeeded", attemptCount: 1, resultCount: SLICE_SOURCES.length, durationMs: 812,
      reservedAt: now - 50_000, completedAt: now - 49_000,
    });

    const candidateId = await ctx.db.insert("candidates", {
      ownerId, fingerprint: "fixture-harambee-rezoning",
      currentTitle: "Harambee rezoning heads to a council vote",
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      beat: "housing", status: "processing", primaryLabel: "Worth a look", disposition: "new",
      latestEvidenceVersion: 0, independentCategoryCount: 0, coverageOriginalCount: 0,
      coveragePassStatus: "pending",
      firstSeenAt: now, lastSeenAt: now, updatedAt: now,
      judgment: {
        localityBand: { value: "direct_city", basis: "deterministic", reason: "an official Milwaukee source is cited: city.milwaukee.gov" },
        relevanceBand: { value: "policy_service_change", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        beat: { value: "housing", basis: "ai_suggested", reason: "suggested by the model from the supplied sources" },
        isSpeculative: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isRoutineCrime: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        isDuplicateOfCandidate: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
        hasMaterialConflict: { value: false, basis: "ai_suggested", reason: "flagged by the model" },
      },
    });

    const sourceIds: Id<"sourceResults">[] = [];
    for (const [i, source] of SLICE_SOURCES.entries()) {
      const sourceResultId = await ctx.db.insert("sourceResults", {
        scanId, searchRunId, ownerId,
        canonicalKey: `${source.engine}:${source.url}`, canonicalUrl: source.url, originalUrl: source.url,
        engine: source.engine, sourceFamily: source.family,
        sourceType: source.family === "official" ? "primary" : source.family === "community_discussion" ? "discussion" : "unknown",
        title: source.title, snippet: source.snippet, publisher: source.publisher,
        originalLanguage: source.language,
        translatedTitle: source.language === "es" ? "Neighbors question the Harambee rezoning" : undefined,
        translatedSnippet: source.language === "es" ? "Residents say they found out a week before the vote." : undefined,
        publishedAt: now - day, discoveredAt: now, position: i + 1,
        isAccessible: source.accessible, contentHash: `fixture-${i}`,
      });
      await ctx.db.insert("candidateSources", {
        candidateId, scanId, sourceResultId,
        role: i === 0 ? "initiating" : "corroborating",
        independenceGroup: `host:${new URL(source.url).hostname.replace(/^www\./, "")}`,
        signalCategory: source.family === "official" ? "official_record"
          : source.family === "news" ? "original_news" : "community_discussion",
        addedBy: "ai_suggestion",
      });
      sourceIds.push(sourceResultId);
    }

    const modelRunId = await ctx.db.insert("modelRuns", {
      scanId, candidateId, ownerId, operation: "classifyEvidence",
      idempotencyKey: `${scanId}:${candidateId}:classifyEvidence:fixture:1:2:claude-sonnet-5`,
      provider: "anthropic", modelId: "claude-sonnet-5",
      promptVersion: "2", schemaVersion: "1", inputSnapshotHash: "fixture",
      status: "succeeded", attempt: 1, durationMs: 14_200,
      inputTokens: 2_100, outputTokens: 900, startedAt: now - 30_000, completedAt: now - 16_000,
    });

    const evidence: Array<{ kind: string; claimText: string; ids: Id<"sourceResults">[]; excerpt?: string; original?: string; translated?: string }> = [
      { kind: "existing_coverage", claimText: "The rezoning is agenda item 250412.", ids: [sourceIds[0]],
        excerpt: "Rezoning of the 3000 block of North Dr. Martin Luther King Jr. Drive." },
      { kind: "unverified_signal", claimText: "Residents say they learned of the proposal a week before the vote.", ids: [sourceIds[1]],
        excerpt: "Residents say they learned of the proposal a week before the vote." },
      { kind: "unverified_signal", claimText: "Neighbors say they were notified a week before the vote.", ids: [sourceIds[2]],
        original: "Los residentes dicen que se enteraron una semana antes de la votación.",
        translated: "Residents say they found out a week before the vote." },
      { kind: "potential_source", claimText: "A resident reports surveyors on MLK Drive.", ids: [sourceIds[3]],
        excerpt: "Saw surveyors on MLK yesterday. Nobody I know got a notice." },
    ];
    for (const item of evidence) {
      await ctx.db.insert("evidenceItems", {
        candidateId, scanId, ownerId, evidenceVersion: 1,
        kind: item.kind as never, claimText: item.claimText, sourceResultIds: item.ids,
        exactExcerpt: item.excerpt, originalLanguageText: item.original, translatedText: item.translated,
        classificationBasis: "ai_suggested",
        // The Reddit source is deliberately unreachable, so its item must show
        // `Needs a recheck` on screen.
        requiresReverification: item.ids.some((id) => id === sourceIds[3]),
        createdByModelRunId: modelRunId,
      });
    }
    await ctx.db.patch(candidateId, { latestEvidenceVersion: 1 });

    await ctx.db.insert("briefVersions", {
      candidateId, scanId, ownerId, version: 1, modelRunId,
      reportingQuestion: "Who was notified before the Harambee rezoning reached the council?",
      whySurfaced: "An official agenda item and two independent local outlets describe the same rezoning.",
      // Empty sections carry OUR fixed sentences with no citations, exactly as
      // runGenerateBrief writes them.
      confirmedFacts: [{ text: EMPTY_SECTION_NOTES.confirmedFacts, sourceResultIds: [] }],
      unverifiedClaims: [{ text: "Residents say they learned of the proposal a week before the vote.", sourceResultIds: [sourceIds[1]] }],
      conflicts: [{ text: EMPTY_SECTION_NOTES.conflicts, sourceResultIds: [] }],
      existingCoverage: [{ text: EMPTY_SECTION_NOTES.existingCoverageIncomplete, sourceResultIds: [] }],
      potentialHumanSources: [{ text: "A resident who saw surveyors on MLK Drive.", sourceResultIds: [sourceIds[3]] }],
      interviewQuestions: [
        "How much notice does the city owe residents before a rezoning vote?",
        "Who signed off on the notification schedule for item 250412?",
      ],
      createdAt: now,
    });
    await ctx.db.patch(candidateId, { latestBriefVersion: 1 });

    await ctx.db.insert("candidateAppearances", {
      candidateId, scanId, ownerId,
      statusAtScan: "processing", labelAtScan: "Worth a look", dispositionAtScan: "new", rank: 1,
    });

    // The verdict on screen is the rules engine's. Nothing above wrote status,
    // primaryLabel or scoreTotal.
    await ctx.runMutation(internal.candidates.evaluate.evaluate, { scanId, candidateId, now });

    return { scanId, candidateId };
  },
});
```

Add the imports this needs at the top of `convex/testing.ts`:

```ts
import { EMPTY_SECTION_NOTES } from "./ai/generateBrief";
```

`MARKET_KEY`, `RULESET_VERSION`, `QUERY_CATALOG_VERSION`, `SEARCH_BUDGET` and `Id` are already imported there for `seedScanAtReservation`.

Note the explicit `Promise<{ scanId; candidateId }>` return annotation on the handler: this mutation calls `internal.candidates.evaluate.evaluate`, and without the annotation TypeScript hits the same circular-inference error `raceReserve` hit.

- [ ] **Step 2: Write the Playwright spec** — `tests/e2e/evidence-vertical-slice.spec.ts`

```ts
import { expect, test } from "@playwright/test";

/**
 * The Review Pause 2 gate, automated: one lead traced from `Why this surfaced`
 * through citations, coverage and score to a generated brief.
 */
test.describe("evidence vertical slice", () => {
  test("a lead shows why it surfaced, with at least two kinds of source", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    const why = page.getByRole("region", { name: "Why this surfaced" });
    await expect(why).toBeVisible();
    await expect(why.getByRole("listitem")).toHaveCount(2, { timeout: 10_000 });
  });

  test("the score shows all five components and they add up", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    const score = page.getByRole("region", { name: /^Score/ });
    await expect(score.locator("dt")).toHaveCount(5);
  });

  test("every citation links out and names the query that found it", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    const firstTrace = page.getByText("Found by:").first();
    await expect(firstTrace).toBeVisible();
  });

  test("the brief says it is AI-drafted assistance, not a story", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    await expect(page.getByText(/AI-drafted editorial assistance/i)).toBeVisible();
  });

  test("an empty brief section reads as an absence, not a claim", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    await expect(page.getByText(/independently confirmed/i)).toBeVisible();
  });

  test("a coverage gap is refused while the coverage check is incomplete", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    await expect(page.getByText(/cannot be labelled a coverage gap/i)).toBeVisible();
  });

  test("status is readable without colour", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    // The label prints its own word; colour is decoration only.
    await expect(page.getByText("Worth a look")).toBeVisible();
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("keyboard focus is visible on the first citation link", async ({ page }) => {
    await page.goto("/workspace/leads/FIXTURE_CANDIDATE_ID");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineStyle : "none";
    });
    expect(outline).not.toBe("none");
  });
});
```

Replace `FIXTURE_CANDIDATE_ID` by having `tests/e2e/global-setup.ts` call `seedSliceFixture` and write the returned id where the spec can read it — follow whatever pattern `global-setup.ts` already uses for the Clerk test user rather than inventing a second one.

- [ ] **Step 3: Deploy, then run the e2e suite**

Run: `set -a; . ./.env.local; set +a; npx convex dev --once`
Then: `npm run test:e2e`
Expected: all specs pass, including the seven that already existed.

If Playwright reports a missing browser, run `npx playwright install chromium` first — that happened on this machine on 2026-08-23 and cost a confusing red run.

- [ ] **Step 4: Run everything**

Run: `npm run check && npm run test:e2e && npm run build`
Expected: green across the board. This is the item 7 acceptance gate.

- [ ] **Step 5: Manually trace one fact backward**

Open one lead in the running app and do this by hand, writing down each step:
1. Pick one statement in the brief.
2. Follow it to the evidence item that carries it.
3. From that item, open the exact excerpt.
4. From the excerpt, open the source URL and confirm the text is really there.
5. From the source, read the query that found it, and confirm that query exists in `convex/integrations/serpapi/queryCatalog.ts`.

If any step breaks, that is a **Critical** finding — stop and report it rather than adjusting the UI to hide it.

- [ ] **Step 6: Update the handoff and learning log**

Add to `docs/HANDOFF.md`: item 7 done, what item 8 inherits, and anything found in step 5. Add a dated `docs/LEARNING-LOG.md` entry answering the three questions: what did we expect, what happened, what do we now believe.

- [ ] **Step 7: Commit, push, confirm CI**

```bash
git add convex/testing.ts tests/e2e docs/HANDOFF.md docs/LEARNING-LOG.md
git commit -m "test(e2e): trace one lead from why-it-surfaced to its brief (MOO-733)"
git push
```

Then confirm CI is green and record the run URL.

- [ ] **Step 8: STOP — Review Pause 2**

Do not start item 8. Present to Tarik: one fixture lead traced from `Why this surfaced` through citations, coverage, score and generated brief, in both themes, with the keyboard trace. The resume condition is **source traceability and uncertainty presentation accepted**.

---

## Self-review notes

**Spec coverage.** Item 7's "what to build" maps as follows: normalized results → candidate membership is Task 2; versioned evidence snapshot is Task 5; deterministic eligibility and score is Task 4; validated brief is Task 6 (calling item 6's `runGenerateBrief`). The seven named components are Task 8. The ordered sections from `spec.md > Expanded evidence view` are assembled in Task 8 Step 9 and asserted in Task 9. Query provenance is Task 7's `foundByQuery`, asserted in both Task 7 and Task 9.

**Item 7 acceptance, line by line.** "`Why this surfaced` begins the evidence view and shows at least two categories" — Task 8 Step 9 ordering, Task 7 test 3, Task 9 test 1. "Every confirmed fact and coverage report opens its stored source evidence" — `CitationTrace`, Task 9 test 3. "Unverified Reddit remains labeled and nonconfirming" — Task 6 test 3 (`independentCategoryCount` is 2, not 3, with Reddit present) and the fixture's `potential_source` classification. "Conflicting material cannot enter confirmed facts" — Task 5 test 3 and Task 6 test 4. "The score shows all five components" — Task 7 test 5, Task 9 test 2. "The brief contains every approved section, identifies itself as AI assistance, and invents no filler" — Task 8 Step 7 and Task 9 tests 4 and 5.

**Carried-in items closed here.** Ruling 3 (`Judged<T>` wired into the rules-engine input) is Tasks 3 and 4. The AI-draft label gap left open at the end of item 6 is Task 8 Step 7 — solved in the UI, with no schema field invented for it.

**Deliberately not here.** The ranked feed, filters, dispositions, corrections and scan comparison are item 9. The durable workflow and the fixed 13-search catalog execution are item 8. `Outdated` still has no schema home; that stays MOO-735's problem and is not smuggled in here.

**Type consistency check.** `formFromCluster`'s `cluster` argument matches the `clusters[]` element that `runClusterSignals` returns, field for field. `saveJudgment`'s `judgment` argument matches `JudgmentSet` from `convex/ai/classifyEvidence.ts` — seven keys, three nullable string judgments and four boolean ones. `writeSnapshot`'s `items` argument is a subset of `ClassifyEvidenceOutput["items"]`, taking only the six fields `evidenceItems` stores. `evaluate` returns the four fields `runSliceForScan` reads. `EvidenceView` in `src/lib/evidence-view.ts` is derived from the query rather than hand-written, so it cannot drift.

**Known risk.** Task 7's return validator is large and hand-written; `v.any()` is used as scaffolding in Step 3 and **must** be replaced in Step 4. A public query shipping with `v.any()` would violate the project's own non-negotiable, so the reviewer should check that specifically.
