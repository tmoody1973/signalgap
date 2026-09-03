import { execSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { clerkUserId, signInOnly } from "./helpers/auth";

/**
 * The ranked feed, against `seedFeedFixture` — thirty leads built from real
 * captured SerpApi payloads. No live SerpApi call and no model call: what is
 * under test is the screen, not the network.
 *
 * **This fixture produces 0 eligible leads and 30 excluded, and every one of
 * the 30 carries no score.** That is the honest outcome of the real payloads
 * (task-6-report.md §1), not a defect. It is why there is no test here named
 * "best first": with no score on any lead the score comparator in
 * `convex/candidates/list.ts:106-112` never separates two cards, so a test of
 * that name could not be made to fail by breaking the thing it names. What the
 * sort CAN be held to against this fixture is its freshness tiebreak, and that
 * is what the ordering test below asserts.
 */

// The first three cards, in seeded freshness order (`firstSeenAt = now - i *
// 1000`, convex/testing.ts:1116), and the last card of page one.
const NEWEST = "Who is behind the Metcalfe Park Liberation Hub, and what did the plan commission approve?";
const SECOND = "What is the $1 million city loan for the Midtown apartment project paying for?";
const THIRD = "Ten years after the Sherman Park uprising, what has changed for the people who live there?";
const PAGE_ONE_LAST = "What goal does the column set for Kasparas Jakucionis’s development?";

// The three transportation leads — the smallest beat, so a filtered list can be
// asserted whole rather than by count alone.
const TRANSPORTATION = [
  "Which passenger train upgrades reach Wisconsin, and do any of them serve Milwaukee?",
  "What does the 16th Street Bridge rehabilitation involve, and when does the work start?",
  "What route does the Mayor's Back to School Bike Ride take, and who can join it?",
];

/**
 * Copy that would offer to move the bar. The product promise is that a scan
 * which found nothing points at what it ruled out — it never offers to relax a
 * rule, lower a score or widen a window.
 */
const BAR_MOVING_WORDS = ["lower", "relax", "loosen", "widen", "broaden", "threshold", "less strict"];


/** The feed's own section, so nothing here can be satisfied by the progress panel above it. */
const feedOf = (page: Page): Locator => page.getByRole("region", { name: "Leads" });

let userId = "";

// Seeded HERE, not on the deployment beforehand: global-setup.ts deletes every
// scan this Clerk user owns, so anything seeded earlier is gone by the time
// this file runs.
test.beforeAll(async () => {
  userId = await clerkUserId();
  const out = execSync(`npx convex run internal.testing.seedFeedFixture '${JSON.stringify({ clerkUserId: userId })}'`, {
    encoding: "utf8",
  });
  const counts = JSON.parse(out.slice(out.indexOf("{"))) as { eligibleCount: number; excludedCount: number };
  // Fail loudly here rather than let every test below fail obscurely: these two
  // numbers are the premise of the whole file.
  expect(counts).toMatchObject({ eligibleCount: 0, excludedCount: 30 });
});

// Removed so first-run.spec.ts still reads a clean workspace.
test.afterAll(() => {
  execSync(`npx convex run internal.testing.deleteScansForClerkUser '${JSON.stringify({ clerkUserId: userId })}'`, {
    stdio: "ignore",
  });
});

test.beforeEach(async ({ page }) => {
  await signInOnly(page);
});

test.describe("ranked feed", () => {
  test("shows all three counts, including the zero", async ({ page }) => {
    await page.goto("/workspace");
    const feed = feedOf(page);
    const views = feed.getByRole("navigation", { name: "Feed view" });

    // A zero that is hidden is a zero an editor cannot act on. "Ready (0)" is
    // the whole point of this assertion — it must be on screen, not omitted.
    await expect(views.getByRole("link", { name: "Ready (0)" })).toBeVisible();
    await expect(views.getByRole("link", { name: "Did not qualify (30)" })).toBeVisible();
    // exact: true — "0 still working" also substring-matches "10 still
    // working"; scoping to the feed keeps the progress panel's identical line
    // from satisfying this on the feed's behalf.
    await expect(feed.getByText("0 still working", { exact: true })).toBeVisible();
  });

  test("the did-not-qualify list leads with the newest lead, and no lead claims a score", async ({ page }) => {
    await page.goto("/workspace?view=excluded");
    const feed = feedOf(page);
    const questions = feed.getByRole("heading", { level: 3 });
    await expect(questions).toHaveCount(25);

    const texts = await questions.allInnerTexts();
    // Order, not membership: the three freshest leads, in that order. Breaking
    // the freshness tiebreak in listForScan reorders these.
    expect(texts.slice(0, 3)).toEqual([NEWEST, SECOND, THIRD]);
    expect(texts[24]).toBe(PAGE_ONE_LAST);

    // Excluded means NO score, never a zero. All 25 cards on this page say so
    // in words; a number here would be a claim this scan never made.
    await expect(feed.getByText("No score", { exact: true })).toHaveCount(25);
  });

  test("the didn't-qualify list names a reason for every one of its leads", async ({ page }) => {
    await page.goto("/workspace?view=excluded");
    const feed = feedOf(page);
    await expect(feed.getByRole("article")).toHaveCount(25);

    // "every one of its leads" means all thirty, so the second page is part of
    // the claim, not an extra.
    await feed.getByRole("button", { name: "Load next 25" }).click();
    await expect(feed.getByRole("article")).toHaveCount(30);
    await expect(feed.getByRole("button", { name: "Load next 25" })).toHaveCount(0);

    // One chip list per card. The full sentence lives on the lead page.
    await expect(feed.getByRole("list", { name: "Why it did not qualify" })).toHaveCount(30);
  });

  test("a lead links to its evidence page, and the link works", async ({ page }) => {
    await page.goto("/workspace?view=excluded");
    const feed = feedOf(page);
    // The one card carrying this exact question — not `.first()`, which would
    // pass against whatever happened to be at the top.
    const card = feed.getByRole("article").filter({
      has: page.getByRole("heading", { level: 3, name: NEWEST, exact: true }),
    });
    await expect(card).toHaveCount(1);

    await card.getByRole("link", { name: "Open evidence", exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/[a-z0-9]+$/);
    // The page that opens must be THIS lead's, which is what makes the link
    // "work" — a 200 on some other lead is a broken link that renders.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NEWEST, { timeout: 20_000 });
  });

  test("filtering by beat changes the list and the URL", async ({ page }) => {
    await page.goto("/workspace?view=excluded");
    const feed = feedOf(page);
    await expect(feed.getByRole("article")).toHaveCount(25);

    // Role-scoped and exact. Not getByLabel: this <label> WRAPS its <select>,
    // so the label's own text is "Beat" followed by every option in the list,
    // and a label query can only match it loosely.
    await feed.getByRole("combobox", { name: "Beat", exact: true }).selectOption("transportation");

    await expect(page).toHaveURL(/[?&]beat=transportation(&|$)/);
    await expect(page).toHaveURL(/[?&]view=excluded(&|$)/);
    // The whole filtered list, in order — a count alone would pass on the
    // wrong three cards.
    await expect(feed.getByRole("heading", { level: 3 })).toHaveText(TRANSPORTATION);
    // And the list really narrowed: the housing lead that led the unfiltered
    // list is gone, not merely pushed down.
    await expect(feed.getByRole("heading", { level: 3, name: NEWEST, exact: true })).toHaveCount(0);
  });

  test("a filtered URL pasted fresh loads that filtered view", async ({ page }) => {
    // The point of URL-backed filters: this is a link an editor can send, and
    // nothing about it depends on having clicked the select in this session.
    await page.goto("/workspace?view=excluded&beat=transportation");
    const feed = feedOf(page);

    await expect(feed.getByRole("heading", { level: 3 })).toHaveText(TRANSPORTATION);
    // The controls have to agree with the URL, or the next click starts from a
    // filter state the reader cannot see.
    await expect(feed.getByRole("combobox", { name: "Beat", exact: true })).toHaveValue("transportation");
    await expect(feed.getByRole("navigation", { name: "Feed view" }).getByRole("link", { name: "Did not qualify (30)" }))
      .toHaveAttribute("aria-current", "page");
  });

  test("filtering to nothing offers Clear filters", async ({ page }) => {
    // A label no lead in this scan carries: the fixture's labels are
    // `Worth a look` (25), `Unverified tip` (4) and `Needs a recheck` (1).
    await page.goto(`/workspace?view=excluded&label=${encodeURIComponent("Conflicting reports")}`);
    const feed = feedOf(page);

    await expect(feed.getByRole("article")).toHaveCount(0);
    await expect(feed.getByText("No leads in this list match these filters.", { exact: true })).toBeVisible();

    // Exactly one reset on screen, and it puts the reader back on the list.
    const clear = feed.getByRole("button", { name: "Clear filters" });
    await expect(clear).toHaveCount(1);
    await clear.click();
    await expect(feed.getByRole("article")).toHaveCount(25);
    await expect(page).toHaveURL(/\?view=excluded$/);
  });

  test("a scan with no eligible leads points at the exclusions rather than suggesting a lower bar", async ({ page }) => {
    await page.goto("/workspace");
    const feed = feedOf(page);

    await expect(feed.getByText("No leads qualified in this scan.", { exact: true })).toBeVisible();
    await expect(
      feed.getByText("All 30 leads this scan formed are in the did-not-qualify list, each with the rule it failed.", {
        exact: true,
      }),
    ).toBeVisible();

    // A real guard on a product promise, not a formality: no copy the feed
    // renders may offer to move the bar. Note this reads the whole region,
    // which includes every <option> in the three filter selects — so a future
    // beat, label or disposition containing one of these words would fail this
    // test for a reason unrelated to the empty state. Today the vocabularies
    // are clean; if that changes, narrow the locator rather than the word list.
    const copy = (await feed.innerText()).toLowerCase();
    for (const word of BAR_MOVING_WORDS) expect(copy, `feed copy offers to move the bar: "${word}"`).not.toContain(word);

    // And the pointer it offers instead actually goes somewhere.
    await feed.getByRole("link", { name: "See what did not qualify" }).click();
    await expect(page).toHaveURL(/[?&]view=excluded(&|$)/);
    await expect(feed.getByRole("article")).toHaveCount(25);
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/workspace?view=excluded");
    await expect(feedOf(page).getByRole("article")).toHaveCount(25);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});

/**
 * Three DISTINCT counts, so the slots can be told apart.
 *
 * The fixture above has eligible and processing both at zero, which means the
 * counts test in it passes on any wiring that puts *a* zero in each slot —
 * swapping two fields would not fail it. This block closes that: it seeds one
 * scan whose three counts are three different numbers and asserts each lands
 * where it belongs.
 *
 * It runs LAST on purpose. `seedScanInState` purges every existing scan for
 * this user before inserting its own, so it destroys the feed fixture — with a
 * single worker (playwright.config.ts) file order is execution order, and
 * nothing above may run after it.
 */
test.describe("the counts row maps each field to its own slot", () => {
  test("shows eligible, excluded and processing as three different numbers", async ({ page }) => {
    execSync(
      `npx convex run internal.testing.seedScanInState '${JSON.stringify({
        clerkUserId: userId, stage: "briefs", status: "running",
        eligibleCount: 7, excludedCount: 3, processingCount: 5,
      })}'`,
      { stdio: "ignore" },
    );
    await page.goto("/workspace");
    const feed = feedOf(page);
    const views = feed.getByRole("navigation", { name: "Feed view" });

    // A swap of any two of these three fails here, which the all-zeroes
    // fixture cannot detect.
    await expect(views.getByRole("link", { name: "Ready (7)" })).toBeVisible();
    await expect(views.getByRole("link", { name: "Did not qualify (3)" })).toBeVisible();
    await expect(feed.getByText("5 still working", { exact: true })).toBeVisible();
  });
});
