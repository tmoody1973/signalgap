export const PRODUCT_LABELS = {
  possibleDevelopment: "Possible development",
  unverifiedSignal: "Unverified signal",
  coverageGap: "Coverage gap detected",
  conflictingEvidence: "Conflicting evidence",
  reverificationNeeded: "Reverification needed",
  eligibilityChanged: "Eligibility changed",
  partial: "Partial",
  canceled: "Canceled—incomplete",
  outdated: "Outdated",
  savedNotLive: "Saved—not live",
} as const;

export type ProductLabel = (typeof PRODUCT_LABELS)[keyof typeof PRODUCT_LABELS];

export const STAGE_TEXT = {
  discovery: "Discovering signals",
  evidence: "Checking local evidence",
  coverage: "Reviewing existing coverage",
  briefs: "Preparing leads",
} as const;

export type Stage = keyof typeof STAGE_TEXT;

export const BEAT_TEXT = {
  housing: "Housing and neighborhood development",
  transportation: "Transportation and access",
  culture: "Arts, culture, and neighborhood life",
} as const;

export type Beat = keyof typeof BEAT_TEXT;

export type LabelTone = "neutral" | "caution" | "conflict" | "positive";

const TONES: Record<ProductLabel, LabelTone> = {
  "Possible development": "neutral",
  "Unverified signal": "caution",
  "Coverage gap detected": "positive",
  "Conflicting evidence": "conflict",
  "Reverification needed": "caution",
  "Eligibility changed": "caution",
  Partial: "caution",
  "Canceled—incomplete": "conflict",
  Outdated: "caution",
  "Saved—not live": "caution",
};

export const labelTone = (label: ProductLabel): LabelTone => TONES[label];

export const LABEL_EXPLANATIONS: Record<ProductLabel, string> = {
  "Possible development": "A candidate that may merit review but has not completed all eligibility or coverage work.",
  "Unverified signal": "A source useful for discovery that does not establish the underlying claim.",
  "Coverage gap detected": "An eligible lead whose 30-day coverage pass completed and found no more than two qualifying original reports.",
  "Conflicting evidence": "Material sources disagree and the issue remains unresolved.",
  "Reverification needed": "Previously cited support is currently inaccessible or no longer qualifies.",
  "Eligibility changed": "A saved or assigned lead no longer satisfies the current rules.",
  Partial: "A scan completed with one or more named source-family or search failures.",
  "Canceled—incomplete": "The user stopped a scan before all required work completed.",
  Outdated: "A reporting brief no longer reflects the current evidence set.",
  "Saved—not live": "Saved evidence from an earlier scan shown with its original timestamp.",
};

// ponytail: precompute arrays to avoid Object.values() allocation on every render
export const PRODUCT_LABELS_ARRAY = Object.values(PRODUCT_LABELS);
export const BEATS_ARRAY = Object.values(BEAT_TEXT);
