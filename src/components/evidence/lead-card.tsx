import { StatusLabel } from "@/components/ui/editorial/status-label";
import type { EvidenceView } from "@/lib/evidence-view";
import { displayBeat } from "@/lib/source-labels";

const DISPOSITION_TEXT = {
  new: "New",
  rejected: "Rejected",
  monitoring: "Monitoring",
  assigned: "Assigned",
} as const;

/**
 * The lead's identity line. The reporting question leads, because that is what
 * a journalist decides on — not the working title we clustered under.
 */
export function LeadCard({ candidate, sourceCount, coverage }: {
  candidate: EvidenceView["candidate"];
  sourceCount: number;
  coverage: EvidenceView["coverage"];
}) {
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel label={candidate.label} />
        <span className="text-xs text-muted">{displayBeat(candidate.beat, candidate.exclusionReasons)}</span>
      </div>

      <h1 className="font-editorial text-3xl leading-tight text-pretty">
        {candidate.reportingQuestion || candidate.title}
      </h1>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          {candidate.scoreTotal === null
            // spec.md:711 — `Worth a look` means "useful signals, has not passed
            // every gate". Saying only "did not qualify" next to it read as a
            // contradiction. This states the same verdict in the label's terms.
            ? "Has signal, but has not passed every rule — no score"
            : <><strong className="font-semibold text-ink">{candidate.scoreTotal}</strong> of 100</>}
        </span>
        <span>{sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
        {/* A flat "0 prior reports" is a claim about the ABSENCE of reporting.
            It may only be made once the coverage check actually finished. */}
        <span>
          {coverage.passStatus === "complete"
            ? `${coverage.originalReportCount} prior ${coverage.originalReportCount === 1 ? "report" : "reports"}`
            : "Prior reports not checked"}
        </span>
        <span>{DISPOSITION_TEXT[candidate.disposition]}</span>
      </div>
    </header>
  );
}
