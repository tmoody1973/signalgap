import workflowTest from "@convex-dev/workflow/test";
import type { TestConvex } from "convex-test";
import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  const t = convexTest(schema, modules);
  // startScan/cancel call into the workflow component (convex/workflow.ts);
  // convex-test needs it registered or those calls throw "Component
  // \"workflow\" is not registered." This does not make the workflow run —
  // see the scan-workflow tests' own note on that.
  workflowTest.register(t);
  return t;
}

export const asUser = (t: ReturnType<typeof setup>, subject: string) =>
  t.withIdentity({ subject, tokenIdentifier: `clerk|${subject}`, name: subject, email: `${subject}@example.com` });

/**
 * Shared across every test that needs an owner to exist before startScan.
 * One definition — item 7 went wrong when three tasks each kept their own
 * drifting copy of this.
 */
export async function seedUser(t: TestConvex<typeof schema>, clerkUserId = "owner"): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { clerkUserId, createdAt: Date.now(), updatedAt: Date.now() }),
  );
}

const EMPTY_SERP = {
  search_metadata: { id: "x", status: "Success" },
  organic_results: [],
};

/**
 * A `fetch` stand-in for SerpApi. Every query gets EMPTY_SERP unless one of
 * `byQueryNeedle`'s keys appears in the rendered query string, in which case
 * that entry's body is returned instead.
 */
export function fakeFetch(byQueryNeedle: Record<string, unknown> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const body = Object.entries(byQueryNeedle).find(([needle]) => q.includes(needle))?.[1] ?? EMPTY_SERP;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
