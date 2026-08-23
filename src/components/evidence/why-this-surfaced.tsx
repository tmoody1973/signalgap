import type { EvidenceView } from "@/lib/evidence-view";

/**
 * The demo's central reveal: several independent kinds of source landing on one
 * story. It leads the evidence view because convergence is the reason the lead
 * exists at all.
 *
 * Ledger treatment — kind on the left, source on the right. The count sentence
 * underneath is what states the rule, so the meaning survives without colour.
 */
export function WhyThisSurfaced({ items }: { items: EvidenceView["whySurfaced"] }) {
  const confirming = items.filter((i) => i.category !== "community_discussion");

  return (
    <section aria-labelledby="why-heading" className="border-t border-rule pt-5">
      <h2 id="why-heading" className="font-editorial text-xl">Why this surfaced</h2>
      <p className="mt-1 text-sm text-muted">
        {confirming.length >= 2
          ? `${confirming.length} independent kinds of source can confirm this story. One would be a tip. Two is a lead.`
          : "Only one kind of source can confirm this so far. One source is a tip, not a lead."}
      </p>

      <ol className="mt-3.5">
        {items.map((item) => {
          const isDiscussion = item.category === "community_discussion";
          return (
            <li
              key={item.sourceResultId}
              className="grid grid-cols-[132px_1fr] gap-4 border-t border-rule py-3 last:border-b"
            >
              <span className={isDiscussion
                ? "text-xs uppercase tracking-wide text-[var(--status-caution)]"
                : "text-xs uppercase tracking-wide text-muted"}
              >
                {item.label}
              </span>
              <span>
                <span className="block text-sm">{item.title}</span>
                <span className="block text-xs text-muted">
                  {isDiscussion
                    ? "Does not count toward confirmation"
                    : [item.publisher, item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : null]
                        .filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
