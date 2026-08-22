"use client";

import type { ReactElement, ReactNode } from "react";
import type { ButtonProps as AriaButtonProps, LinkProps as AriaLinkProps } from "react-aria-components";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { cx } from "@/lib/utils/cx";

const colors = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-rule bg-raised text-ink hover:bg-surface",
  tertiary: "text-muted hover:text-ink",
} as const;

const sizes = {
  sm: "gap-1 rounded-md px-3 py-1.5 text-sm font-semibold",
  md: "gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold",
} as const;

/** Props shared between the button and link variants. */
export interface CommonProps {
  isDisabled?: boolean;
  isLoading?: boolean;
  size?: keyof typeof sizes;
  color?: keyof typeof colors;
  children?: ReactNode;
  className?: string;
}

export interface ButtonProps extends CommonProps, Omit<AriaButtonProps, "children" | "className"> {}
interface LinkProps extends CommonProps, Omit<AriaLinkProps, "children" | "className"> {
  href: NonNullable<AriaLinkProps["href"]>;
}

/** Union type of button and link props. */
export type Props = ButtonProps | LinkProps;

export const Button: {
  (props: LinkProps): ReactElement<LinkProps>;
  (props: ButtonProps): ReactElement<ButtonProps>;
} = ({ size = "sm", color = "primary", children, className, isDisabled: disabled, isLoading: loading, ...props }) => {
  const href = "href" in props ? props.href : undefined;

  const commonProps = {
    ...props,
    isDisabled: disabled,
    className: cx(
      "inline-flex h-max cursor-pointer items-center justify-center whitespace-nowrap transition duration-100 ease-linear",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      sizes[size],
      colors[color],
      loading && "pointer-events-none opacity-70",
      className,
    ),
    children: (
      <>
        {loading && (
          <svg className="mr-1.5 size-4 animate-spin" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle className="opacity-30" cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="12.5 50" strokeLinecap="round" />
          </svg>
        )}
        {children}
      </>
    ),
  };

  if ("href" in commonProps) {
    return <AriaLink {...commonProps} href={disabled ? undefined : href} />;
  }

  return <AriaButton {...commonProps} type={commonProps.type || "button"} isPending={loading} />;
};
