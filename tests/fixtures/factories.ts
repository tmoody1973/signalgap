import type { Id } from "../../convex/_generated/dataModel";

export const scanDoc = (ownerId: Id<"users">, overrides: Partial<Record<string, unknown>> = {}) => ({
  ownerId, marketKey: "milwaukee-wi" as const, rulesetVersion: "t", queryCatalogVersion: "t",
  status: "running" as const, stage: "discovery" as const, startedAt: 1_000,
  searchBudgetLimit: 120, searchesReserved: 0, searchesSucceeded: 0, searchesFailed: 0,
  eligibleCount: 0, excludedCount: 0, processingCount: 0, failureSummaries: [], isSavedDemo: false,
  ...overrides,
});

export const searchRunDoc = (scanId: Id<"scans">, ownerId: Id<"users">, rawStorageId?: Id<"_storage">) => ({
  scanId, ownerId, idempotencyKey: `${scanId}:discovery:news-housing-en-01:abc`, templateId: "news-housing-en-01",
  queryCatalogVersion: "t", purpose: "discovery" as const, engine: "google_news" as const,
  query: "Milwaukee (housing OR zoning)", parameters: { gl: "us", hl: "en" }, language: "en" as const,
  status: "succeeded" as const, attemptCount: 1, resultCount: 7, durationMs: 900, rawStorageId,
  reservedAt: 1_000, completedAt: 2_000,
});
