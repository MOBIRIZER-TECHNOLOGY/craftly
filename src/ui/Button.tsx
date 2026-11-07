import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import "./Button.css";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** visual style (default "secondary") */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** leading icon */
  icon?: ReactNode;
  /** trailing icon (e.g. a chevron for dropdown triggers) */
  iconRight?: ReactNode;
  /** shows a spinner and ignores clicks, but keeps keyboard focus */
  loading?: boolean;
  /** stretches to the full width of the container */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading = false, block = false, className, children, onClick, type = "button", disabled, ...rest },
  ref,
) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  const hasLabel = children !== undefined && children !== null && children !== false;

  return (
    <button
      ref={ref}
      type={type}
      className={cx("cf-btn", `cf-btn--${variant}`, `cf-btn--${size}`, block && "cf-btn--block", loading && "cf-btn--loading", !hasLabel && "cf-btn--icon-only", className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading && (
        <span className="cf-btn__spinner">
          <Spinner size={size === "sm" ? 14 : 18} />
        </span>
      )}
      {icon ? <span className="cf-btn__icon">{icon}</span> : null}
      {hasLabel ? <span className="cf-btn__label">{children}</span> : null}
      {iconRight ? <span className="cf-btn__icon cf-btn__icon--right">{iconRight}</span> : null}
    </button>
  );
});
