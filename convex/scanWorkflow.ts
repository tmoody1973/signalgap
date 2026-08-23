import { v } from "convex/values";
import { workflow } from "./workflow";

/**
 * The scan's durable spine. It orchestrates and nothing else — every decision,
 * every write and every external call lives in a step.
 *
 * The handler is replayed from the top each time a step completes, so it must
 * stay deterministic: no `fetch`, no `process.env`, no unseeded randomness. The
 * component blocks those; this comment is here so nobody spends an hour finding
 * out why.
 */
export const runScan = workflow.define({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  // The explicit Promise<null> annotation breaks the type cycle that otherwise
  // forms through `internal.*` once steps are added in Task 3.
}).handler(async (_step, _args): Promise<null> => {
  // Tasks 3–8 fill this in, stage by stage.
  return null;
});
