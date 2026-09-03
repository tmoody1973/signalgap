import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { clerkUserId, signInOnly } from "./helpers/auth";

/**
 * The lead page's "now what": an editor assigns a lead, the header says so,
 * a reload still says so, and the feed's disposition filter finds it.
 */
let candidateId = "";

test.beforeAll(async () => {
  const userId = await clerkUserId();
  const out = execSync(`npx convex run internal.testing.seedSliceFixture '${JSON.stringify({ clerkUserId: userId })}'`, { encoding: "utf8" });
  candidateId = JSON.parse(out.slice(out.indexOf("{"))).candidateId as string;
});

// Removed so first-run.spec.ts still reads a clean workspace.
test.afterAll(async () => {
  const userId = await clerkUserId();
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: userId })}'`, { stdio: "ignore" });
});

test.beforeEach(async ({ page }) => {
  await signInOnly(page);
  await page.goto(`/leads/${candidateId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
});

test.describe("disposition", () => {
  test("assigning a lead is recorded, survives a reload, and reaches the feed filter", async ({ page }) => {
    const bar = page.getByRole("region", { name: "Your decision" });
    await expect(bar.getByRole("button", { name: "Assign" })).toBeEnabled();

    await bar.getByRole("button", { name: "Assign" }).click();
    // The header's disposition word is the live column; it must change
    // without a reload, and the pressed button must say it is the current one.
    await expect(page.getByText("Assigned", { exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Assign" })).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(page.getByText("Assigned", { exact: true })).toBeVisible();

    await page.goto("/workspace?disposition=assigned&view=excluded");
    const feed = page.getByRole("region", { name: "Leads" });
    await expect(feed.getByRole("article")).toHaveCount(1);
  });

  test("a note is saved and the field clears", async ({ page }) => {
    const bar = page.getByRole("region", { name: "Your decision" });
    await bar.getByLabel("Note").fill("Ask the county about matching funds.");
    await bar.getByRole("button", { name: "Save note" }).click();
    await expect(bar.getByText("Note saved")).toBeVisible();
    await expect(bar.getByLabel("Note")).toHaveValue("");
  });

  test("the decision is reachable by keyboard", async ({ page }) => {
    const reject = page.getByRole("region", { name: "Your decision" }).getByRole("button", { name: "Reject" });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      if (await reject.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(reject).toBeFocused();
  });
});
