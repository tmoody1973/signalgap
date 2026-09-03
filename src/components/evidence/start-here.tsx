import type { BriefView } from "@/lib/evidence-view";

/**
 * The two pieces of the brief a reporter acts on, placed where they will be
 * read first: the sentence that says why this is a story, and the questions
 * to ask. Everything else on the page is evidence FOR these two things.
 *
 * Same ground and standing label as the brief (`--ai-tint`), because this is
 * AI-drafted prose and must never be read as sourced evidence. The label is
 * words, not a colour, so it survives greyscale and a screen reader.
 */
export function StartHere({ brief }: { brief: BriefView | null }) {
  if (!brief) return null;
  return (
    <section
      aria-labelledby="start-here-heading"
      className="rounded-md border border-rule bg-[var(--ai-tint)] px-5 py-4.5"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--status-caution)]">
        AI-drafted · read this before the evidence · version {brief.version}
      </p>
      <h2 id="start-here-heading" className="mt-1 font-editorial text-xl">Start here</h2>
      <p className="mt-2 text-sm">{brief.whySurfaced}</p>

      {brief.interviewQuestions.length > 0 && (
        <div className="mt-3.5">
          <h3 className="text-sm font-semibold">Questions to ask</h3>
          <ol className="mt-1 list-decimal pl-5 text-sm marker:text-muted">
            {brief.interviewQuestions.map((question) => (
              <li key={question} className="pl-1">{question}</li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
