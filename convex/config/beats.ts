export const BEATS = {
  housing: { label: "Housing and neighborhood development", terms: ["housing", "zoning", "development", "displacement", "neighborhood"] },
  transportation: { label: "Transportation and access", terms: ["transit", "bus", "street", "bike", "access", "construction"] },
  culture: { label: "Arts, culture, and neighborhood life", terms: ["arts", "culture", "venue", "festival", "library", "museum"] },
  // Aimed at the CIVIC half of sports and entertainment: the places, the money
  // and the school and parks programs. Deliberately no team names, no "game",
  // no "score" — those terms return national wire copy, which is what filed a
  // WNBA story and a US Open story under no beat at all in the 2026-08-26 scan.
  sports: { label: "Sports, venues, and recreation", terms: ["stadium", "arena", "ballpark", "athletics", "recreation"] },
} as const;
export type Beat = keyof typeof BEATS;
