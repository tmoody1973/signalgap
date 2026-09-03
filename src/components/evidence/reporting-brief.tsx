import type { BriefView } from "@/lib/evidence-view";

const SECTION_TITLES = {
  confirmedFacts: "Confirmed facts",
  unverifiedClaims: "Unverified or conflicting claims",
  conflicts: "Conflicts",
  existingCoverage: "Existing coverage",
  potentialHumanSources: "Potential human sources",
} as const;

/**
 * The brief SAYS what it is. It sits on its own ground (`--ai-tint`) with a
 * standing label, so AI-drafted prose can never be read as sourced evidence —
 * the spec requires the two to be visually distinct, and a colour difference
 * alone would not survive a grayscale print or a colour-blind reader.
 *
 * A block citing nothing is an absence note we wrote, not a claim. It renders
 * as muted italic prose with no source count.
 */
export function ReportingBrief({ brief }: { brief: BriefView | null }) {
  if (!brief) {
    return (
      <section aria-labelledby="brief-heading" className="border-t border-rule pt-5">
        <h2 id="brief-heading" className="font-editorial text-xl">Reporting brief</h2>
        <p className="mt-2 text-sm text-muted">No brief has been written for this lead yet.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="brief-heading" className="border-t border-rule pt-5">
      <h2 id="brief-heading" className="font-editorial text-xl">Full brief</h2>

      <div className="mt-3 rounded-md border border-rule bg-[var(--ai-tint)] px-5 py-4.5">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--status-caution)]">
          AI-drafted editorial assistance · not a publishable story · version {brief.version}
        </p>

        <p className="mt-2.5 font-editorial text-[22px] leading-snug text-pretty">{brief.reportingQuestion}</p>

        {(Object.keys(SECTION_TITLES) as (keyof typeof SECTION_TITLES)[]).map((key) => (
          <div key={key} className="mt-4">
            <h3 className="text-sm font-semibold">{SECTION_TITLES[key]}</h3>
            <ul className="mt-1 flex flex-col gap-1.5">
              {brief.sections[key].map((block, index) => (
                <li
                  key={`${key}-${index}`}
                  className={block.sourceResultIds.length === 0 ? "text-sm italic text-muted" : "text-sm"}
                >
                  {block.text}
                  {block.sourceResultIds.length > 0 && (
                    <span className="ml-1 text-xs text-muted">
                      ({block.sourceResultIds.length} {block.sourceResultIds.length === 1 ? "source" : "sources"})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
