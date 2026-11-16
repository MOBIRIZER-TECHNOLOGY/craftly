import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { m } from "@/i18n";
import "./Select.css";
import { cx } from "./cx";
import { IconCheck, IconChevronDown } from "./icons";
import { Popover } from "./Popover";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: ReactNode;
  /** plain text used for type-ahead (defaults to String(value) when `label` is not a string) */
  textValue?: string;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface SelectProps<T extends string | number = string> {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  /** trigger width in px or any CSS length (default: fills the container) */
  width?: number | string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  id?: string;
  /** accessible name of the trigger */
  "aria-label"?: string;
}

function optionText<T extends string | number>(option: SelectOption<T>): string {
  return option.textValue ?? (typeof option.label === "string" ? option.label : String(option.value));
}

/** Dropdown with a custom listbox (Popover based): arrow keys, Home / End, type-ahead, Enter / Space, Esc. */
export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = m.ui.select.placeholder,
  width,
  size = "md",
  disabled = false,
  className,
  id,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className={cx("cf-select", `cf-select--${size}`, open && "is-open", className)}
        style={width === undefined ? undefined : { width }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {selected?.icon ? <span className="cf-select__icon">{selected.icon}</span> : null}
        <span className={cx("cf-select__value", !selected && "is-placeholder")}>{selected ? selected.label : placeholder}</span>
        <IconChevronDown className="cf-select__chevron" aria-hidden="true" />
      </button>
      <Popover
        open={open}
        anchor={triggerRef.current}
        onClose={() => setOpen(false)}
        placement="bottom-start"
        offset={4}
        matchWidth
        role="presentation"
        trapFocus={false}
        className="cf-select__popover"
      >
        <Listbox id={listId} options={options} value={value} onChoose={choose} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

interface ListboxProps<T extends string | number> {
  id: string;
  options: SelectOption<T>[];
  value: T | null | undefined;
  onChoose: (option: SelectOption<T>) => void;
  onClose: () => void;
}

function Listbox<T extends string | number>({ id, options, value, onChoose, onClose }: ListboxProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const enabled = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);

  // Start on the selected option (or the first one) so arrow keys work immediately.
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>('[aria-selected="true"]') ?? enabled()[0];
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    } else {
      list.focus({ preventScroll: true });
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = enabled();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => {
      const el = items[(i + items.length) % items.length];
      el?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(current < 0 ? 0 : current + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        focusAt(current < 0 ? items.length - 1 : current - 1);
        return;
      case "Home":
        e.preventDefault();
        focusAt(0);
        return;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        return;
      case "Enter":
      case " ": {
        e.preventDefault();
        const index = Number(items[current]?.dataset.index);
        const option = options[index];
        if (option) onChoose(option);
        return;
      }
      case "Tab":
        e.preventDefault();
        onClose();
        return;
      default:
        break;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const buf = typeahead.current;
      buf.text = now - buf.at > 700 ? e.key.toLowerCase() : buf.text + e.key.toLowerCase();
      buf.at = now;
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((el) => (el.dataset.text ?? "").toLowerCase().startsWith(buf.text));
      if (match) {
        e.preventDefault();
        match.focus();
      }
    }
  };

  return (
    <div ref={ref} id={id} role="listbox" tabIndex={-1} className="cf-select__list" onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the keys of the list choose an option (arrows, Enter)
          <div
            key={String(option.value)}
            role="option"
            tabIndex={-1}
            aria-selected={isSelected}
            aria-disabled={option.disabled || undefined}
            data-index={index}
            data-text={optionText(option)}
            className={cx("cf-select__option", isSelected && "is-selected")}
            onClick={() => onChoose(option)}
            onPointerEnter={(e) => {
              if (!option.disabled && e.pointerType !== "touch") e.currentTarget.focus({ preventScroll: true });
            }}
          >
            {option.icon ? <span className="cf-select__icon">{option.icon}</span> : null}
            <span className="cf-select__option-label">{option.label}</span>
            {isSelected ? <IconCheck className="cf-select__check" aria-hidden="true" /> : null}
          </div>
        );
      })}
    </div>
  );
}
