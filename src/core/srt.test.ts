import { describe, expect, it } from "vitest";
import { MAX_CAPTIONS, MAX_CAPTION_LENGTH } from "./animation";
import { readSrt, writeSrt } from "./srt";

describe("reading a subtitle file", () => {
  it("reads numbered blocks with their times and words", () => {
    const file = "1\n00:00:01,500 --> 00:00:03,250\nHello there\n\n2\n00:00:03,250 --> 00:00:05,000\nSecond line\n";
    expect(readSrt(file)).toEqual({
      captions: [
        { start: 1.5, end: 3.25, text: "Hello there" },
        { start: 3.25, end: 5, text: "Second line" },
      ],
      skipped: 0,
    });
  });

  it("joins the lines of text of a block, and takes Windows line ends and a byte-order mark", () => {
    const file = "\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\nTwo lines\r\nof words\r\n";
    expect(readSrt(file).captions).toEqual([{ start: 0, end: 2, text: "Two lines of words" }]);
  });

  it("forgives a missing number, a dot for the comma, minutes without hours and position settings", () => {
    const file = "00:00:01.5 --> 00:00:02.75\nno number\n\n3\n01:02,5 --> 01:04,000 X1:40 X2:600\nshort times\n";
    expect(readSrt(file).captions).toEqual([
      { start: 1.5, end: 2.75, text: "no number" },
      { start: 62.5, end: 64, text: "short times" },
    ]);
  });

  it("reads hours", () => {
    expect(readSrt("1\n01:00:00,000 --> 01:00:01,000\nan hour in\n").captions[0].start).toBe(3600);
  });

  it("drops formatting tags and keeps the words", () => {
    expect(readSrt('1\n00:00:00,000 --> 00:00:01,000\n<i>soft</i> {\\an8}<font color="red">red</font>\n').captions[0].text).toBe("soft red");
  });

  it("skips and counts blocks it cannot read, and keeps the rest", () => {
    const file = [
      "1\n00:00:00,000 --> 00:00:01,000\nfine",
      "2\nno time line here",
      "3\n00:00:05,000 --> 00:00:04,000\nends before it starts",
      "4\nnot a time --> 00:00:04,000\nbad start",
      "5\n00:00:06,000 --> 00:00:07,000\n",
      "6\n00:00:02,000 --> 00:00:03,000\nalso fine",
    ].join("\n\n");
    const { captions, skipped } = readSrt(file);
    expect(captions.map((c) => c.text)).toEqual(["fine", "also fine"]);
    expect(skipped).toBe(4);
  });

  it("puts the lines in the order they start", () => {
    const file = "1\n00:00:05,000 --> 00:00:06,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\nearlier\n";
    expect(readSrt(file).captions.map((c) => c.text)).toEqual(["earlier", "later"]);
  });

  it("keeps at most 200 lines of at most 300 letters", () => {
    const many = Array.from(
      { length: MAX_CAPTIONS + 3 },
      (_, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, "0")},000 --> 00:00:${String((i % 60) + 1).padStart(2, "0")},000\n${"x".repeat(MAX_CAPTION_LENGTH + 5)}`,
    ).join("\n\n");
    const { captions, skipped } = readSrt(many);
    expect(captions).toHaveLength(MAX_CAPTIONS);
    expect(captions[0].text).toHaveLength(MAX_CAPTION_LENGTH);
    expect(skipped).toBe(3);
  });

  it("finds nothing in an empty file or in text that is not subtitles", () => {
    expect(readSrt("")).toEqual({ captions: [], skipped: 0 });
    expect(readSrt("just some words\n\nand more")).toEqual({ captions: [], skipped: 2 });
  });
});

describe("writing a subtitle file", () => {
  it("numbers the lines and writes the times as SubRip does", () => {
    expect(
      writeSrt([
        { start: 1.5, end: 3.25, text: "Hello" },
        { start: 3661.007, end: 3662, text: "An hour in" },
      ]),
    ).toBe("1\r\n00:00:01,500 --> 00:00:03,250\r\nHello\r\n\r\n2\r\n01:01:01,007 --> 01:01:02,000\r\nAn hour in\r\n");
  });

  it("reads back what it wrote", () => {
    const lines = [
      { start: 0, end: 1.2, text: "Red with a low tone" },
      { start: 1.2, end: 2.4, text: "Blue with a high tone" },
    ];
    expect(readSrt(writeSrt(lines))).toEqual({ captions: lines, skipped: 0 });
  });

  it("is empty for no lines", () => {
    expect(writeSrt([])).toBe("");
  });
});
