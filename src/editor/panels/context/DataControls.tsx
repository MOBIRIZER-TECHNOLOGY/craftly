import { useState, type ReactNode } from "react";
import { m } from "@/i18n";
import { cx } from "@/ui";
import { ColorField } from "./ColorField";
import { parseNumber } from "./dataEdit";
import { useBatch } from "./useBatch";

/** A label with a colour swatch at the right; dragging the picker is one undo step. */
export function ColorRow({ label, value, onChange, children }: { label: string; value: string; onChange: (color: string) => void; children?: ReactNode }) {
  const batch = useBatch();
  return (
    <div className="cf-data__colorrow">
      <span className="cf-data__colorlabel">{label}</span>
      <span className="cf-data__colorside">
        {children}
        <ColorField label={label} value={value} onChange={(c) => batch.run(() => onChange(c))} onCommit={() => batch.end()} />
      </span>
    </div>
  );
}

/** A number cell that only commits real numbers: anything else turns red and snaps back when you leave the cell. */
export function NumberCell({ value, onValid, label, dim }: { value: number; onValid: (value: number) => void; label: string; dim?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseNumber(draft) === null;
  return (
    <input
      className={cx("cf-data__cell", "is-number", invalid && "is-invalid", dim && "is-dim")}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? m.panelsContext.dataCell.invalidNumber : undefined}
      value={draft ?? String(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parseNumber(text);
        if (n !== null) onValid(n);
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A text cell (labels, series names, table cells). */
export function TextCell({
  value,
  onText,
  label,
  className,
  placeholder,
  cellKey,
  onPasteText,
  onSelect,
}: {
  value: string;
  onText: (value: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
  /** "row:column" of a table's cell, so that the panel can find the field of one cell */
  cellKey?: string;
  /** asked with the text of a paste; true when it was dealt with and must not go into the field as well */
  onPasteText?: (text: string) => boolean;
  onSelect?: () => void;
}) {
  return (
    <input
      className={cx("cf-data__cell", className)}
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      data-cf-cell={cellKey}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onText(e.target.value)}
      onFocus={(e) => {
        onSelect?.();
        e.currentTarget.select();
      }}
      onPaste={(e) => {
        if (onPasteText?.(e.clipboardData.getData("text/plain"))) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
