// One-off capture tool: reads the marked saved-demo scan out of a Convex
// deployment and writes it to tests/fixtures/demo/demo-scan.json. Not part of
// the app — run manually, then commit the fixture.
//
// Usage:
//   set -a; . ./.env.local; set +a
//   node scripts/export-demo-scan.ts --scan k17d48736cyxjgzq8yz16w11yx8d60a3
//
// Raw SerpApi payloads are NOT exported. They live in Convex File Storage and
// stay there; only the searchRun row that points at them travels.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors `EXPORT_PARTS` in convex/demoScan.ts. Not imported from there: that
// module pulls in the Convex server runtime, which will not load in plain node.
// A part named here that the query does not know is rejected by its own
// validator, so the two cannot silently disagree.
const EXPORT_PARTS = [
  "scan", "searchRuns", "sourceResults", "candidates", "candidateAppearances",
  "candidateSources", "evidenceItems", "briefVersions", "modelRuns", "editorEvents",
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "tests", "fixtures", "demo", "demo-scan.json");

const scanId = process.argv[process.argv.indexOf("--scan") + 1];
if (!scanId || scanId.startsWith("--")) throw new Error("usage: export-demo-scan.ts --scan <scanId>");

const run = (part: string): Record<string, unknown>[] => {
  const out = execFileSync(
    "npx",
    ["convex", "run", "demoScan:exportPart", JSON.stringify({ scanId, part })],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  // The CLI prints warnings before the JSON; the payload starts at the array.
  return JSON.parse(out.slice(out.indexOf("[")));
};

const snapshot: Record<string, unknown[]> = {};
for (const part of EXPORT_PARTS) {
  snapshot[part] = run(part);
  process.stdout.write(`${part}: ${snapshot[part].length}\n`);
}

const scan = snapshot.scan[0] as { isSavedDemo?: boolean; captureTimestamp?: number } | undefined;
if (!scan?.isSavedDemo || scan.captureTimestamp === undefined) {
  throw new Error("Scan is not marked as a saved demo with a capture timestamp — run demoScan:setSavedDemo first");
}

const serialized = JSON.stringify(snapshot, null, 2);
// A fixture that leaks a key is worse than no fixture. Refuse rather than warn.
for (const pattern of [/api_key=/, /sk-ant-/, /sk-proj-/, /Bearer\s+[A-Za-z0-9._-]{16,}/]) {
  if (pattern.test(serialized)) throw new Error(`Refusing to write: fixture matches ${pattern}`);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${serialized}\n`);
process.stdout.write(`wrote ${OUT} (${serialized.length} bytes)\n`);
