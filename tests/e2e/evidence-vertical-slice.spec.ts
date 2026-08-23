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
      .toHaveText(/Metcalfe Park Liberation Hub/);
  });

  test("why this surfaced shows at least two kinds of source", async ({ page }) => {
    const why = page.getByRole("region", { name: "Why this surfaced" });
    await expect(why).toBeVisible();
    // One entry per DISTINCT kind of source, not per source: the two news
    // stories collapse into one "Local reporting" row.
    // One entry per DISTINCT kind of source: three news outlets collapse into
    // one "Local reporting" row, and the Reddit thread is the second row.
    await expect(why.getByRole("listitem")).toHaveCount(2);
    await expect(why.getByText("Local reporting")).toBeVisible();
    await expect(why.getByText("Does not count toward confirmation")).toBeVisible();
  });

  test("a lead that did not qualify shows NO score, and says why", async ({ page }) => {
    // Three independent Milwaukee outlets, but all one kind of source. The gate
    // needs two categories, so this real lead is excluded and carries no score.
    const score = page.getByRole("region", { name: "Score" });
    await expect(score.getByText(/did not qualify, so it has no score/)).toBeVisible();
    await expect(score.locator("dt")).toHaveCount(0);
  });

  test("the judgment names who set the Milwaukee connection", async ({ page }) => {
    // No official Milwaukee domain is cited here, so the deterministic path did
    // not fire and the page says the AI suggested it — with the basis shown.
    await expect(page.getByText(/Milwaukee connection set by an AI suggestion/)).toBeVisible();
  });

  test("every citation names the query that found it", async ({ page }) => {
    const found = page.getByText("Found by:");
    await expect(found.first()).toBeVisible();
    expect(await found.count()).toBeGreaterThan(1);
  });

  test("a source is traced to a search that could actually have returned it", async ({ page }) => {
    // The chain has to survive a sceptic. A site:city.milwaukee.gov search cannot
    // return a jsonline.com story, so each source carries its own real query.
    await expect(page.getByText(/City Plan Commission approved the Metcalfe Park improvement district/).first()).toBeVisible();
    await expect(page.getByText(/Found by: Milwaukee \(housing OR zoning/).first()).toBeVisible();
    await expect(page.getByText(/Found by: site:reddit\.com\/r\/milwaukee\/comments\//).first()).toBeVisible();
  });

  test("the brief says it is AI-drafted assistance, not a story", async ({ page }) => {
    await expect(page.getByText(/AI-drafted editorial assistance/i)).toBeVisible();
  });

  test("an empty brief section reads as an absence, not a claim", async ({ page }) => {
    await expect(page.getByText(/Nothing here has been independently confirmed yet/i).first()).toBeVisible();
  });

  test("the only stored excerpt is quoted verbatim from its source", async ({ page }) => {
    // Only the Reddit result carried a snippet in the captured payload, so it is
    // the only thing on the page that can be quoted.
    await expect(page.getByText(/Known as the Metcalfe Park Liberation Hub, the two-phase development/)).toBeVisible();
  });

  test("coverage says UNKNOWN, not absent, because the check never ran", async ({ page }) => {
    const coverage = page.getByRole("region", { name: "Existing coverage" });
    await expect(coverage.getByText(/has not run yet/)).toBeVisible();
    await expect(coverage.getByText(/cannot\b/)).toBeVisible();
  });

  test("the query log lists every search that produced a source", async ({ page }) => {
    const log = page.getByRole("region", { name: "Query log" });
    // Two distinct searches captured these four sources.
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await expect(log.getByText(/site:reddit\.com\/r\/milwaukee\/comments\//)).toBeVisible();
    await expect(log.getByText(/when:7d/)).toBeVisible();
  });

  test("status is readable without colour", async ({ page }) => {
    await expect(page.getByText("Worth a look").first()).toBeVisible();
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
    await page.getByRole("link").filter({ hasText: "City Plan Commission approves Metcalfe Park" }).first().focus();
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineWidth : "0px";
    });
    expect(outline).not.toBe("0px");
  });
});
