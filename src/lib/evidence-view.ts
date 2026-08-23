import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/**
 * The components take their types from the query itself, so a field renamed in
 * Convex breaks the build rather than rendering blank.
 */
export type EvidenceView = NonNullable<FunctionReturnType<typeof api.evidence.forCandidate>>;
export type EvidenceSource = EvidenceView["evidence"][number]["sources"][number];
export type EvidenceEntry = EvidenceView["evidence"][number];
export type ScoreComponentView = NonNullable<EvidenceView["score"]>["components"][number];
export type BriefView = NonNullable<EvidenceView["brief"]>;
