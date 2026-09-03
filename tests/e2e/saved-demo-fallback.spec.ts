import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { clerkUserId, signInOnly } from "./helpers/auth";

/**
 * Item 10's dependency-failure path: when a live scan cannot be trusted, an
 * editor explicitly chooses `Open saved scan` and gets data that is
 * unmistakably saved.
 *
 * **What this file is for is the UI contract, not the import.** The export and
 * the idempotent import are covered by `tests/integration/saved-demo-import.
 * test.ts`, which proves them against convex-test in milliseconds. Importing the
 * real 2.3 MB fixture here would upload ~2,069 rows inside a `beforeAll` on a
 * suite that already runs `workers: 1`, to assert things about a label. So the
 * two scans below are seeded from existing fixtures and marked with the real
 * `demoScan:setSavedDemo` — the same mutation that marked the real scan.
 *
 * The seeding order matters: `seedScanInState` purges every scan the owner has
 * before inserting, so it MUST run first. `seedFeedFixture` only purges its own
 * `fixture-feed-` rows, so it leaves that scan alone.
 */

// The saved scan is `seedFeedFixture`'s, whose `startedAt` is FEED_NOW - 300_000
// (convex/testing.ts:469) = 1787529300000. `seedScanInState` uses `Date.now()`,
// so the failed live scan is always the newer of the two and the workspace
// opens on it — which is the only reason the fallback action is reachable.
const CAPTURED = "Captured Aug 23, 2026, 6:55 PM CDT";

// Hardcoded rather than recomputed from the constant: a test that recalculates
// the string with the same code under test would still pass if the formatter
// broke. This is the reading an editor gets, in Milwaukee's clock.
const NOTICE = `${CAPTURED}. From an earlier scan. May not be current.`;

const progress = (page: Page) => page.getByRole("region", { name: "Scan progress" });

let userId = "";

test.beforeAll(async () => {
  userId = await clerkUserId();
  const run = (fn: string, args: object) =>
    JSON.parse(execSync(`npx convex run internal.${fn} '${JSON.stringify(args)}'`, { encoding: "utf8" }).replace(/^[^{]*/, ""));

  // First: the newer live scan that failed. A named coverage failure is exactly
  // the moment the spec says an editor reaches for the saved copy.
  run("testing.seedScanInState", { clerkUserId: userId, stage: "coverage", status: "partial", withFailure: true });
  // Then the older scan that becomes the saved copy.
  const feed = run("testing.seedFeedFixture", { clerkUserId: userId });
  const marked = run("demoScan.setSavedDemo", { scanId: feed.scanId, isSavedDemo: true });
  // The premise of every test below. Fail here, loudly, rather than let them
  // all fail obscurely three assertions deep.
  expect(marked).toMatchObject({ isSavedDemo: true, captureTimestamp: 1787529300000 });
});

// Removed so first-run.spec.ts still reads a clean workspace. Its `signIn`
// helper waits for "No scans yet", so a scan left behind for this user is a
// hang, not a failure — and the file ordering that would otherwise save us is
// incidental, not a guarantee.
test.afterAll(() => {
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: userId })}'`, { stdio: "ignore" });
});

test.beforeEach(async ({ page }) => {
  await signInOnly(page);
  await page.goto("/workspace");
});

test.describe("saved demo fallback", () => {
  test("never substitutes saved data on its own", async ({ page }) => {
    // The workspace opens on the LIVE scan even though a saved one exists.
    await expect(page.getByRole("heading", { name: "Latest scan" })).toBeVisible();
    await expect(page.getByText("Saved copy")).toHaveCount(0);
    await expect(page.getByText(/^Captured /)).toHaveCount(0);
    // And it is offered, not taken.
    await expect(progress(page).getByRole("button", { name: "Open saved scan" })).toBeVisible();
  });

  test("the action is keyboard reachable", async ({ page }) => {
    const action = progress(page).getByRole("button", { name: "Open saved scan" });
    await expect(action).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await action.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(action).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Saved scan" })).toBeVisible();
  });

  test("choosing it says so in words, not colour", async ({ page }) => {
    await progress(page).getByRole("button", { name: "Open saved scan" }).click();

    await expect(page.getByRole("heading", { name: "Saved scan" })).toBeVisible();
    // The label is TEXT inside a rule, and the sentence beside it names both the
    // capture moment and the caveat. That is what survives greyscale — asserting
    // the words is the real guarantee, where asserting a colour would not be.
    const notice = progress(page).getByText(NOTICE);
    await expect(notice).toBeVisible();
    await expect(progress(page).getByText("Saved copy", { exact: true })).toBeVisible();
  });

  test("going back to the live scan drops the notice", async ({ page }) => {
    await progress(page).getByRole("button", { name: "Open saved scan" }).click();
    await expect(progress(page).getByText("Saved copy", { exact: true })).toBeVisible();

    await progress(page).getByRole("button", { name: "Back to latest scan" }).click();
    await expect(page.getByRole("heading", { name: "Latest scan" })).toBeVisible();
    await expect(page.getByText("Saved copy")).toHaveCount(0);
  });

  test("filtering the saved feed does not silently flip back to live data", async ({ page }) => {
    await progress(page).getByRole("button", { name: "Open saved scan" }).click();
    const feed = page.getByRole("region", { name: "Leads" });
    await expect(feed.getByRole("navigation", { name: "Feed view" }).getByRole("link", { name: "Did not qualify (30)" })).toBeVisible();

    // The feed's filters are URL-backed while the saved/live choice is component
    // state. Changing the URL must not quietly swap the data underneath the
    // notice — that would put live results on screen still labelled saved, or
    // saved results on screen with no label at all.
    await feed.getByRole("navigation", { name: "Feed view" }).getByRole("link", { name: "Did not qualify (30)" }).click();
    await expect(page.getByRole("heading", { name: "Saved scan" })).toBeVisible();
    await expect(progress(page).getByText(NOTICE)).toBeVisible();
  });

  test("a reload does not leave saved data on screen", async ({ page }) => {
    await progress(page).getByRole("button", { name: "Open saved scan" }).click();
    await expect(page.getByRole("heading", { name: "Saved scan" })).toBeVisible();

    // Saved is never sticky. A fresh load is a fresh choice, and the safe
    // default is the live scan.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Latest scan" })).toBeVisible();
    await expect(page.getByText("Saved copy")).toHaveCount(0);
  });

  test("the notice follows the reader into the evidence view", async ({ page }) => {
    await progress(page).getByRole("button", { name: "Open saved scan" }).click();
    const feed = page.getByRole("region", { name: "Leads" });
    await feed.getByRole("navigation", { name: "Feed view" }).getByRole("link", { name: "Did not qualify (30)" }).click();
    await feed.getByRole("link", { name: "Open evidence", exact: true }).first().click();

    await expect(page).toHaveURL(/\/leads\//);
    // Step 8 of the demo continues the evidence journey from here. The reader
    // must not have to remember the warning from the previous screen.
    await expect(page.getByText("Saved copy", { exact: true })).toBeVisible();
    await expect(page.getByText(NOTICE)).toBeVisible();
  });
});
