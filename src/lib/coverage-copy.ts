import type { EvidenceView } from "@/lib/evidence-view";

type PassStatus = EvidenceView["coverage"]["passStatus"];

/**
 * What one outlet box may claim about the 30-day coverage check.
 *
 * A coverage gap is a claim about the ABSENCE of reporting, so the three
 * outcomes have to stay separable in words: we looked and found nothing, we
 * looked and found something, and we do not know because the check did not
 * finish. Collapsing any two of those is how a product ends up telling an
 * editor "nobody covered this" when nobody actually looked.
 *
 * `originalReportCount` is an AGGREGATE across both partitions — the server
 * does not say which partition a report came from. So a box never names a
 * number: it would be inventing an attribution it was not given. The count
 * belongs to the sentence above the boxes, which has it right.
 */
export function coverageCheckText(passStatus: PassStatus, originalReportCount: number): string {
  if (passStatus === "failed") return "Did not finish";
  if (passStatus !== "complete") return "Not run yet";
  return originalReportCount === 0 ? "Checked · nothing found" : "Checked";
}
