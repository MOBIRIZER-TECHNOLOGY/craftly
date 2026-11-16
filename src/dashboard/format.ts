/** Small text formatting helpers for the dashboard (relative times, sizes, plurals). */
import { date, m, num } from "@/i18n";

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * "just now", "5 min ago", "2h ago", "yesterday", "3 days ago", then a date ("Oct 4", "Oct 4, 2024").
 * Calendar based from yesterday on, so "yesterday" never shows up for something that happened 20 hours ago today.
 */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  const words = m.dashboard.time;
  if (diff < 60_000) return words.justNow;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return words.minutesAgo(minutes);
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days <= 0) return words.hoursAgo(Math.floor(minutes / 60));
  if (days === 1) return words.yesterday;
  if (days < 7) return words.daysAgo(days);
  const when = new Date(timestamp);
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return date(when, sameYear ? MONTH_DAY : MONTH_DAY_YEAR);
}

export const formatEdited = (timestamp: number, now?: number) => m.dashboard.time.edited(formatRelative(timestamp, now));
export const formatDeleted = (timestamp: number, now?: number) => m.dashboard.time.deleted(formatRelative(timestamp, now));

/** "1 design", "3 designs". English only: what a person reads takes its counts from the catalog (m.dashboard.counts). */
export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "845 B", "12 KB", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  // the units are written as they are in every language; the number as the language writes it
  const whole = (n: number) => num(Math.round(n), { useGrouping: false });
  const tenth = (n: number) => num(n, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes < 1024) return `${whole(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? tenth(kb) : whole(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? tenth(mb) : whole(mb)} MB`;
  return `${tenth(mb / 1024)} GB`;
}

/** Splits a search box value into lower-case words. */
export const searchWords = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** True when every word occurs in the haystack. An empty word list matches everything. */
export const matchesWords = (haystack: string, words: string[]): boolean => {
  if (words.length === 0) return true;
  const text = haystack.toLowerCase();
  return words.every((word) => text.includes(word));
};

/** Parses "1200x628", "1200 × 628" or "1200 * 628" into pixel dimensions, or null. */
export function parseSizeQuery(query: string): { width: number; height: number } | null {
  const match = /^\s*(\d{2,5})\s*(?:x|×|\*|by)\s*(\d{2,5})\s*(?:px)?\s*$/i.exec(query);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}
