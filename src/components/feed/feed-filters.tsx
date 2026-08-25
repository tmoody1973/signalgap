"use client";

import type { Infer } from "convex/values";
import { vProductLabel } from "../../../convex/lib/validators";
import { Button } from "@/components/ui/untitled/button";
import type { Disposition, FeedFilters as Filters } from "@/lib/feed-filters";
import { BEAT_TEXT, type Beat } from "@/lib/source-labels";

/**
 * Beat, label and disposition, as three native selects.
 *
 * This component holds no state. It reads the filters it is given and hands
 * back a whole new filter object — the URL is the only place a filter lives,
 * so a filtered feed is a link an editor can send to a colleague, and coming
 * back from a lead lands on the same list rather than on everything.
 *
 * Native `<select>` on purpose: `src/components/ui/untitled/` has only Badge
 * and Button, neither of which is a listbox, and a hand-rolled one would have
 * to re-earn keyboard support, type-ahead and the mobile picker that the
 * platform already gives away.
 */

// ponytail: a third copy of this vocabulary — the feed card and the evidence
// card each hold one. The Task 4 review already filed hoisting it into
// src/lib/source-labels.ts as a follow-up; that file is outside this task.
const DISPOSITION_TEXT: Record<Disposition, string> = {
  new: "New",
  rejected: "Rejected",
  monitoring: "Monitoring",
  assigned: "Assigned",
};

const BEAT_OPTIONS = (Object.keys(BEAT_TEXT) as Beat[]).map((beat) => [beat, BEAT_TEXT[beat]] as const);

// The six labels a LEAD can carry, straight from the server validator that
// `listForScan` argues against. PRODUCT_LABELS also holds scan-level words
// ("Stopped early", "Incomplete scan") that no candidate ever has, and offering
// one here would build a filter that can only ever return nothing.
const LABEL_OPTIONS = vProductLabel.members.map((member) => [member.value, member.value] as const);

/** The label vocabulary `listForScan` accepts — a strict subset of `ProductLabel`. */
export type LeadLabel = Infer<typeof vProductLabel>;

/** `FeedFilters` with its label narrowed to what the server will actually take. */
export type LeadFilters = Omit<Filters, "label"> & { label: LeadLabel | null };

const LEAD_LABELS = new Set<string>(LABEL_OPTIONS.map(([value]) => value));

/**
 * `parseFeedFilters` validates against every PRODUCT_LABELS value, four of
 * which describe a SCAN rather than a lead. `?label=Stopped%20early` therefore
 * survives parsing but would be rejected by `listForScan`'s own argument
 * validator, throwing instead of rendering. A URL is a trust boundary twice:
 * once at parse, once at the call.
 */
export function isLeadLabel(label: string | null): label is LeadLabel {
  return label !== null && LEAD_LABELS.has(label);
}

const DISPOSITION_OPTIONS = (Object.keys(DISPOSITION_TEXT) as Disposition[])
  .map((disposition) => [disposition, DISPOSITION_TEXT[disposition]] as const);

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<readonly [T, string]>;
  onSelect: (value: T | null) => void;
}) {
  return (
    <label className="flex min-w-40 flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {/* scheme-light/dark makes the native option list follow the app's theme
          instead of always painting the operating system's light one. */}
      <select
        value={value ?? ""}
        onChange={(event) => onSelect((event.target.value as T) || null)}
        className="scheme-light dark:scheme-dark w-full rounded-md border border-rule bg-raised px-2 py-1.5 text-sm text-ink"
      >
        <option value="">All</option>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>{text}</option>
        ))}
      </select>
    </label>
  );
}

export function FeedFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  /** Omitted when the caller is showing its own reset — there is only ever one on screen. */
  onClear?: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <FilterSelect
        label="Beat"
        value={filters.beat}
        options={BEAT_OPTIONS}
        onSelect={(beat) => onChange({ ...filters, beat })}
      />
      <FilterSelect
        label="Label"
        value={filters.label}
        options={LABEL_OPTIONS}
        onSelect={(label) => onChange({ ...filters, label })}
      />
      <FilterSelect
        label="Disposition"
        value={filters.disposition}
        options={DISPOSITION_OPTIONS}
        onSelect={(disposition) => onChange({ ...filters, disposition })}
      />
      {onClear && (
        <Button color="secondary" size="sm" className="mb-0.5" onPress={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
