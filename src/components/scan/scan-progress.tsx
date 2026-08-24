import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/untitled/button";
import { StatusLabel } from "@/components/ui/editorial/status-label";
import { PRODUCT_LABELS, STAGE_TEXT, type Stage } from "@/lib/source-labels";

type Scan = NonNullable<FunctionReturnType<typeof api.scans.get>>;

const STAGE_ORDER: Stage[] = ["discovery", "evidence", "coverage", "briefs"];

// Visible words, not colours. A status an editor can only see if they can
// distinguish two shades of amber is a status half the newsroom cannot read.
const STATE_TEXT = {
  done: "Done",
  active: "Working",
  pending: "Not started",
  stopped: "Stopped",
} as const;

function stageState(stage: Stage, scan: Scan): keyof typeof STATE_TEXT {
  const current = STAGE_ORDER.indexOf(scan.stage as Stage);
  const index = STAGE_ORDER.indexOf(stage);
  const isTerminal = scan.status === "completed" || scan.status === "partial" || scan.status === "canceled";

  if (index < current) return "done";
  if (index > current) return scan.status === "canceled" ? "stopped" : "pending";
  // The current stage: finished if the scan finished, stopped if it was ended.
  if (scan.status === "canceled") return "stopped";
  return isTerminal ? "done" : "active";
}

/**
 * What the scan is doing, in the four names the product uses everywhere else.
 *
 * The cancel button is the only interactive piece here, so the component stays
 * a plain function — the workspace page's client boundary already covers it.
 */
export function ScanProgress({ scan, onCancel }: { scan: Scan; onCancel?: () => void }) {
  const terminalLabel =
    scan.status === "canceled" ? PRODUCT_LABELS.canceled
      : scan.status === "partial" ? PRODUCT_LABELS.partial
        : null;

  return (
    <section aria-labelledby="scan-progress-heading" className="border-t border-rule pt-5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 id="scan-progress-heading" className="font-editorial text-xl">Scan progress</h2>
        {terminalLabel && <StatusLabel label={terminalLabel} />}
      </div>

      <ol className="mt-3.5">
        {STAGE_ORDER.map((stage) => (
          <li key={stage} className="grid grid-cols-[1fr_auto] gap-4 border-t border-rule py-2.5 last:border-b">
            <span className="text-sm">{STAGE_TEXT[stage]}</span>
            <span className="text-xs uppercase tracking-wide text-muted">{STATE_TEXT[stageState(stage, scan)]}</span>
          </li>
        ))}
      </ol>

      {/* All three counts, always. Two zeroes and a number is information; one
          number on its own is a number an editor cannot place. */}
      <p className="mt-3 text-sm text-muted">
        <strong className="font-semibold text-ink">{scan.eligibleCount}</strong> ready
        {" · "}
        <strong className="font-semibold text-ink">{scan.excludedCount}</strong> did not qualify
        {" · "}
        <strong className="font-semibold text-ink">{scan.processingCount}</strong> still working
      </p>

      <p className="mt-1 text-sm text-muted">
        {scan.searchesReserved} of {scan.searchBudgetLimit} searches used
        {scan.searchesFailed > 0 && ` · ${scan.searchesFailed} failed`}
      </p>

      {scan.failureSummaries.length > 0 && (
        <ul className="mt-3">
          {scan.failureSummaries.map((failure) => (
            <li key={`${failure.purpose}:${failure.code}`} className="border-t border-rule py-2 text-sm">
              <span className="text-xs uppercase tracking-wide text-muted">{failure.purpose}</span>
              <span className="mt-0.5 block">{failure.message}</span>
            </li>
          ))}
        </ul>
      )}

      {onCancel && scan.status !== "completed" && scan.status !== "partial" && scan.status !== "canceled" && (
        <Button color="secondary" size="sm" className="mt-4" onPress={onCancel}>
          Cancel scan
        </Button>
      )}
    </section>
  );
}
