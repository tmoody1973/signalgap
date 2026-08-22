/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as config_beats from "../config/beats.js";
import type * as config_coverageOutlets from "../config/coverageOutlets.js";
import type * as config_officialDomains from "../config/officialDomains.js";
import type * as config_ruleset from "../config/ruleset.js";
import type * as config_searchBudget from "../config/searchBudget.js";
import type * as editorial_coverage from "../editorial/coverage.js";
import type * as editorial_eligibility from "../editorial/eligibility.js";
import type * as editorial_independence from "../editorial/independence.js";
import type * as editorial_scoring from "../editorial/scoring.js";
import type * as editorial_status from "../editorial/status.js";
import type * as editorial_types from "../editorial/types.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validators from "../lib/validators.js";
import type * as scans from "../scans.js";
import type * as searchRuns from "../searchRuns.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "config/beats": typeof config_beats;
  "config/coverageOutlets": typeof config_coverageOutlets;
  "config/officialDomains": typeof config_officialDomains;
  "config/ruleset": typeof config_ruleset;
  "config/searchBudget": typeof config_searchBudget;
  "editorial/coverage": typeof editorial_coverage;
  "editorial/eligibility": typeof editorial_eligibility;
  "editorial/independence": typeof editorial_independence;
  "editorial/scoring": typeof editorial_scoring;
  "editorial/status": typeof editorial_status;
  "editorial/types": typeof editorial_types;
  "lib/auth": typeof lib_auth;
  "lib/validators": typeof lib_validators;
  scans: typeof scans;
  searchRuns: typeof searchRuns;
  testing: typeof testing;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
