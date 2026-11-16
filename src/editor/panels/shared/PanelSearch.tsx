import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from "react";
import { m } from "@/i18n";
import { IconClose, IconSearch, cx, useMergedRefs } from "@/ui";
import "./PanelSearch.css";

export interface PanelSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** glyph at the start of the field (default: a magnifier). Pass `<IconPlus />` with `onLeadingClick` for the "+" look. */
  leading?: ReactNode;
  /** turns the leading glyph into a button */
  onLeadingClick?: () => void;
  /** accessible name of the leading button */
  leadingLabel?: string;
  /** content at the right edge, inside the field (a filter button ...) */
  trailing?: ReactNode;
  autoFocus?: boolean;
  onSubmit?: (value: string) => void;
  "aria-label"?: string;
  className?: string;
}

/**
 * The large, rounded search field at the top of every side-panel tab (52px high, 16px radius).
 * Esc clears the text first; the clear button keeps focus in the field.
 */
export const PanelSearch = forwardRef<HTMLInputElement, PanelSearchProps>(function PanelSearch(
  { value, onChange, placeholder, leading, onLeadingClick, leadingLabel, trailing, autoFocus, onSubmit, "aria-label": ariaLabel, className },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const merged = useMergedRefs<HTMLInputElement>(inputRef, ref);

  const clear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && value) {
      e.stopPropagation();
      e.preventDefault();
      clear();
    } else if (e.key === "Enter") {
      onSubmit?.(value);
    }
  };

  const glyph = leading ?? <IconSearch aria-hidden="true" />;

  return (
    <div className={cx("cf-psearch", className)} role="search">
      {onLeadingClick ? (
        <button type="button" className="cf-psearch__lead is-button" aria-label={leadingLabel ?? m.panelsTabs.shared.searchOptions} onClick={onLeadingClick}>
          {glyph}
        </button>
      ) : (
        <span className="cf-psearch__lead" aria-hidden="true">
          {glyph}
        </span>
      )}
      <input
        ref={merged}
        className="cf-psearch__input"
        type="text"
        role="searchbox"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the caller decides: a panel that is opened to search puts the focus in its field
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button type="button" className="cf-psearch__clear" aria-label={m.panelsTabs.shared.clearSearch} onClick={clear}>
          <IconClose aria-hidden="true" />
        </button>
      ) : null}
      {trailing ? <span className="cf-psearch__trailing">{trailing}</span> : null}
    </div>
  );
});
