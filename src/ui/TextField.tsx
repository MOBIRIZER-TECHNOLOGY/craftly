import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./TextField.css";
import { cx } from "./cx";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** visible label above the input */
  label?: ReactNode;
  /** error message; turns the border red and is announced to screen readers */
  error?: string;
  /** helper text below the input (hidden while an error is shown) */
  hint?: string;
  size?: "sm" | "md" | "lg";
  /** content inside the box before / after the text (icons, units, buttons) */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, size = "md", leading, trailing, className, id, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cx("cf-field", `cf-field--${size}`, className)}>
      {label ? (
        <label className="cf-field__label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className={cx("cf-field__box", error && "is-invalid", disabled && "is-disabled")}>
        {leading ? <span className="cf-field__adornment">{leading}</span> : null}
        <input
          ref={ref}
          id={inputId}
          className="cf-field__input"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          {...rest}
        />
        {trailing ? <span className="cf-field__adornment">{trailing}</span> : null}
      </div>
      {message ? (
        <p id={messageId} className={cx("cf-field__message", error && "is-error")} role={error ? "alert" : undefined}>
          {message}
        </p>
      ) : null}
    </div>
  );
});
