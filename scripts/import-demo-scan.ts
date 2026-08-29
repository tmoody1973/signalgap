// Idempotent import of the approved saved demo snapshot
// (`tests/fixtures/demo/demo-scan.json`) into a Convex deployment.
//
// Usage:
//   set -a; . ./.env.local; set +a
//   node scripts/import-demo-scan.ts --clerk-user <clerkUserId>
//   node scripts/import-demo-scan.ts --clerk-user <clerkUserId> --prod
//
// Running it twice is safe: the mutation replaces any saved demo this owner
// already has with the SAME capture timestamp, so nothing doubles.
//
// The fixture is ~2.3 MB, well past what a shell can pass as an argument, so it
// goes up through Convex File Storage and is read back inside the deployment.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "demo", "demo-scan.json");

const argv = process.argv;
const clerkUserId = argv[argv.indexOf("--clerk-user") + 1];
if (!clerkUserId || clerkUserId.startsWith("--")) throw new Error("usage: import-demo-scan.ts --clerk-user <clerkUserId> [--prod]");
const target = argv.includes("--prod") ? ["--prod"] : [];

const run = (fn: string, args: unknown): unknown => {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args), ...target], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  // The CLI prints warnings before the payload; JSON starts at the first quote
  // or brace it emits.
  const at = out.search(/["{[]/);
  return JSON.parse(out.slice(at));
};

const body = readFileSync(FIXTURE);
const uploadUrl = run("demoScan:generateSnapshotUploadUrl", {}) as string;

const response = await fetch(uploadUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
if (!response.ok) throw new Error(`upload failed: ${response.status} ${await response.text()}`);
const { storageId } = (await response.json()) as { storageId: string };

const result = run("demoScan:importFromStorage", { clerkUserId, storageId });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
