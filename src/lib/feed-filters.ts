import { Beat, BEAT_TEXT, ProductLabel, PRODUCT_LABELS } from "./source-labels";

// Extracted from convex/lib/validators.ts vDisposition union.
// Mirrors the server-side validators for type safety at the boundary.
export type Disposition = "new" | "rejected" | "monitoring" | "assigned";

export type FeedFilters = {
  view: "eligible" | "excluded";
  beat: Beat | null;
  label: ProductLabel | null;
  disposition: Disposition | null;
};

// Valid vocabulary sets for validation.
const VALID_BEATS = new Set(Object.keys(BEAT_TEXT)) as Set<string>;
const VALID_LABELS = new Set(Object.values(PRODUCT_LABELS)) as Set<string>;
const VALID_DISPOSITIONS = new Set<string>(["new", "rejected", "monitoring", "assigned"]);

// Type guards: validates that a string is in the vocabulary and narrows to the correct type.
function isBeat(value: unknown): value is Beat {
  return typeof value === "string" && VALID_BEATS.has(value);
}

function isProductLabel(value: unknown): value is ProductLabel {
  return typeof value === "string" && VALID_LABELS.has(value);
}

function isDisposition(value: unknown): value is Disposition {
  return typeof value === "string" && VALID_DISPOSITIONS.has(value);
}

/**
 * Parses a URLSearchParams into a FeedFilters object.
 *
 * This is a trust boundary: the input is a URL a person can type or edit.
 * Unknown values are silently dropped to defaults, never passed downstream.
 * This function is total — it never throws.
 */
/**
 * Parses a URLSearchParams into a FeedFilters object.
 *
 * This is a trust boundary: the input is a URL a person can type or edit.
 * Unknown values are silently dropped to defaults, never passed downstream.
 * This function is total — it never throws.
 */
export function parseFeedFilters(params: URLSearchParams): FeedFilters {
  const beat = params.get("beat");
  const label = params.get("label");
  const disposition = params.get("disposition");
  const view = params.get("view");

  return {
    view: (view === "eligible" || view === "excluded") ? view : "eligible",
    beat: isBeat(beat) ? beat : null,
    label: isProductLabel(label) ? label : null,
    disposition: isDisposition(disposition) ? disposition : null,
  };
}

/**
 * Serializes a FeedFilters object to a URLSearchParams.
 * Omits null filters and the default view ("eligible") to produce clean URLs.
 */
export function feedFiltersToParams(filters: FeedFilters): URLSearchParams {
  const params = new URLSearchParams();

  // Only include non-null filters.
  if (filters.beat !== null) {
    params.set("beat", filters.beat);
  }
  if (filters.label !== null) {
    params.set("label", filters.label);
  }
  if (filters.disposition !== null) {
    params.set("disposition", filters.disposition);
  }

  // Include view only if it's not the default ("eligible").
  if (filters.view !== "eligible") {
    params.set("view", filters.view);
  }

  return params;
}
