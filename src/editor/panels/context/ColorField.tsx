import { useState } from "react";
import { ColorPicker, ColorSwatch, cx, Popover } from "@/ui";
import "./ColorField.css";

export interface ColorFieldProps {
  /** current colour (#rrggbb or rgba()) */
  value: string;
  /** fires continuously while the picker is dragged */
  onChange: (color: string) => void;
  /** fires once a drag / hex edit / eyedropper pick finished */
  onCommit?: (color: string) => void;
  /** accessible name, e.g. "Header fill" */
  label: string;
  size?: number;
  shape?: "circle" | "square";
  showAlpha?: boolean;
  /** fires when the popover opens / closes (lets the owner freeze lists while picking) */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** A colour swatch button that opens a full ColorPicker in a popover. */
export function ColorField({ value, onChange, onCommit, label, size = 36, shape = "square", showAlpha = false, onOpenChange, className }: ColorFieldProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <ColorSwatch
        color={value}
        size={size}
        shape={shape}
        selected={open}
        title={label}
        className={cx("cf-colorfield", className)}
        onClick={(e) => {
          setAnchor(e.currentTarget);
          setOpen(!open);
        }}
      />
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => {
          setOpen(false);
          // a drag that never saw its pointer-up (cancelled) must not leave an undo step open
          onCommit?.(value);
        }}
        placement="bottom-start"
        className="cf-colorfield__pop"
        aria-label={`${label} picker`}
      >
        <div className="cf-colorfield__body">
          <ColorPicker value={value} showAlpha={showAlpha} onChange={onChange} onChangeEnd={onCommit} />
        </div>
      </Popover>
    </>
  );
}
