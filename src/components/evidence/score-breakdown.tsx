import type { EvidenceView } from "@/lib/evidence-view";

const BASIS_TEXT = {
  deterministic: "a rule",
  ai_suggested: "an AI suggestion",
  editor: "an editor",
} as const;

/**
 * All five deterministic components, always. A score that showed only its total
 * would be exactly the black box this product exists to avoid.
 */
export function ScoreBreakdown({ score, judgment }: { score: EvidenceView["score"]; judgment: EvidenceView["judgment"] }) {
  if (!score) {
    return (
      <section aria-labelledby="score-heading" className="border-t border-rule pt-5">
        <h2 id="score-heading" className="font-editorial text-xl">Score</h2>
        <p className="mt-2 text-sm text-muted">
          This lead did not qualify, so it has no score. Leads are only scored once they pass every rule.
        </p>
      </section>
    );
  }

  const locality = judgment?.localityBand;

  return (
    <section aria-labelledby="score-heading" className="border-t border-rule pt-5">
      <div className="flex items-baseline gap-2.5">
        <h2 id="score-heading" className="font-editorial text-xl">Score</h2>
        <span className="text-sm text-muted">{score.total} of 100, from five checks</span>
      </div>

      <dl className="mt-3">
        {score.components.map((component) => (
          <div
            key={component.key}
            className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-rule py-2.5 last:border-b-0"
          >
            <dt className="text-sm font-medium">{component.label}</dt>
            <dd className="text-right text-sm tabular-nums">{component.points} / {component.max}</dd>
            <dd className="col-span-2 text-sm text-muted">{component.reason}</dd>
          </div>
        ))}
      </dl>

      {locality && (
        <p className="mt-3 text-xs text-muted">
          Milwaukee connection set by <strong className="font-semibold text-ink">{BASIS_TEXT[locality.basis]}</strong>: {locality.reason}
        </p>
      )}
    </section>
  );
}
