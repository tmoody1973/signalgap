import { execSync } from "node:child_process";
import { clerkSetup } from "@clerk/testing/playwright";

// ponytail: resets the e2e test user's scans so first-run.spec.ts starts from
// a clean "No scans yet" state; failures are logged and swallowed so a flaky
// reset doesn't block the whole e2e run.
async function resetE2eUserScans() {
  const email = process.env.E2E_CLERK_EMAIL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!email || !secretKey) {
    console.warn("Skipping e2e scan reset: E2E_CLERK_EMAIL or CLERK_SECRET_KEY not set");
    return;
  }
  try {
    const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) throw new Error(`Clerk lookup failed: ${res.status}`);
    const users = (await res.json()) as Array<{ id: string }>;
    const clerkUserId = users[0]?.id;
    if (!clerkUserId) throw new Error("No Clerk user found for E2E_CLERK_EMAIL");
    execSync(`npx convex run testing:deleteScansForClerkUser '${JSON.stringify({ clerkUserId })}'`, { stdio: "inherit" });
  } catch (err) {
    console.warn("e2e scan reset failed, continuing:", err instanceof Error ? err.message : err);
  }
}

export default async function globalSetup() {
  await clerkSetup();
  await resetE2eUserScans();
}
