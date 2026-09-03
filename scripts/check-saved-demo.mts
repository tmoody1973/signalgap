// One-off visual check for the saved-demo fallback. Not part of the app and
// not part of the test suite — run it by hand against a dev server.
//
// Deliberately NOT run through playwright.config.ts: that config's globalSetup
// deletes the e2e user's scans, and the e2e user IS the owner of the scan being
// preserved. Running this through the config would destroy what it verifies.
//
// Usage:
//   set -a; . ./.env.local; set +a
//   PORT=3100 npm run dev &
//   node scripts/check-saved-demo.mts /tmp/sg          # screenshots go to /tmp/sg-*.png
import { chromium } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";

const BASE = process.env.SAVED_DEMO_BASE_URL ?? "http://localhost:3100";
const OUT = process.argv[2] ?? "/tmp/sg";

await clerkSetup();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, colorScheme: "light" });

await page.goto(`${BASE}/`);
await clerk.signIn({ page, emailAddress: process.env.E2E_CLERK_EMAIL! });
await page.goto(`${BASE}/workspace`);
await page.waitForSelector("h1", { timeout: 60_000 });

const report = async (stage: string) => {
  const h1 = await page.locator("h1").first().innerText();
  const buttons = await page.locator("button").allInnerTexts();
  const saved = await page.locator("text=Saved copy").count();
  const captured = await page.locator("text=/Captured /").allInnerTexts().catch(() => []);
  console.log(`\n[${stage}] h1=${JSON.stringify(h1)}`);
  console.log(`[${stage}] buttons=${JSON.stringify(buttons)}`);
  console.log(`[${stage}] "Saved copy" occurrences=${saved}`);
  console.log(`[${stage}] captured lines=${JSON.stringify(captured)}`);
  await page.screenshot({ path: `${OUT}-${stage}.png`, fullPage: false });
};

await report("latest");

// The explicit action.
await page.getByRole("button", { name: "Open saved scan" }).click();
await page.waitForTimeout(2500);
await report("saved");

// Greyscale: does "this is saved, not live" survive with no colour at all?
await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });
await page.screenshot({ path: `${OUT}-saved-greyscale.png` });

// Dark mode.
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-saved-dark.png` });
await page.emulateMedia({ colorScheme: "light" });

// Keyboard reachability of the action, from the top of the page.
await page.getByRole("button", { name: "Back to latest scan" }).click().catch(() => {});
await page.waitForTimeout(1500);
await page.keyboard.press("Escape");
await page.locator("body").click({ position: { x: 5, y: 5 } });
const reached: string[] = [];
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Tab");
  const label = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.tagName}:${(el.innerText ?? "").slice(0, 40)}` : "none";
  });
  reached.push(label);
  if (label.includes("Open saved scan")) break;
}
console.log(`\n[keyboard] reached "Open saved scan" after ${reached.length} tabs: ${reached.includes("BUTTON:Open saved scan")}`);
console.log(`[keyboard] focus trail tail: ${JSON.stringify(reached.slice(-4))}`);

// The lead itself, on the saved scan.
await page.getByRole("button", { name: "Open saved scan" }).click();
await page.waitForTimeout(2500);
const firstLead = page.locator('a[href^="/leads/"]').first();
const leadHref = await firstLead.getAttribute("href");
console.log(`\n[lead] first lead href=${leadHref}`);
await firstLead.click();
await page.waitForSelector("h1, h2", { timeout: 60_000 });
await page.waitForTimeout(3000);
const leadText = await page.locator("body").innerText();
console.log(`[lead] "Saved copy" on lead page=${await page.locator("text=Saved copy").count()}`);
console.log(`[lead] captured=${JSON.stringify(await page.locator("text=/Captured /").allInnerTexts())}`);
console.log(`[lead] first 1200 chars:\n${leadText.slice(0, 1200)}`);
await page.screenshot({ path: `${OUT}-lead.png`, fullPage: false });
await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });
await page.screenshot({ path: `${OUT}-lead-greyscale.png` });

await browser.close();
