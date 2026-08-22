import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // ponytail: workers: 1 — the Next.js dev server flakes (frame detached) under
  // concurrent navigations while compiling; serial execution trades a bit of
  // speed for deterministic runs. Revisit if suite runtime becomes a problem.
  workers: 1,
  use: { baseURL, colorScheme: "light" },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
