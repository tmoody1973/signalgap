"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { SavedCopyNotice } from "@/components/ui/editorial/saved-copy-notice";
import { CoverageAudit } from "./coverage-audit";
import { DispositionBar } from "./disposition-bar";
import { EvidenceItem } from "./evidence-item";
import { LeadCard } from "./lead-card";
import { ReportingBrief } from "./reporting-brief";
import { ScoreBreakdown } from "./score-breakdown";
import { StartHere } from "./start-here";
import { WhyThisSurfaced } from "./why-this-surfaced";

/**
 * The section order, top to bottom: saved-copy notice, lead card, decision
 * bar, Start here, score, why this surfaced, evidence kinds with entries,
 * kinds without entries, needs a recheck, coverage, full brief, query log,
 * brief versions.
 *
 * Start here and the decision bar sit directly under the headline, above the
 * score — that hoist is the spec's, not a preference. See
 * `docs/reviews/2026-08-30-journalist-ux-review.md`.
 */
const KIND_SECTIONS = [
  { kind: "confirmed_fact", heading: "Confirmed facts", empty: "Nothing here has been independently confirmed yet. Treat every claim on this page as unverified." },
  { kind: "unverified_signal", heading: "Unverified signals", empty: "No unverified claims were extracted from the cited sources." },
  { kind: "conflicting_claim", heading: "Conflicting claims", empty: "No conflicting reports were found among the cited sources." },
  { kind: "potential_source", heading: "Potential human sources", empty: "No named people were identified in the cited sources." },
] as const;

export function EvidenceViewPanel({ candidateId }: { candidateId: Id<"candidates"> }) {
  // ponytail: gate on isAuthenticated — Convex has not attached the Clerk token
  // on first mount, so an ungated query throws "Unauthenticated" once and never
  // retries, leaving the page permanently on its error boundary. Same trap the
  // workspace page hit.
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(api.evidence.forCandidate, isAuthenticated ? { candidateId } : "skip");

  if (view === undefined) return <p className="text-sm text-muted">Loading this lead…</p>;
  if (view === null) return <p className="text-sm text-muted">This lead is not available.</p>;

  const sourceCount = new Set(view.evidence.flatMap((e) => e.sources.map((s) => s.sourceResultId))).size;
  const needsRecheck = view.evidence.filter((e) => e.requiresReverification);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-7 pb-16">
      {/* First thing on the page, above the lead itself. The demo journey walks
          from the workspace into this view, and an editor must not have to
          remember from the previous screen that this is saved data. */}
      {view.savedCopy && <SavedCopyNotice captureTimestamp={view.savedCopy.captureTimestamp} />}
      <LeadCard candidate={view.candidate} sourceCount={sourceCount} coverage={view.coverage} />
      <DispositionBar candidate={view.candidate} />
      <StartHere brief={view.brief} />
      <ScoreBreakdown score={view.score} judgment={view.judgment} exclusionReasons={view.candidate.exclusionReasons} />
      <WhyThisSurfaced items={view.whySurfaced} />

      {(() => {
        const present = KIND_SECTIONS.filter(({ kind }) => view.evidence.some((e) => e.kind === kind));
        const absent = KIND_SECTIONS.filter(({ kind }) => !view.evidence.some((e) => e.kind === kind));
        return (
          <>
            {present.map(({ kind, heading }) => (
              <section key={kind} aria-labelledby={`section-${kind}`} className="border-t border-rule pt-5">
                <h2 id={`section-${kind}`} className="font-editorial text-xl">{heading}</h2>
                <div className="mt-3.5 flex flex-col gap-3.5">
                  {view.evidence.filter((e) => e.kind === kind).map((entry) => <EvidenceItem key={entry.id} entry={entry} />)}
                </div>
              </section>
            ))}
            {/* Three headed sections that each say "nothing" read as thinness.
                One list says the same thing, and the confirmed-facts caveat
                keeps its full wording because it is the product's central
                warning, not a placeholder. */}
            {absent.length > 0 && (
              <section aria-labelledby="absent-heading" className="border-t border-rule pt-5">
                <h2 id="absent-heading" className="font-editorial text-xl">Not found in the cited sources</h2>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted">
                  {absent.map(({ kind, heading, empty }) => (
                    <li key={kind}>
                      <span className="font-medium text-ink">{heading}.</span> {empty}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}

      {/* An unreachable citation is repeated here so it cannot be missed, and it
          is never removed from the section it belongs to. */}
      {needsRecheck.length > 0 && (
        <section aria-labelledby="recheck-heading" className="border-t border-rule pt-5">
          <h2 id="recheck-heading" className="font-editorial text-xl">Needs a recheck</h2>
          <p className="mt-1 text-sm text-muted">
            {needsRecheck.length === 1 ? "One citation" : `${needsRecheck.length} citations`} did not load when we checked.
          </p>
          {/* A pointer, not a repeat: the full item is already in its own
              section above, and duplicating it wholesale buries the point. */}
          <ul className="mt-3 flex flex-col gap-2.5">
            {needsRecheck.map((entry) => (
              <li key={`recheck-${entry.id}`} className="border-t border-rule pt-2.5 text-sm">
                {entry.claimText}
                {entry.sources.filter((s) => !s.isAccessible).map((source) => (
                  <a
                    key={source.sourceResultId}
                    href={source.canonicalUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                    className="mt-0.5 block text-xs text-[var(--status-caution)] underline underline-offset-2"
                  >
                    {source.title}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CoverageAudit coverage={view.coverage} entries={view.evidence.filter((e) => e.kind === "existing_coverage")} />
      <ReportingBrief brief={view.brief} />

      <section aria-labelledby="query-log-heading" className="border-t border-rule pt-5">
        <h2 id="query-log-heading" className="font-editorial text-xl">Query log</h2>
        <p className="mt-1 text-sm text-muted">
          Every search that produced a source above. You can run any of these yourself.
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {view.queryLog.map((run, index) => (
            <li key={`${run.templateId}-${index}`}>
              <p className="font-mono text-xs break-words">{run.query}</p>
              <p className="text-xs text-muted">
                {run.engine} · {run.purpose} · {run.status} · {run.resultCount} results · {run.durationMs}ms
              </p>
            </li>
          ))}
        </ul>
      </section>

      {view.brief && (
        <section aria-labelledby="versions-heading" className="border-t border-rule pt-5">
          <h2 id="versions-heading" className="font-editorial text-xl">Brief versions</h2>
          <ul className="mt-3 flex flex-col gap-2">
            <li className="flex justify-between gap-4 text-sm">
              <span>Version {view.brief.version}</span>
              <span className="text-muted">current</span>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
