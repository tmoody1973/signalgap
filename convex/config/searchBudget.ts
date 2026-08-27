export const SEARCH_BUDGET = {
  // ponytail: ceiling, not a target — 17 of the 20 discovery slots are used
  // today. Each beat contributes four fixed searches (news, Reddit, Spanish,
  // official domains) and the trend feed adds one, so a fourth beat pushed the
  // set past the old 16-call allocation. Raised to 20 and taken out of the
  // retry reserve, so the 120 hard cap and every other allocation are unmoved.
  discovery: 20,
  coverage: 20,
  corroboration: 20,
  enrichment: 30,
  reserve: 30,
  hardCap: 120,
} as const;
