import type { CSSProperties } from "react";
import { contrastRatio, hslToHex } from "@/core/color";
import "./Avatar.css";
import { cx } from "./cx";

export interface AvatarProps {
  /** full name; initials and the default colour are derived from it */
  name: string;
  /** diameter in px (default 32) */
  size?: number;
  /** background colour override (any CSS colour); text stays white */
  color?: string;
  /** image URL; falls back to initials when missing or broken */
  src?: string;
  className?: string;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/**
 * The background an avatar gets when it is not given one: the name's hue at 58 % saturation and 42 % lightness, made
 * darker, a step at a time, for the hues (greens and teals) where the white initials would be under 4.5:1 on it.
 */
export function avatarColour(name: string): string {
  const hue = hueOf(name);
  let lightness = 42;
  while (lightness > 20 && contrastRatio("#ffffff", hslToHex(hue, 58, lightness)) < 4.5) lightness -= 1;
  return `hsl(${hue} 58% ${lightness}%)`;
}

export function Avatar({ name, size = 32, color, src, className }: AvatarProps) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.4)),
    background: color ?? avatarColour(name),
  } as CSSProperties;
  return (
    <span className={cx("cf-avatar", className)} style={style} role="img" aria-label={name} title={name}>
      {src ? <img className="cf-avatar__img" src={src} alt="" draggable={false} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}
