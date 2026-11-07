import type { ReactNode } from "react";
import "./Kbd.css";
import { cx } from "./cx";
import { shortcutKeys } from "./shortcut";

export interface KbdProps {
  /** a shortcut such as "Ctrl+Shift+Z"; rendered as one key cap per key, localised for the platform */
  keys?: string;
  /** free content for a single key cap (used when `keys` is not set) */
  children?: ReactNode;
  className?: string;
}

/** Keyboard key cap(s). */
export function Kbd({ keys, children, className }: KbdProps) {
  if (keys) {
    return (
      <span className={cx("cf-kbd-group", className)}>
        {shortcutKeys(keys).map((key, i) => (
          <kbd key={`${key}-${i}`} className="cf-kbd">
            {key}
          </kbd>
        ))}
      </span>
    );
  }
  return <kbd className={cx("cf-kbd", className)}>{children}</kbd>;
}
