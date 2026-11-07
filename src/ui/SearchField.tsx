import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./SearchField.css";
import { cx } from "./cx";
import { useMergedRefs } from "./hooks";
import { IconClose, IconSearch } from "./icons";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** called after the clear button (or Esc) emptied the field */
  onClear?: () => void;
  /** called on Enter */
  onSubmit?: (value: string) => void;
  /** content at the right edge inside the field (filter button, shortcut hint ...) */
  trailing?: ReactNode;
  autoFocus?: boolean;
  /** "lg" is the big rounded dashboard search */
  size?: "md" | "lg";
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, placeholder = "Search", onClear, onSubmit, trailing, autoFocus, size = "md", className, id, disabled, "aria-label": ariaLabel },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const merged = useMergedRefs<HTMLInputElement>(inputRef, ref);

  const clear = () => {
    onChange("");
    onClear?.();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && value) {
      // first Esc clears the text; the next one reaches the surrounding popover / dialog
      e.stopPropagation();
      e.preventDefault();
      clear();
    } else if (e.key === "Enter") {
      onSubmit?.(value);
    }
  };

  return (
    <div className={cx("cf-search", `cf-search--${size}`, disabled && "is-disabled", className)} role="search">
      <IconSearch className="cf-search__icon" aria-hidden="true" />
      <input
        ref={merged}
        id={id}
        className="cf-search__input"
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the caller decides: a dialog moves the focus into its search field
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value && !disabled ? (
        <button type="button" className="cf-search__clear" aria-label="Clear search" onClick={clear}>
          <IconClose aria-hidden="true" />
        </button>
      ) : null}
      {trailing ? <span className="cf-search__trailing">{trailing}</span> : null}
    </div>
  );
});
