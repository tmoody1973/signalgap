// One-off capture tool: calls SerpApi once and writes a redacted fixture to
// tests/fixtures/serpapi/<out>.json. Not part of the app — run manually.
//
// Usage:
//   node scripts/capture-serpapi-fixture.ts --template <templateId> --out <name>
//   node scripts/capture-serpapi-fixture.ts --engine <engine> --query <query> --out <name>
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callSerpApi } from "../convex/integrations/serpapi/client";
import { MILWAUKEE_LOCATION, type SearchSpec, type SerpEngine } from "../convex/integrations/serpapi/contracts";
import { getTemplate, renderQuery } from "../convex/integrations/serpapi/queryCatalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) out[key] = argv[i + 1] ?? "";
  }
  return out;
}

// Strip search_metadata entirely and any api_key so nothing sensitive or
// account-specific lands in a fixture that gets committed to a public repo.
function redact(json: unknown, apiKey: string): unknown {
  const clone = JSON.parse(JSON.stringify(json));
  delete clone.search_metadata;
  if (clone.search_parameters && typeof clone.search_parameters === "object") {
    delete (clone.search_parameters as Record<string, unknown>).api_key;
  }
  if (JSON.stringify(clone).includes(apiKey)) {
    throw new Error("api key still present after redaction — refusing to write fixture");
  }
  return clone;
}

function buildSpec(args: Record<string, string>): SearchSpec {
  if (args.template) {
    const template = getTemplate(args.template);
    if (!template) throw new Error(`unknown template id: ${args.template}`);
    return {
      templateId: template.id,
      engine: template.engine,
      purpose: template.purposes[0],
      query: renderQuery(template, { now: Date.now(), terms: [] }),
      location: MILWAUKEE_LOCATION,
      language: template.language,
      timeWindow: template.timeWindow,
    };
  }
  if (args.engine && args.query) {
    return {
      templateId: `manual-${args.engine}`,
      engine: args.engine as SerpEngine,
      purpose: "discovery",
      query: args.query,
      location: MILWAUKEE_LOCATION,
      language: "en",
      timeWindow: "7d",
    };
  }
  throw new Error("pass either --template <id> or --engine <engine> --query <text>, plus --out <name>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not set");
  if (!args.out) throw new Error("--out <fixture-name> is required");

  const spec = buildSpec(args);
  console.log(`Calling SerpApi live: engine=${spec.engine} query=${JSON.stringify(spec.query)}`);
  const result = await callSerpApi(spec, { apiKey });
  if (!result.ok) throw new Error(`SerpApi call failed: ${result.errorCode} ${result.errorMessage}`);

  const clean = redact(result.json, apiKey);
  const outPath = path.resolve(__dirname, `../tests/fixtures/serpapi/${args.out}.json`);
  writeFileSync(outPath, JSON.stringify(clean, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
