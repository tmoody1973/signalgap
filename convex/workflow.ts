import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

/**
 * The one WorkflowManager. Its own module so nothing imports the orchestrator
 * just to reach the manager, which is how import cycles start.
 *
 * `retryActionsByDefault` stays FALSE. Our search and model actions are already
 * idempotent through reservation and idempotency keys, and a blind retry of a
 * paid SerpApi call spends money the budget did not authorise. Steps that are
 * genuinely safe to retry ask for it explicitly with `{ retry: true }`.
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // One scan should not be able to starve the deployment. 13 discovery
    // searches at a time is already more parallelism than SerpApi wants.
    maxParallelism: 5,
    retryActionsByDefault: false,
  },
});
