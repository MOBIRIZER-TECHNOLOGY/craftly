import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import "./IconButton.css";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";
import { ariaShortcut } from "./shortcut";

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** accessible name and tooltip text */
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  /** toggled-on look (tinted background); also sets aria-pressed when provided */
  active?: boolean;
  /** shortcut shown in the tooltip, e.g. "Ctrl+Z" */
  shortcut?: string;
  /** wrap in a Tooltip (default true) */
  tooltip?: boolean;
}

/**
 * Icon-only button. Disabled state uses aria-disabled (not the disabled attribute) so the button keeps
 * focus and its tooltip. Theme it on dark surfaces with --cf-ib-fg / --cf-ib-hover / --cf-ib-press /
 * --cf-ib-active-bg / --cf-ib-active-fg set on a parent.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", active, shortcut, tooltip = true, disabled, className, onClick, type = "button", ...rest },
  ref,
) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  const button = (
    <button
      ref={ref}
      type={type}
      className={cx("cf-iconbtn", `cf-iconbtn--${size}`, active && "is-active", className)}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon}
    </button>
  );

  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} describe={false}>
      {button}
    </Tooltip>
  );
});
