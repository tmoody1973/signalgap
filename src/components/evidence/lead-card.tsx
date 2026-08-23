import { StatusLabel } from "@/components/ui/editorial/status-label";
import type { EvidenceView } from "@/lib/evidence-view";
import { BEAT_TEXT } from "@/lib/source-labels";

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
        <span className="text-xs text-muted">{BEAT_TEXT[candidate.beat]}</span>
      </div>

      <h1 className="font-editorial text-3xl leading-tight text-pretty">
        {candidate.reportingQuestion || candidate.title}
      </h1>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          {candidate.scoreTotal === null
            ? "No score — this lead did not qualify"
            : <><strong className="font-semibold text-ink">{candidate.scoreTotal}</strong> of 100</>}
        </span>
        <span>{sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
        <span>{coverage.originalReportCount} prior {coverage.originalReportCount === 1 ? "report" : "reports"}</span>
        <span>{DISPOSITION_TEXT[candidate.disposition]}</span>
      </div>
    </header>
  );
}
