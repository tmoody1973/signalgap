export const SEARCH_BUDGET = {
  // ponytail: ceiling, not a target — 13 of the 16 discovery slots are used
  // today (decision 005 moved Google Events to enrichment). Left at 16 so the
  // reservation tests don't churn for no gain.
  discovery: 16,
  coverage: 20,
  corroboration: 20,
  enrichment: 30,
  reserve: 34,
  hardCap: 120,
} as const;
