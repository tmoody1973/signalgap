import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { clerkUserId, signInOnly } from "./helpers/auth";

/**
 * The scan progress panel, against a seeded scan in a known state. No live
 * SerpApi call: what is under test is the rendering, not the network.
 */

function seed(stage: string, status: string, withFailure = false, counts: Partial<Record<"eligibleCount" | "excludedCount" | "processingCount", number>> = {}) {
  const userId = process.env.__CLERK_ID__!;
  execSync(`npx convex run internal.testing.seedScanInState '${JSON.stringify({ clerkUserId: userId, stage, status, withFailure, ...counts })}'`, { encoding: "utf8" });
}

test.beforeAll(async () => { process.env.__CLERK_ID__ = await clerkUserId(); });

test.afterAll(async () => {
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: process.env.__CLERK_ID__ })}'`, { encoding: "utf8" });
});

test.describe("scan progress", () => {
  test("names all four stages in order, always", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel).toBeVisible();
    // All four, always — a stage that has not started yet is information, not
    // clutter. An editor needs to know what is still coming.
    for (const text of ["Discovering signals", "Checking local evidence", "Reviewing existing coverage", "Preparing leads"]) {
      await expect(panel.getByText(text, { exact: true })).toBeVisible();
    }
  });

  test("each stage's state is readable without colour", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Done").first()).toBeVisible();      // discovery, evidence
    // exact: true — "Working" also substring-matches the counts line's "X
    // still working" (Playwright's text match is case-insensitive substring),
    // so a plain match would pass even if the stage badge lost its own text.
    await expect(panel.getByText("Working", { exact: true })).toBeVisible(); // coverage
    await expect(panel.getByText("Not started").first()).toBeVisible(); // briefs
  });

  test("shows all three counts even when two of them are zero", async ({ page }) => {
    // eligible and excluded genuinely at zero — the case that matters, since an
    // editor seeing "0 ready" needs to see it, not have it silently hidden.
    seed("briefs", "running", false, { eligibleCount: 0, excludedCount: 0, processingCount: 4 });
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("0 ready")).toBeVisible();
    await expect(panel.getByText("0 did not qualify")).toBeVisible();
    await expect(panel.getByText("4 still working")).toBeVisible();
  });

  test("shows search usage against the ceiling", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");
    await expect(page.getByText(/of 120 searches/)).toBeVisible();
  });

  test("a scan that finished with failures says Incomplete scan and names the purpose", async ({ page }) => {
    seed("briefs", "partial", true);
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Incomplete scan")).toBeVisible();
    // Naming the purpose is what turns a warning into something actionable.
    // exact: true — the failure-purpose span's text is literally "coverage";
    // the always-visible stage name's is the longer "Reviewing existing
    // coverage", so exact matching targets the failure content specifically.
    await expect(panel.getByText("coverage", { exact: true })).toBeVisible();
  });

  test("a cancelled scan says Stopped early and offers no cancel button", async ({ page }) => {
    seed("evidence", "canceled");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Stopped early")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Cancel scan" })).toHaveCount(0);
    // A stopped scan is a FINISHED scan, so the way to start another one has to
    // be here. It used to live only in the feed's empty state, which does not
    // render once a lead is on screen — leaving no way to scan at all.
    await expect(panel.getByRole("button", { name: "Run new scan" })).toBeVisible();
  });

  test("a finished scan offers a new one, whether or not the feed is empty", async ({ page }) => {
    // eligibleCount 3: the feed renders CARDS, so its empty state — the only
    // other place this button lives — is not on screen. This is the regression.
    seed("briefs", "partial", false, { eligibleCount: 3, excludedCount: 5, processingCount: 0 });
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByRole("button", { name: "Run new scan" })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Cancel scan" })).toHaveCount(0);
  });

  test("a running scan offers cancel, and cancelling changes the state", async ({ page }) => {
    seed("discovery", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    // `startScan` throws "A scan is already running" against exactly this
    // state, so the button must not be on screen to be pressed.
    await expect(page.getByRole("button", { name: "Run new scan" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel scan" }).click();
    await expect(page.getByText("Stopped early")).toBeVisible();
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/workspace");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("a finished scan folds its stages away, and they can be opened", async ({ page }) => {
    // Four rows reading DONE are not information to an editor reading a
    // finished scan; the counts and the failures are. The stages stay one
    // click away rather than being removed.
    seed("briefs", "partial", true, { eligibleCount: 1, excludedCount: 9, processingCount: 0 });
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("1 ready")).toBeVisible();
    await expect(panel.getByText("Discovering signals", { exact: true })).toBeHidden();

    await panel.getByText("How this scan ran").click();
    await expect(panel.getByText("Discovering signals", { exact: true })).toBeVisible();
    await expect(panel.getByText(/of 120 searches/)).toBeVisible();
  });

  test("a finished scan shows its leads above its progress", async ({ page }) => {
    seed("briefs", "partial", false, { eligibleCount: 1, excludedCount: 9, processingCount: 0 });
    await signInOnly(page);
    await page.goto("/workspace");

    const leads = page.getByRole("region", { name: "Leads" });
    const progress = page.getByRole("region", { name: "Scan progress" });
    const leadsTop = await leads.evaluate((el) => el.getBoundingClientRect().top);
    const progressTop = await progress.evaluate((el) => el.getBoundingClientRect().top);
    expect(leadsTop).toBeLessThan(progressTop);
  });

  test("a running scan keeps its progress above its leads", async ({ page }) => {
    seed("coverage", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const leads = page.getByRole("region", { name: "Leads" });
    const progress = page.getByRole("region", { name: "Scan progress" });
    const leadsTop = await leads.evaluate((el) => el.getBoundingClientRect().top);
    const progressTop = await progress.evaluate((el) => el.getBoundingClientRect().top);
    expect(progressTop).toBeLessThan(leadsTop);
  });
});
