import type { CSSProperties, MouseEvent } from "react";
import "./ColorSwatch.css";
import { cx } from "./cx";

export interface ColorSwatchProps {
  /** any CSS colour; transparent / translucent colours show a checkerboard behind them */
  color: string;
  /** edge length in px (default 28) */
  size?: number;
  /** ring around the swatch */
  selected?: boolean;
  /** makes the swatch a button */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** tooltip and accessible name (defaults to the colour value) */
  title?: string;
  shape?: "circle" | "square";
  className?: string;
}

export function ColorSwatch({ color, size = 28, selected = false, onClick, title, shape = "circle", className }: ColorSwatchProps) {
  const style = { width: size, height: size, "--cf-swatch": color } as CSSProperties;
  const classes = cx("cf-swatch", `cf-swatch--${shape}`, selected && "is-selected", onClick && "is-button", className);
  const body = (
    <>
      <span className="cf-swatch__checker" />
      <span className="cf-swatch__fill" />
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} style={style} title={title} aria-label={title ?? color} aria-pressed={selected} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <span className={classes} style={style} title={title} role="img" aria-label={title ?? color}>
      {body}
    </span>
  );
}
