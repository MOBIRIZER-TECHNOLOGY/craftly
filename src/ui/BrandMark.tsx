import { useId, type CSSProperties, type SVGProps } from "react";

export interface BrandMarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "children"> {
  /** edge length in px (default 32) */
  size?: number | string;
  /** "color": gradient tile (default). "light": translucent white tile for use on the brand gradient. */
  variant?: "color" | "light";
  /** accessible name; the mark is decorative (aria-hidden) when omitted */
  title?: string;
}

/** The Craftly logo: gradient rounded square with a white "C" arc and a dot (mirrors /public/favicon.svg). */
export function BrandMark({ size = 32, variant = "color", title, style, ...rest }: BrandMarkProps) {
  const gradientId = useId();
  const fill = variant === "color" ? `url(#${gradientId})` : "rgba(255,255,255,.22)";
  const css: CSSProperties = { flexShrink: 0, ...style };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={css}
      {...rest}
    >
      {variant === "color" && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#14b8a6" />
            <stop offset=".55" stopColor="#4f7cf7" />
            <stop offset="1" stopColor="#8b3dff" />
          </linearGradient>
        </defs>
      )}
      <rect width="64" height="64" rx="16" fill={fill} />
      <path d="M41.5 22.5a13 13 0 1 0 0 19" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="44" cy="32" r="4" fill="#fff" />
    </svg>
  );
}

export interface RotateHandleIconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "children"> {
  /** edge length in px (default 16) */
  size?: number | string;
}

/** Circular-arrow glyph for the selection box rotate handle (stroke follows `currentColor`). */
export function RotateHandleIcon({ size = 16, style, ...rest }: RotateHandleIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      <path d="M19.6 12.2a7.6 7.6 0 1 1-2.5-5.6" />
      <path d="M19.9 3.9v4.9h-4.9" />
    </svg>
  );
}
