/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_analyzeResults from "../ai/analyzeResults.js";
import type * as ai_classifyEvidence from "../ai/classifyEvidence.js";
import type * as ai_clusterSignals from "../ai/clusterSignals.js";
import type * as ai_contracts from "../ai/contracts.js";
import type * as ai_generateBrief from "../ai/generateBrief.js";
import type * as ai_planFollowUp from "../ai/planFollowUp.js";
import type * as ai_pricing from "../ai/pricing.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as ai_provider from "../ai/provider.js";
import type * as ai_runOperation from "../ai/runOperation.js";
import type * as ai_validateOutput from "../ai/validateOutput.js";
import type * as candidates_fingerprint from "../candidates/fingerprint.js";
import type * as candidates_form from "../candidates/form.js";
import type * as candidates_toEngineSource from "../candidates/toEngineSource.js";
import type * as config_beats from "../config/beats.js";
import type * as config_coverageOutlets from "../config/coverageOutlets.js";
import type * as config_officialDomains from "../config/officialDomains.js";
import type * as config_ruleset from "../config/ruleset.js";
import type * as config_searchBudget from "../config/searchBudget.js";
import type * as editorial_coverage from "../editorial/coverage.js";
import type * as editorial_eligibility from "../editorial/eligibility.js";
import type * as editorial_independence from "../editorial/independence.js";
import type * as editorial_judgment from "../editorial/judgment.js";
import type * as editorial_scoring from "../editorial/scoring.js";
import type * as editorial_searchIntent from "../editorial/searchIntent.js";
import type * as editorial_status from "../editorial/status.js";
import type * as editorial_types from "../editorial/types.js";
import type * as integrations_serpapi_canonical from "../integrations/serpapi/canonical.js";
import type * as integrations_serpapi_client from "../integrations/serpapi/client.js";
import type * as integrations_serpapi_contracts from "../integrations/serpapi/contracts.js";
import type * as integrations_serpapi_executeSearch from "../integrations/serpapi/executeSearch.js";
import type * as integrations_serpapi_normalize from "../integrations/serpapi/normalize.js";
import type * as integrations_serpapi_normalize_google from "../integrations/serpapi/normalize/google.js";
import type * as integrations_serpapi_normalize_shared from "../integrations/serpapi/normalize/shared.js";
import type * as integrations_serpapi_queryCatalog from "../integrations/serpapi/queryCatalog.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_validators from "../lib/validators.js";
import type * as modelRuns from "../modelRuns.js";
import type * as scans from "../scans.js";
import type * as searchRuns from "../searchRuns.js";
import type * as sourceResults from "../sourceResults.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/analyzeResults": typeof ai_analyzeResults;
  "ai/classifyEvidence": typeof ai_classifyEvidence;
  "ai/clusterSignals": typeof ai_clusterSignals;
  "ai/contracts": typeof ai_contracts;
  "ai/generateBrief": typeof ai_generateBrief;
  "ai/planFollowUp": typeof ai_planFollowUp;
  "ai/pricing": typeof ai_pricing;
  "ai/prompts": typeof ai_prompts;
  "ai/provider": typeof ai_provider;
  "ai/runOperation": typeof ai_runOperation;
  "ai/validateOutput": typeof ai_validateOutput;
  "candidates/fingerprint": typeof candidates_fingerprint;
  "candidates/form": typeof candidates_form;
  "candidates/toEngineSource": typeof candidates_toEngineSource;
  "config/beats": typeof config_beats;
  "config/coverageOutlets": typeof config_coverageOutlets;
  "config/officialDomains": typeof config_officialDomains;
  "config/ruleset": typeof config_ruleset;
  "config/searchBudget": typeof config_searchBudget;
  "editorial/coverage": typeof editorial_coverage;
  "editorial/eligibility": typeof editorial_eligibility;
  "editorial/independence": typeof editorial_independence;
  "editorial/judgment": typeof editorial_judgment;
  "editorial/scoring": typeof editorial_scoring;
  "editorial/searchIntent": typeof editorial_searchIntent;
  "editorial/status": typeof editorial_status;
  "editorial/types": typeof editorial_types;
  "integrations/serpapi/canonical": typeof integrations_serpapi_canonical;
  "integrations/serpapi/client": typeof integrations_serpapi_client;
  "integrations/serpapi/contracts": typeof integrations_serpapi_contracts;
  "integrations/serpapi/executeSearch": typeof integrations_serpapi_executeSearch;
  "integrations/serpapi/normalize": typeof integrations_serpapi_normalize;
  "integrations/serpapi/normalize/google": typeof integrations_serpapi_normalize_google;
  "integrations/serpapi/normalize/shared": typeof integrations_serpapi_normalize_shared;
  "integrations/serpapi/queryCatalog": typeof integrations_serpapi_queryCatalog;
  "lib/auth": typeof lib_auth;
  "lib/validators": typeof lib_validators;
  modelRuns: typeof modelRuns;
  scans: typeof scans;
  searchRuns: typeof searchRuns;
  sourceResults: typeof sourceResults;
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
