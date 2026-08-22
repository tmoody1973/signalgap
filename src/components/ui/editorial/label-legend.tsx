import { LABEL_EXPLANATIONS, PRODUCT_LABELS_ARRAY } from "@/lib/source-labels";
import { StatusLabel } from "./status-label";

export function LabelLegend() {
  return (
    <section aria-labelledby="label-legend-heading" className="border-t border-rule pt-4">
      <h2 id="label-legend-heading" className="font-editorial text-xl">Evidence labels</h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {PRODUCT_LABELS_ARRAY.map((label) => (
          <div key={label} className="flex flex-col gap-1">
            <dt><StatusLabel label={label} /></dt>
            <dd className="text-sm text-muted">{LABEL_EXPLANATIONS[label]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
