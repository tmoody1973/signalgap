import type { EvidenceEntry } from "@/lib/evidence-view";
import { CitationTrace } from "./citation-trace";

const KIND_TEXT = {
  confirmed_fact: "Confirmed by the rules",
  unverified_signal: "Unverified",
  conflicting_claim: "Conflicting",
  existing_coverage: "Existing coverage",
  potential_source: "Potential source",
} as const;

export function EvidenceItem({ entry }: { entry: EvidenceEntry }) {
  const kindText = KIND_TEXT[entry.kind];

  return (
    <article className="border-t border-rule pt-3.5">
      <p className={entry.requiresReverification
        ? "text-xs uppercase tracking-wide text-[var(--status-caution)]"
        : "text-xs uppercase tracking-wide text-muted"}
      >
        {entry.requiresReverification ? `${kindText} · Needs a recheck` : kindText}
      </p>
      <p className="mt-1 text-sm">{entry.claimText}</p>

      {/* A translation sits beside its original and is labelled. It never
          replaces the source's own words. */}
      {entry.originalLanguageText && (
        <dl className="mt-2 grid grid-cols-[92px_1fr] gap-x-3.5 gap-y-1 text-sm">
          <dt className="text-xs uppercase tracking-wide text-muted">Original</dt>
          <dd>{entry.originalLanguageText}</dd>
          {entry.translatedText && (
            <>
              <dt className="text-xs uppercase tracking-wide text-muted">AI translation</dt>
              <dd className="text-muted">{entry.translatedText}</dd>
            </>
          )}
        </dl>
      )}

      <div className="mt-2.5 flex flex-col gap-2.5">
        {entry.sources.map((source) => (
          <CitationTrace key={source.sourceResultId} source={source} excerpt={entry.exactExcerpt} />
        ))}
      </div>
    </article>
  );
}
