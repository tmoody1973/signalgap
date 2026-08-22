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
