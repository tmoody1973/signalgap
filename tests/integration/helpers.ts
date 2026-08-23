import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
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
