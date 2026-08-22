import type { ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

const colors = {
  neutral: "text-[var(--status-neutral)]",
  caution: "text-[var(--status-caution)]",
  conflict: "text-[var(--status-conflict)]",
  positive: "text-[var(--status-positive)]",
} as const;

const sizes = {
  sm: "px-2 py-0.5 text-xs font-medium",
  md: "px-2.5 py-0.5 text-sm font-medium",
} as const;

export interface BadgeProps {
  /** Neutral maps to the ink token; the rest map to the `--status-*` tokens. */
  color?: keyof typeof colors;
  size?: keyof typeof sizes;
  children: ReactNode;
  className?: string;
}

export const Badge = ({ color = "neutral", size = "md", children, className }: BadgeProps) => (
  <span
    className={cx(
      "inline-flex size-max items-center whitespace-nowrap rounded-full border border-rule",
      sizes[size],
      colors[color],
      className,
    )}
  >
    {children}
  </span>
);
