import type { EvidenceEntry, EvidenceView } from "@/lib/evidence-view";
import { CitationTrace } from "./citation-trace";
import { EvidenceItem } from "./evidence-item";

/**
 * A coverage gap is a claim about the ABSENCE of reporting, so it may only be
 * made when the check actually finished. Saying "nobody covered this" after a
 * failed pass would be the most damaging thing this product could get wrong —
 * so "checked and found nothing" and "we do not know" are worded differently.
 */
export function CoverageAudit({ coverage, entries }: {
  coverage: EvidenceView["coverage"];
  /** Evidence the rules classified as existing coverage. It belongs in this
   *  section, not in its own — and dropping it would hide a real citation. */
  entries: EvidenceEntry[];
}) {
  const complete = coverage.passStatus === "complete";
  const partText = complete
    ? "Checked · nothing found"
    : coverage.passStatus === "failed" ? "Did not finish" : "Not run yet";

  const status = complete
    ? `The 30-day check completed. ${coverage.originalReportCount} original ${coverage.originalReportCount === 1 ? "report" : "reports"} found.`
    : coverage.passStatus === "failed"
      ? "The 30-day check did not complete, so prior local reporting is unknown."
      : "The 30-day coverage check has not run yet.";

  return (
    <section aria-labelledby="coverage-heading" className="border-t border-rule pt-5">
      <h2 id="coverage-heading" className="font-editorial text-xl">Existing coverage</h2>
      <p className="mt-2 text-sm">{status}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-rule p-3">
          <p className="text-xs uppercase tracking-wide text-muted">General outlets</p>
          <p className={complete ? "mt-1 text-sm text-[var(--status-positive)]" : "mt-1 text-sm text-muted"}>{partText}</p>
        </div>
        <div className="rounded-md border border-rule p-3">
          <p className="text-xs uppercase tracking-wide text-muted">Community outlets</p>
          <p className={complete ? "mt-1 text-sm text-[var(--status-positive)]" : "mt-1 text-sm text-muted"}>{partText}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted">
        {coverage.gapAllowed
          ? <>Both halves finished, so this lead <strong className="font-semibold text-ink">can</strong> be called a coverage gap.</>
          : <>This lead <strong className="font-semibold text-ink">cannot</strong> be called a coverage gap.</>}
      </p>

      {coverage.reports.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          {coverage.reports.map((report) => (
            <CitationTrace key={report.sourceResultId} source={report} excerpt={null} />
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-3.5">
          {entries.map((entry) => <EvidenceItem key={entry.id} entry={entry} />)}
        </div>
      )}
    </section>
  );
}
