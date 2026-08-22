import { CONFIRMING_CATEGORIES, PRIMARY_CATEGORIES, type EngineSource, type SignalCategory } from "./types";

export type IndependenceGroupSummary = { group: string; category: SignalCategory; sourceIds: string[] };

export type IndependenceSummary = {
  independentCategoryCount: number;
  hasPrimary: boolean;
  groups: IndependenceGroupSummary[];
  nonConfirmingSourceIds: string[];
};

export function independenceSummary(sources: EngineSource[]): IndependenceSummary {
  const accessible = sources.filter((s) => s.isAccessible);
  const nonConfirmingSourceIds = accessible.filter((s) => !CONFIRMING_CATEGORIES.has(s.signalCategory)).map((s) => s.id);
  const confirming = accessible.filter((s) => CONFIRMING_CATEGORIES.has(s.signalCategory));

  const byGroup = new Map<string, IndependenceGroupSummary>();
  for (const s of confirming) {
    const existing = byGroup.get(s.independenceGroup);
    byGroup.set(s.independenceGroup, existing
      ? { ...existing, sourceIds: [...existing.sourceIds, s.id] }
      : { group: s.independenceGroup, category: s.signalCategory, sourceIds: [s.id] });
  }
  const groups = [...byGroup.values()];
  const categories = new Set(groups.map((g) => g.category));
  return {
    independentCategoryCount: categories.size,
    hasPrimary: groups.some((g) => PRIMARY_CATEGORIES.has(g.category)),
    groups,
    nonConfirmingSourceIds,
  };
}
