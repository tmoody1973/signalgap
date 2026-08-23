import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signInOnly } from "./helpers/auth";

/**
 * The Review Pause 2 gate, automated: one lead traced from `Why this surfaced`
 * through citations, coverage and score to a generated brief.
 *
 * The fixture is seeded through the CLI, not the UI, and makes NO model call —
 * what is under test is the rendering, not the model.
 */

let candidateId = "";

async function clerkUserId(): Promise<string> {
  const email = process.env.E2E_CLERK_EMAIL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!email || !secretKey) throw new Error("Set E2E_CLERK_EMAIL and CLERK_SECRET_KEY");
  const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Clerk lookup failed: ${res.status}`);
  const users = (await res.json()) as Array<{ id: string }>;
  const id = users[0]?.id;
  if (!id) throw new Error("No Clerk user found for E2E_CLERK_EMAIL");
  return id;
}

test.beforeAll(async () => {
  const userId = await clerkUserId();
  const out = execSync(`npx convex run internal.testing.seedSliceFixture '${JSON.stringify({ clerkUserId: userId })}'`, {
    encoding: "utf8",
  });
  candidateId = JSON.parse(out.slice(out.indexOf("{"))).candidateId as string;
});

// The fixture scan is removed so first-run.spec.ts still reads a clean workspace.
test.afterAll(async () => {
  const userId = await clerkUserId();
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: userId })}'`, {
    stdio: "ignore",
  });
});

test.beforeEach(async ({ page }) => {
  await signInOnly(page);
  await page.goto(`/leads/${candidateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
});

test.describe("evidence vertical slice", () => {
  test("the lead leads with its reporting question", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 }))
      .toHaveText(/Who was notified before the Harambee rezoning reached the council\?/);
  });

  test("why this surfaced shows at least two kinds of source", async ({ page }) => {
    const why = page.getByRole("region", { name: "Why this surfaced" });
    await expect(why).toBeVisible();
    // One entry per DISTINCT kind of source, not per source: the two news
    // stories collapse into one "Local reporting" row.
    await expect(why.getByRole("listitem")).toHaveCount(3);
    await expect(why.getByText("Official record")).toBeVisible();
    await expect(why.getByText("Does not count toward confirmation")).toBeVisible();
  });

  test("the score shows all five components and they add up to the total", async ({ page }) => {
    const score = page.getByRole("region", { name: "Score" });
    await expect(score.locator("dt")).toHaveCount(5);
    await expect(score.getByText("95 of 100, from five checks")).toBeVisible();

    const points = await score.locator("dd.text-right").allInnerTexts();
    const total = points.reduce((sum, text) => sum + Number(text.split("/")[0].trim()), 0);
    expect(total).toBe(95);
  });

  test("the score says a RULE set the Milwaukee connection, not the AI", async ({ page }) => {
    await expect(page.getByText(/Milwaukee connection set by a rule/)).toBeVisible();
    await expect(page.getByText(/city\.milwaukee\.gov/).first()).toBeVisible();
  });

  test("every citation names the query that found it", async ({ page }) => {
    const found = page.getByText("Found by:");
    await expect(found.first()).toBeVisible();
    expect(await found.count()).toBeGreaterThan(1);
  });

  test("a source is traced to a search that could actually have returned it", async ({ page }) => {
    // The chain has to survive a sceptic. A site:city.milwaukee.gov search cannot
    // return a jsonline.com story, so each source carries its own real query.
    const newsClaim = page.getByText("Residents say they learned of the proposal a week before the vote.").first();
    await expect(newsClaim).toBeVisible();
    await expect(page.getByText(/Found by: Milwaukee \(housing OR zoning/).first()).toBeVisible();
    await expect(page.getByText(/Found by: \(site:city\.milwaukee\.gov/).first()).toBeVisible();
  });

  test("the brief says it is AI-drafted assistance, not a story", async ({ page }) => {
    await expect(page.getByText(/AI-drafted editorial assistance/i)).toBeVisible();
  });

  test("an empty brief section reads as an absence, not a claim", async ({ page }) => {
    await expect(page.getByText(/Nothing here has been independently confirmed yet/i).first()).toBeVisible();
  });

  test("the Spanish original stays beside its AI translation", async ({ page }) => {
    await expect(page.getByText("Los residentes dicen que se enteraron una semana antes de la votación")).toBeVisible();
    await expect(page.getByText("AI translation").first()).toBeVisible();
  });

  test("an unreachable citation stays visible and says so", async ({ page }) => {
    await expect(page.getByText(/This link did not load when we checked/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs a recheck" })).toBeVisible();
  });

  test("the coverage section states plainly whether a gap may be claimed", async ({ page }) => {
    const coverage = page.getByRole("region", { name: "Existing coverage" });
    await expect(coverage.getByText(/The 30-day check completed/)).toBeVisible();
    await expect(coverage.getByText(/can\b/).first()).toBeVisible();
  });

  test("the query log lists every search that produced a source", async ({ page }) => {
    const log = page.getByRole("region", { name: "Query log" });
    await expect(log.getByRole("listitem")).toHaveCount(4);
    await expect(log.getByText(/site:reddit\.com\/r\/milwaukee\/comments\//)).toBeVisible();
    await expect(log.getByText(/vivienda OR zonificación/)).toBeVisible();
  });

  test("status is readable without colour", async ({ page }) => {
    await expect(page.getByText("Needs a recheck").first()).toBeVisible();
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/leads/${candidateId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("keyboard focus is visible on the first citation link", async ({ page }) => {
    await page.getByRole("link").filter({ hasText: "Common Council agenda item 250412" }).first().focus();
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineWidth : "0px";
    });
    expect(outline).not.toBe("0px");
  });
});
