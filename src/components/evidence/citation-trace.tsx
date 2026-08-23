import type { EvidenceSource } from "@/lib/evidence-view";

/**
 * The last link in the chain: excerpt, then the source, then the exact search
 * that found it. A journalist can re-run that query themselves — which is the
 * whole reason it is on screen.
 */
export function CitationTrace({ source, excerpt }: { source: EvidenceSource; excerpt: string | null }) {
  const meta = [
    source.publisher,
    source.publishedAt ? new Date(source.publishedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : null,
    source.sourceType === "unknown" ? null : source.sourceType,
  ].filter(Boolean).join(" · ");

  return (
    // An unreachable source is marked on its own edge, not hidden. Colour is a
    // second signal here; the sentence below carries the meaning on its own.
    <div className={source.isAccessible ? "border-l-2 border-rule pl-3.5" : "border-l-2 border-[var(--status-caution)] pl-3.5"}>
      {excerpt && (
        <blockquote className="font-editorial text-[15px] italic">“{excerpt}”</blockquote>
      )}
      <p className="mt-1 text-sm">
        <a
          href={source.canonicalUrl}
          rel="noreferrer noopener"
          target="_blank"
          className="underline underline-offset-2 hover:text-ink"
        >
          {source.title}
        </a>
      </p>
      {meta && <p className="text-xs text-muted">{meta}</p>}

      {source.originalLanguage !== "en" && source.translatedTitle && (
        <p className="mt-1 text-xs text-muted">
          Original in {source.originalLanguage}. AI translation: “{source.translatedTitle}”
        </p>
      )}

      {!source.isAccessible && (
        <p className="mt-1.5 text-xs text-[var(--status-caution)]">
          This link did not load when we checked. It stays here, marked, rather than disappearing.
        </p>
      )}

      {source.foundByQuery && (
        <p className="mt-1.5 font-mono text-[11px] break-words text-muted">Found by: {source.foundByQuery}</p>
      )}
    </div>
  );
}
