export const BEATS = {
  housing: { label: "Housing and neighborhood development", terms: ["housing", "zoning", "development", "displacement", "neighborhood"] },
  transportation: { label: "Transportation and access", terms: ["transit", "bus", "street", "bike", "access", "construction"] },
  culture: { label: "Arts, culture, and neighborhood life", terms: ["arts", "culture", "venue", "festival", "library", "museum"] },
} as const;
export type Beat = keyof typeof BEATS;
