export const PRODUCT_LABELS = {
  possibleDevelopment: "Worth a look",
  unverifiedSignal: "Unverified tip",
  coverageGap: "Coverage gap",
  conflictingEvidence: "Conflicting reports",
  reverificationNeeded: "Needs a recheck",
  eligibilityChanged: "No longer qualifies",
  partial: "Incomplete scan",
  canceled: "Stopped early",
  outdated: "Outdated",
  savedNotLive: "Saved copy",
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
  "Worth a look": "neutral",
  "Unverified tip": "caution",
  "Coverage gap": "positive",
  "Conflicting reports": "conflict",
  "Needs a recheck": "caution",
  "No longer qualifies": "caution",
  "Incomplete scan": "caution",
  "Stopped early": "conflict",
  Outdated: "caution",
  "Saved copy": "caution",
};

export const labelTone = (label: ProductLabel): LabelTone => TONES[label];

export const LABEL_EXPLANATIONS: Record<ProductLabel, string> = {
  "Worth a look": "Might be a story. Checks are not finished yet.",
  "Unverified tip": "Points to something, but does not prove it.",
  "Coverage gap": "Two or fewer local outlets reported this in the last 30 days.",
  "Conflicting reports": "Sources disagree. Not sorted out yet.",
  "Needs a recheck": "A source link broke or changed. Check it again.",
  "No longer qualifies": "This lead stopped meeting the rules.",
  "Incomplete scan": "Some searches failed. Results may be missing.",
  "Stopped early": "You stopped this scan before it finished.",
  Outdated: "New evidence came in. Regenerate the brief.",
  "Saved copy": "From an earlier scan. May not be current.",
};
