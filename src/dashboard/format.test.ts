import { describe, expect, it } from "vitest";
import { formatBytes, formatDeleted, formatEdited, formatRelative, matchesWords, parseSizeQuery, plural, searchWords } from "./format";

/** Thursday 5 November 2026, 15:30 local time. */
const NOW = new Date(2026, 10, 5, 15, 30, 0).getTime();
const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const minutes = (n: number) => NOW - n * 60_000;

const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

describe("formatRelative", () => {
  it("says 'just now' for the last minute, and for times in the future", () => {
    expect(formatRelative(NOW, NOW)).toBe("just now");
    expect(formatRelative(NOW - 59_999, NOW)).toBe("just now");
    expect(formatRelative(NOW + 5 * 60_000, NOW)).toBe("just now");
  });

  it("counts minutes up to the hour", () => {
    expect(formatRelative(minutes(1), NOW)).toBe("1 min ago");
    expect(formatRelative(minutes(5), NOW)).toBe("5 min ago");
    expect(formatRelative(minutes(59), NOW)).toBe("59 min ago");
  });

  it("counts hours within the same day", () => {
    expect(formatRelative(minutes(60), NOW)).toBe("1h ago");
    expect(formatRelative(minutes(3 * 60 + 20), NOW)).toBe("3h ago");
    expect(formatRelative(at(2026, 11, 5, 0, 5), NOW)).toBe("15h ago");
  });

  it("goes by the calendar from yesterday on, however few hours have passed", () => {
    expect(formatRelative(at(2026, 11, 4, 23, 50), NOW)).toBe("yesterday");
    expect(formatRelative(at(2026, 11, 4, 0, 1), NOW)).toBe("yesterday");
    expect(formatRelative(at(2026, 11, 3, 23, 59), NOW)).toBe("2 days ago");
  });

  it("counts days up to six", () => {
    expect(formatRelative(at(2026, 11, 2), NOW)).toBe("3 days ago");
    expect(formatRelative(at(2026, 10, 30), NOW)).toBe("6 days ago");
  });

  it("switches to a date after a week, without the year inside the current year", () => {
    const date = at(2026, 10, 29);
    expect(formatRelative(date, NOW)).toBe(monthDay.format(new Date(date)));
    const earlier = at(2026, 3, 14);
    expect(formatRelative(earlier, NOW)).toBe(monthDay.format(new Date(earlier)));
  });

  it("adds the year for dates in other years", () => {
    const date = at(2024, 10, 4);
    expect(formatRelative(date, NOW)).toBe(monthDayYear.format(new Date(date)));
    expect(formatRelative(date, NOW)).toContain("2024");
  });

  it("measures against the clock when no 'now' is given", () => {
    expect(formatRelative(Date.now() - 1000)).toBe("just now");
    expect(formatRelative(Date.now() - 5 * 60_000)).toBe("5 min ago");
  });
});

describe("formatEdited / formatDeleted", () => {
  it("put the relative time after a verb", () => {
    expect(formatEdited(minutes(5), NOW)).toBe("Edited 5 min ago");
    expect(formatDeleted(at(2026, 11, 4, 22), NOW)).toBe("Deleted yesterday");
  });

  it("measure against the clock when no 'now' is given", () => {
    expect(formatEdited(Date.now())).toBe("Edited just now");
    expect(formatDeleted(Date.now())).toBe("Deleted just now");
  });
});

describe("plural", () => {
  it("uses the singular for one and the plural otherwise, zero included", () => {
    expect(plural(1, "design")).toBe("1 design");
    expect(plural(3, "design")).toBe("3 designs");
    expect(plural(0, "design")).toBe("0 designs");
  });

  it("takes an irregular plural", () => {
    expect(plural(1, "copy", "copies")).toBe("1 copy");
    expect(plural(2, "copy", "copies")).toBe("2 copies");
  });
});

describe("formatBytes", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(845)).toBe("845 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("shows one decimal below ten and none above", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
  });

  it("goes up to gigabytes", () => {
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(2048 * 1024 ** 3)).toBe("2048.0 GB");
  });

  it("shows nothing for sizes that make no sense", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("searchWords / matchesWords", () => {
  it("splits a search into lower-case words", () => {
    expect(searchWords("  Birthday   CARD ")).toEqual(["birthday", "card"]);
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
  });

  it("matches when every word occurs somewhere, in any order and case", () => {
    const words = searchWords("post insta");
    expect(matchesWords("Instagram Post", words)).toBe(true);
    expect(matchesWords("INSTAGRAM POST", words)).toBe(true);
    expect(matchesWords("Instagram Story", words)).toBe(false);
  });

  it("matches everything for an empty search", () => {
    expect(matchesWords("anything", [])).toBe(true);
    expect(matchesWords("", [])).toBe(true);
  });
});

describe("parseSizeQuery", () => {
  it.each([
    ["1200x628", 1200, 628],
    ["1200 × 628", 1200, 628],
    ["1200 * 628", 1200, 628],
    ["1200 by 628", 1200, 628],
    ["  800X600px ", 800, 600],
    ["800 x 600 px", 800, 600],
    ["40x40", 40, 40],
    ["99999x10000", 99999, 10000],
  ])("reads %s as a size", (query, width, height) => {
    expect(parseSizeQuery(query)).toEqual({ width, height });
  });

  it.each(["", "poster", "12x6", "1200", "1200x", "x628", "100000x100", "1200 x 628 mm", "12 by", "1200x628x3"])("does not read %j as a size", (query) => {
    expect(parseSizeQuery(query)).toBeNull();
  });
});
