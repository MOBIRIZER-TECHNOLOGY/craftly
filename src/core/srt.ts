/**
 * Subtitle files (SubRip, `.srt`) for a clip's captions: read a file into caption lines and write the lines back out. A file is a
 * list of blocks separated by blank lines; each block is a number, a time line `00:00:01,500 --> 00:00:03,250` and one or more
 * lines of text. Readers in the wild are forgiving, so this one is too: the number may be missing, a dot may stand for the comma,
 * the hours may be left out, and a block it cannot read is skipped and counted, not a reason to refuse the file.
 *
 * Pure text in and out, no DOM: unit tested in node.
 */
import type { ClipCaption } from "./types";
import { MAX_CAPTIONS, MAX_CAPTION_LENGTH } from "./animation";

/** `01:02:03,456`, `02:03.4` or `3,5`: seconds, or NaN. */
function readTime(text: string): number {
  const m = /^\s*(?:(\d+):)?(?:(\d+):)?(\d+)(?:[,.](\d{1,3}))?\s*$/.exec(text);
  if (!m) return Number.NaN;
  // with one colon the parts are minutes and seconds; with two, hours, minutes and seconds
  const [h, min] = m[2] !== undefined ? [Number(m[1]), Number(m[2])] : [0, Number(m[1] ?? 0)];
  const fraction = m[4] ? Number(m[4].padEnd(3, "0")) / 1000 : 0;
  return h * 3600 + min * 60 + Number(m[3]) + fraction;
}

export interface SrtResult {
  captions: ClipCaption[];
  /** blocks that could not be read (no time line, a time that is not one, an end before its start, no text) */
  skipped: number;
}

/** The caption lines of a SubRip file: at most MAX_CAPTIONS of them, each cut to MAX_CAPTION_LENGTH letters, in the order they start. */
export function readSrt(file: string): SrtResult {
  const blocks = file
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const captions: ClipCaption[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) {
      skipped++;
      continue;
    }
    const [from, to] = lines[at].split("-->");
    // a time line may carry position settings after the end time ("00:00:02,000 --> 00:00:03,000 X1:40"): only the time is read
    const start = readTime(from);
    const end = readTime(to.trim().split(/\s+/)[0] ?? "");
    const text = lines
      .slice(at + 1)
      .join(" ")
      // the formatting tags a SubRip file may carry (<i>, <b>, <font ...>) and the braces of others ({\an8})
      .replace(/<[^>]*>|\{[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
      skipped++;
      continue;
    }
    if (captions.length >= MAX_CAPTIONS) {
      skipped++;
      continue;
    }
    captions.push({ start, end, text: text.slice(0, MAX_CAPTION_LENGTH) });
  }
  captions.sort((a, b) => a.start - b.start);
  return { captions, skipped };
}

/** `00:01:02,500` */
function writeTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, "0")}`;
}

/** Caption lines as a SubRip file, numbered from 1, with Windows line ends as most players expect. */
export function writeSrt(captions: readonly ClipCaption[]): string {
  return captions.map((c, i) => `${i + 1}\r\n${writeTime(c.start)} --> ${writeTime(c.end)}\r\n${c.text}\r\n`).join("\r\n");
}
