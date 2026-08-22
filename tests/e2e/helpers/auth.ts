import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

export async function signIn(page: Page) {
  const email = process.env.E2E_CLERK_EMAIL;
  if (!email) throw new Error("Set E2E_CLERK_EMAIL");
  await page.goto("/");
  // ponytail: password strategy hits Clerk's "needs_client_trust" device gate on this dev
  // instance and @clerk/testing's password path doesn't handle it. The email/ticket
  // strategy signs in via the Backend API and bypasses that gate entirely.
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/workspace");
  await page.waitForSelector("text=No scans yet");
}
