/**
 * A side of a page while it is being typed (the custom size of the Create dialog, the Resize dialog): whether the text in the
 * field is a size that can be used, could still become one as more is typed, or cannot become one any more.
 *
 * - `ok`: a size between the limits.
 * - `pending`: nothing usable yet, but typing on may give one ("", "2" on the way to "200", "0." on the way to "0.5 in"). The
 *   button that uses the size is off; nobody is told off while still typing.
 * - `invalid`: no more typing can make it a size ("9000", "abc", "-5", "20.5" px): the button is off and the message shows.
 */
import type { SizeUnit } from "@/core/types";
import { toPx } from "./designTypes";

export type SizeDraftCheck = "ok" | "pending" | "invalid";

export function checkSizeDraft(text: string, unit: SizeUnit, minPx: number, maxPx: number): SizeDraftCheck {
  const typed = text.trim().replace(",", ".");
  if (typed === "" || typed === ".") return "pending";
  const number = /^(\d+)(\.(\d*))?|^\.(\d+)/.exec(typed);
  if (!number) return "invalid";
  const value = Number.parseFloat(number[0]);
  if (!Number.isFinite(value)) return "invalid";
  const px = toPx(value, unit);
  if (px > maxPx + 1e-9) return "invalid";
  if (px >= minPx - 1e-9) return "ok";
  // something after the number ("12px"): typing on no longer changes the number
  if (typed.length > number[0].length) return "invalid";
  // too small: more digits make a whole number ten times larger (and so reach the range, which is wider than ten times),
  // but after the decimal point they add less than one more unit of the last digit typed
  const decimals = number[2] !== undefined ? (number[3] ?? "").length : number[4] !== undefined ? number[4].length : null;
  if (decimals === null) return "pending";
  return toPx(value + 10 ** -decimals, unit) > minPx ? "pending" : "invalid";
}

/** The size in px that a side being typed already is (its check is `ok`), or null while it is not one: what a preview can show. */
export function sizeDraftPx(text: string, unit: SizeUnit, minPx: number, maxPx: number): number | null {
  if (checkSizeDraft(text, unit, minPx, maxPx) !== "ok") return null;
  // the check found a number at the start ("1200", "12.", ".5", "1,5"), which is what parseFloat reads
  return toPx(Number.parseFloat(text.trim().replace(",", ".")), unit);
}
