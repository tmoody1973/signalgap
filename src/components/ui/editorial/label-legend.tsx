import { LABEL_EXPLANATIONS, PRODUCT_LABELS } from "@/lib/source-labels";
import { StatusLabel } from "./status-label";

export function LabelLegend() {
  return (
    <section aria-labelledby="label-legend-heading" className="border-t border-rule pt-4">
      <h2 id="label-legend-heading" className="font-editorial text-xl">What the labels mean</h2>
      <p className="mt-1 text-sm text-muted">Labels say what SignalGap checked. They never say a story is true.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.values(PRODUCT_LABELS).map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <dt><StatusLabel label={label} /></dt>
            <dd className="text-sm text-muted">{LABEL_EXPLANATIONS[label]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
