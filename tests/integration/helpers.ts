import { convexTest } from "convex-test";
import schema from "../../convex/schema";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export const asUser = (t: ReturnType<typeof setup>, subject: string) =>
  t.withIdentity({ subject, tokenIdentifier: `clerk|${subject}`, name: subject, email: `${subject}@example.com` });
