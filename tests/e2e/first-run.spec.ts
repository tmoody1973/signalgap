import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";

test("first-run workspace names Milwaukee, beats, and Run first scan", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("City of Milwaukee", { exact: true })).toBeVisible();
  await expect(page.getByText("Housing and neighborhood development")).toBeVisible();
  await expect(page.getByText("Transportation and access")).toBeVisible();
  await expect(page.getByText("Arts, culture, and neighborhood life")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run first scan" })).toBeVisible();
  await expect(page.getByText(/AI output is not source evidence/)).toBeVisible();
});

test("signed-out user cannot open the workspace", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/sign-in/);
});
