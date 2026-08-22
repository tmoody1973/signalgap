import { labelTone, type ProductLabel } from "@/lib/source-labels";
import { cx } from "@/lib/utils/cx";

const TONE_CLASS = {
  neutral: "text-[var(--status-neutral)]",
  caution: "text-[var(--status-caution)]",
  conflict: "text-[var(--status-conflict)]",
  positive: "text-[var(--status-positive)]",
} as const;

export function StatusLabel({ label, className }: { label: ProductLabel; className?: string }) {
  return (
    <span
      data-tone={labelTone(label)}
      className={cx("inline-flex items-center rounded-sm border border-rule px-1.5 py-0.5 font-ui text-xs font-medium", TONE_CLASS[labelTone(label)], className)}
    >
      {label}
    </span>
  );
}
