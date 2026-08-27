import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import type { api } from "../../../convex/_generated/api";
import { exclusionSentence } from "@/lib/exclusion-reasons";
import { routes } from "@/lib/routes";
import { beatText } from "@/lib/source-labels";
import { StatusLabel } from "@/components/ui/editorial/status-label";

/**
 * One row of the compact feed, so a Convex field rename breaks the build
 * rather than rendering blank.
 */
export type LeadCardView = FunctionReturnType<typeof api.candidates.list.listForScan>["page"][number];

const DISPOSITION_TEXT = {
  new: "New",
  rejected: "Rejected",
  monitoring: "Monitoring",
  assigned: "Assigned",
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3h ago", "yesterday", "5d ago" — an editor's first filter every morning is
 * age. `now` is a parameter only so this can be tested without a live clock.
 */
function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const days = Math.floor(diff / DAY);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * A row in the ranked feed's eligible or excluded list.
 *
 * A different component from the evidence page's `LeadCard` — same name,
 * different surface, different shape. This one carries `exclusionSentence()`
 * inline, because the excluded list is where most of a scan lives (at most
 * ten leads per scan can ever qualify) and an editor must be able to triage
 * it without opening anything.
 */
export function LeadCard({ lead }: { lead: LeadCardView }) {
  const reasons = exclusionSentence(lead.exclusionReasons);
  // The query has no separate coverage-pass-status field for this card (only
  // evidence.forCandidate does). "coverage_pass_incomplete" is the one signal
  // this shape carries for "never checked" — every eligible lead's coverage
  // pass completed by construction, so this only ever fires on the excluded list.
  const coverageChecked = !lead.exclusionReasons.includes("coverage_pass_incomplete");
  // A blank `reportingQuestion` is a real state: `formFromCluster` writes it
  // blank and only a brief fills it in, so any lead whose brief failed or was
  // never attempted has none. Falling back to the working title matches
  // `components/evidence/lead-card.tsx`, but this surface says so out loud —
  // the working title is a source's own headline, and the slot it lands in
  // otherwise reads as a question this product wrote.
  const question = lead.reportingQuestion || lead.currentTitle;
  const isWorkingTitle = lead.reportingQuestion === "";

  return (
    <article className="flex flex-col gap-2 border-t border-rule py-3.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel label={lead.label} />
        <span className="text-xs text-muted">{beatText(lead.beat)}</span>
      </div>

      <h3 className="font-editorial text-lg leading-snug text-pretty">{question}</h3>
      {isWorkingTitle && <p className="text-xs text-muted">Working title — no reporting question yet.</p>}

      {reasons && <p className="text-sm text-muted">{reasons}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>
          {lead.scoreTotal === null
            ? "No score"
            : <><strong className="font-semibold text-ink">{lead.scoreTotal}</strong> of 100</>}
        </span>
        <span>
          {lead.independentCategoryCount} {lead.independentCategoryCount === 1 ? "independent category" : "independent categories"}
        </span>
        <span>
          {coverageChecked
            ? `${lead.coverageOriginalCount} prior ${lead.coverageOriginalCount === 1 ? "report" : "reports"}`
            : "Prior reports not checked"}
        </span>
        <span title={new Date(lead.discoveredAt).toLocaleString()}>{relativeTime(lead.discoveredAt)}</span>
        <span>{DISPOSITION_TEXT[lead.disposition]}</span>
      </div>

      {/* A plain internal link: the global :focus-visible rule in theme.css
          already gives every focusable element a visible ring, so no primitive
          or extra classes are needed to satisfy that requirement. */}
      <Link href={routes.lead(lead.candidateId)} className="w-fit text-sm font-semibold text-accent hover:underline">
        Open evidence
      </Link>
    </article>
  );
}
