"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CoverageAudit } from "./coverage-audit";
import { EvidenceItem } from "./evidence-item";
import { LeadCard } from "./lead-card";
import { ReportingBrief } from "./reporting-brief";
import { ScoreBreakdown } from "./score-breakdown";
import { WhyThisSurfaced } from "./why-this-surfaced";

/**
 * The section order is the spec's, not a preference: question and disposition,
 * score, why this surfaced, confirmed, unverified, conflicts, reverification,
 * coverage, potential sources, query log, brief.
 */
const KIND_SECTIONS = [
  { kind: "confirmed_fact", heading: "Confirmed facts", empty: "Nothing here has been independently confirmed yet. Treat every claim below as unverified." },
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
      <LeadCard candidate={view.candidate} sourceCount={sourceCount} coverage={view.coverage} />
      <ScoreBreakdown score={view.score} judgment={view.judgment} />
      <WhyThisSurfaced items={view.whySurfaced} />

      {KIND_SECTIONS.map(({ kind, heading, empty }) => {
        const entries = view.evidence.filter((e) => e.kind === kind);
        return (
          <section key={kind} aria-labelledby={`section-${kind}`} className="border-t border-rule pt-5">
            <h2 id={`section-${kind}`} className="font-editorial text-xl">{heading}</h2>
            {entries.length === 0 ? (
              <p className="mt-2 text-sm italic text-muted">{empty}</p>
            ) : (
              <div className="mt-3.5 flex flex-col gap-3.5">
                {entries.map((entry) => <EvidenceItem key={entry.id} entry={entry} />)}
              </div>
            )}
          </section>
        );
      })}

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
