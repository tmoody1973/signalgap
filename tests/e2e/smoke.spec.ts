import { expect, test } from "@playwright/test";

test("public page renders SignalGap", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SignalGap");
});
