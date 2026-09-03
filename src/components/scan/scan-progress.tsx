import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/untitled/button";
import { analysisProgressText } from "@/lib/analysis-progress";
import { failureText } from "@/lib/failure-text";
import { SavedCopyNotice } from "@/components/ui/editorial/saved-copy-notice";
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
 * The buttons are the only interactive pieces here, so the component stays a
 * plain function — the workspace page's client boundary already covers it.
 *
 * `onOpenSavedDemo` is item 10's dependency-failure action. It sits in this
 * panel, directly under the named failures, because that is where an editor is
 * looking at the moment a live scan has just failed them. It is a button, never
 * an automatic swap: choosing saved data over live data is a human's call, and
 * whatever it opens arrives carrying `SavedCopyNotice`.
 */
export function ScanProgress({
  scan,
  onCancel,
  onRunNewScan,
  runNewScanDisabled,
  onOpenSavedDemo,
  onShowLatestScan,
}: {
  scan: Scan;
  onCancel?: () => void;
  onRunNewScan?: () => void;
  runNewScanDisabled?: boolean;
  onOpenSavedDemo?: () => void;
  onShowLatestScan?: () => void;
}) {
  const analysisProgress = analysisProgressText(scan.sourcesAnalyzed, scan.sourcesTotal);

  // The same rule the feed applies: a scan is finished when it is completed,
  // partial or canceled. Anything else still has work in flight — and
  // `startScan` throws "A scan is already running" against exactly that, so
  // this is the guard, not a cosmetic one.
  const isFinished = scan.status === "completed" || scan.status === "partial" || scan.status === "canceled";
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

      {/* Above the stages, not below them. An editor must know the data is a
          saved copy BEFORE they read a single number off it. */}
      {scan.isSavedDemo && scan.captureTimestamp !== undefined && (
        <SavedCopyNotice captureTimestamp={scan.captureTimestamp} className="mt-2.5" />
      )}

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

      {/* The only thing that moves while the scan reads its sources. Searches
          are already spent by then and no lead exists yet, so without this line
          the panel is motionless for the longest part of a scan. Hidden once
          the scan is finished: a snapshot does not report progress. */}
      {!isFinished && analysisProgress && (
        <p className="mt-1 text-sm text-muted">{analysisProgress}</p>
      )}

      {scan.failureSummaries.length > 0 && (
        <ul className="mt-3">
          {scan.failureSummaries.map((failure) => {
            const { headline, detail } = failureText(failure.code, failure.message);
            return (
              <li key={`${failure.purpose}:${failure.code}`} className="border-t border-rule py-2 text-sm">
                {/* The purpose span keeps its exact text: the e2e suite asserts
                    "coverage" here, and the stage name above is the longer
                    "Reviewing existing coverage", so this is what it targets. */}
                <span className="text-xs uppercase tracking-wide text-muted">{failure.purpose}</span>
                <span className="mt-0.5 block">{headline}</span>
                {detail && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Technical detail</summary>
                    <p className="mt-1 font-mono text-xs break-words text-muted">{detail}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Exactly one of these is ever on screen, and which one is decided by
          the same fact: an unfinished scan can only be stopped, a finished one
          can only be replaced. The feed's empty state keeps its own copy of
          this button, but the feed only renders one when a list is EMPTY — so
          with a lead on screen this panel is the only way to start a scan. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {!isFinished
          ? onCancel && (
            <Button color="secondary" size="sm" onPress={onCancel}>
              Cancel scan
            </Button>
          )
          : onRunNewScan && (
            <Button color="secondary" size="sm" onPress={onRunNewScan} isDisabled={runNewScanDisabled}>
              Run new scan
            </Button>
          )}
        {onOpenSavedDemo && (
          <Button color="secondary" size="sm" onPress={onOpenSavedDemo}>
            Open saved scan
          </Button>
        )}
        {onShowLatestScan && (
          <Button color="secondary" size="sm" onPress={onShowLatestScan}>
            Back to latest scan
          </Button>
        )}
      </div>
    </section>
  );
}
