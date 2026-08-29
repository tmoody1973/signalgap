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

/**
 * Signs in without waiting for the empty-workspace state. `signIn` waits for
 * "No scans yet", which is right for the first-run spec and wrong for any spec
 * that seeds a scan first.
 */
export async function signInOnly(page: Page) {
  const email = process.env.E2E_CLERK_EMAIL;
  if (!email) throw new Error("Set E2E_CLERK_EMAIL");
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });
}

/**
 * The Clerk user id behind `E2E_CLERK_EMAIL`, which is what every
 * `internal.testing.*` seeder keys on.
 *
 * One copy, because decision 011 had to repoint this account once already and
 * four drifting copies of the lookup is how the next repoint half-lands.
 */
export async function clerkUserId(): Promise<string> {
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
