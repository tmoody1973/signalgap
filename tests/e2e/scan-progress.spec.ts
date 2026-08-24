import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signInOnly } from "./helpers/auth";

/**
 * The scan progress panel, against a seeded scan in a known state. No live
 * SerpApi call: what is under test is the rendering, not the network.
 */
async function clerkUserId(): Promise<string> {
  const email = process.env.E2E_CLERK_EMAIL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!email || !secretKey) throw new Error("Set E2E_CLERK_EMAIL and CLERK_SECRET_KEY");
  const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const users = (await res.json()) as Array<{ id: string }>;
  if (!users[0]?.id) throw new Error("No Clerk user found for E2E_CLERK_EMAIL");
  return users[0].id;
}

function seed(stage: string, status: string, withFailure = false) {
  const userId = process.env.__CLERK_ID__!;
  execSync(`npx convex run internal.testing.seedScanInState '${JSON.stringify({ clerkUserId: userId, stage, status, withFailure })}'`, { encoding: "utf8" });
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
    // .first(): "Working" also substring-matches the counts line's "X still
    // working" (Playwright's text match is case-insensitive substring), so a
    // scenario with a processing count > 0 legitimately has two matches.
    await expect(panel.getByText("Working").first()).toBeVisible();    // coverage
    await expect(panel.getByText("Not started").first()).toBeVisible(); // briefs
  });

  test("shows all three counts even when two of them are zero", async ({ page }) => {
    seed("briefs", "running");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText(/\d+ ready/)).toBeVisible();
    await expect(panel.getByText(/\d+ did not qualify/)).toBeVisible();
    await expect(panel.getByText(/\d+ still working/)).toBeVisible();
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
    // .first(): "coverage" also matches the always-visible stage name
    // "Reviewing existing coverage", so more than one match is expected.
    await expect(panel.getByText(/coverage/i).first()).toBeVisible();
  });

  test("a cancelled scan says Stopped early and offers no cancel button", async ({ page }) => {
    seed("evidence", "canceled");
    await signInOnly(page);
    await page.goto("/workspace");

    const panel = page.getByRole("region", { name: "Scan progress" });
    await expect(panel.getByText("Stopped early")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Cancel scan" })).toHaveCount(0);
  });

  test("a running scan offers cancel, and cancelling changes the state", async ({ page }) => {
    seed("discovery", "running");
    await signInOnly(page);
    await page.goto("/workspace");

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
});
