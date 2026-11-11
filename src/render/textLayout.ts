/**
 * Rich text layout: turns a TextElement (paragraphs of styled runs) into
 * positioned lines. The same layout drives canvas painting, selection boxes,
 * SVG export and text-box auto sizing, so what you see is what you export.
 *
 * Line boxes follow the CSS model (half-leading above and below the font's
 * content area) so the contentEditable overlay used while typing lines up with
 * the canvas rendering.
 */
import { clearMeasureCache, measureMetrics, measureWidth } from "@/core/textMetrics";
import type { TextAlign, TextCase, TextElement, TextParagraph, TextRun } from "@/core/types";
import { cssFontFamily, fontsEpoch } from "./fonts";

export interface RunStyle {
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  color: string;
  underline: boolean;
  strike: boolean;
  /** letter spacing in px */
  spacing: number;
}

export interface LayoutSegment {
  text: string;
  /** x offset inside the line (before line.x) */
  x: number;
  width: number;
  style: RunStyle;
  font: string;
  isSpace: boolean;
}

export interface LayoutLine {
  segments: LayoutSegment[];
  /** left offset of the first segment inside the element box */
  x: number;
  /** top of the line box */
  y: number;
  /** painted width (without trailing spaces) */
  width: number;
  height: number;
  /** distance from the top of the line box to the baseline */
  baseline: number;
  paragraph: number;
  align: TextAlign;
  /** largest font size on the line */
  size: number;
  marker?: { text: string; x: number; style: RunStyle; font: string };
}

export interface TextLayout {
  lines: LayoutLine[];
  /** box width (element width, or content width for auto-width text) */
  width: number;
  height: number;
  /** widest painted line */
  contentWidth: number;
}

export function fontString(style: Pick<RunStyle, "family" | "weight" | "italic" | "size">): string {
  return `${style.italic ? "italic " : ""}${style.weight} ${style.size}px ${cssFontFamily(style.family)}`;
}

function applyCase(text: string, mode: TextCase): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  // (\b would not do here: it does not see accented letters as part of a word, so "élan" would become "éLan")
  if (mode === "title") return text.replace(/(^|[^\wÀ-ɏ])([a-zÀ-ɏ])([a-zÀ-ɏ']*)/gi, (_m, before: string, a: string, b: string) => before + a.toUpperCase() + b.toLowerCase());
  return text;
}

export function resolveRunStyle(el: TextElement, run: TextRun | null): RunStyle {
  let weight = el.fontWeight;
  if (run?.bold === true) weight = Math.max(700, weight);
  else if (run?.bold === false) weight = Math.min(400, weight);
  const size = run?.size ?? el.fontSize;
  return {
    family: run?.font ?? el.fontFamily,
    weight,
    italic: run?.italic ?? el.italic,
    size,
    color: run?.color ?? el.color,
    underline: run?.underline ?? el.underline,
    strike: run?.strike ?? el.strike,
    spacing: ((run?.spacing ?? el.letterSpacing) / 1000) * size,
  };
}

interface Token {
  text: string;
  style: RunStyle;
  font: string;
  width: number;
  space: boolean;
  hardBreak: boolean;
}

function tokenizeParagraph(el: TextElement, para: TextParagraph): Token[] {
  const tokens: Token[] = [];
  for (const run of para.runs) {
    const style = resolveRunStyle(el, run);
    const font = fontString(style);
    const text = applyCase(run.text, el.textCase);
    const parts = text.split("\n");
    parts.forEach((part, pi) => {
      if (pi > 0) tokens.push({ text: "", style, font, width: 0, space: false, hardBreak: true });
      for (const piece of part.split(/(\s+)/)) {
        if (!piece) continue;
        const space = /^\s+$/.test(piece);
        tokens.push({ text: piece, style, font, width: measureWidth(font, piece) + style.spacing * piece.length, space, hardBreak: false });
      }
    });
  }
  return tokens;
}

/** Splits a token wider than the line into character chunks that fit. */
function splitLongToken(t: Token, avail: number): Token[] {
  const out: Token[] = [];
  let buf = "";
  let w = 0;
  for (const ch of Array.from(t.text)) {
    const cw = measureWidth(t.font, ch) + t.style.spacing;
    if (buf && w + cw > avail) {
      out.push({ ...t, text: buf, width: w });
      buf = "";
      w = 0;
    }
    buf += ch;
    w += cw;
  }
  if (buf) out.push({ ...t, text: buf, width: w });
  return out;
}

function breakIntoLines(tokens: Token[], avail: number): Token[][] {
  const lines: Token[][] = [];
  let cur: Token[] = [];
  let curW = 0;
  const flush = () => {
    lines.push(cur);
    cur = [];
    curW = 0;
  };
  // The tokens are read by index, and what is put back (the word that starts the next line, the pieces of a word that was split)
  // waits on a stack of its own. Taking tokens off the front of one long array, and putting them back there, costs the length of
  // the array each time: a text of a megabyte then took seconds to lay out, and four times as long for twice the text.
  let next = 0;
  const putBack: Token[] = [];
  while (putBack.length || next < tokens.length) {
    const t = putBack.length ? (putBack.pop() as Token) : tokens[next++];
    if (t.hardBreak) {
      flush();
      continue;
    }
    if (t.space) {
      if (cur.length === 0 && lines.length > 0 && Number.isFinite(avail)) continue; // drop spaces at a soft-wrap start
      cur.push(t);
      curW += t.width;
      continue;
    }
    if (Number.isFinite(avail) && curW + t.width > avail + 0.01) {
      if (cur.length === 0 || cur.every((x) => x.space)) {
        if (t.width > avail) {
          const parts = splitLongToken(t, avail);
          if (parts.length > 1) {
            for (let i = parts.length - 1; i >= 0; i--) putBack.push(parts[i]);
            cur = [];
            curW = 0;
            continue;
          }
        }
      } else {
        // trim trailing spaces then wrap
        while (cur.length && cur[cur.length - 1].space) cur.pop();
        flush();
        putBack.push(t);
        continue;
      }
    }
    cur.push(t);
    curW += t.width;
  }
  lines.push(cur);
  return lines;
}

function mergeSegments(tokens: Token[]): LayoutSegment[] {
  const out: LayoutSegment[] = [];
  let x = 0;
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (
      last &&
      last.font === t.font &&
      last.style.color === t.style.color &&
      last.style.underline === t.style.underline &&
      last.style.strike === t.style.strike &&
      last.style.spacing === t.style.spacing &&
      last.isSpace === t.space
    ) {
      last.text += t.text;
      last.width += t.width;
    } else {
      out.push({ text: t.text, x, width: t.width, style: t.style, font: t.font, isSpace: t.space });
    }
    x += t.width;
  }
  return out;
}

const cache = new WeakMap<TextElement, { epoch: number; width: number | undefined; layout: TextLayout }>();
let lastEpoch = -1;

export function layoutText(el: TextElement, widthOverride?: number): TextLayout {
  const epoch = fontsEpoch();
  if (epoch !== lastEpoch) {
    lastEpoch = epoch;
    clearMeasureCache();
  }
  const hit = cache.get(el);
  if (hit && hit.epoch === epoch && hit.width === widthOverride) return hit.layout;
  const layout = computeLayout(el, widthOverride);
  cache.set(el, { epoch, width: widthOverride, layout });
  return layout;
}

function computeLayout(el: TextElement, widthOverride?: number): TextLayout {
  const wrapWidth = el.autoWidth ? Infinity : Math.max(8, widthOverride ?? el.width);
  const lines: LayoutLine[] = [];
  let y = 0;
  let contentWidth = 0;
  let counter = 0;

  el.paragraphs.forEach((para, pi) => {
    const list = para.list ?? el.list ?? null;
    counter = list === "number" ? counter + 1 : 0;
    const align = para.align ?? el.align;
    const baseStyle = resolveRunStyle(el, para.runs[0] ?? null);
    const indent = list ? Math.round(baseStyle.size * 1.25) : 0;
    const avail = wrapWidth - indent;
    const tokens = tokenizeParagraph(el, para);
    const tokenLines = breakIntoLines(tokens, avail);

    tokenLines.forEach((toks, li) => {
      // trailing spaces do not count towards the painted width
      const trimmed = [...toks];
      while (trimmed.length && trimmed[trimmed.length - 1].space && trimmed.length > 1) trimmed.pop();
      const segments = mergeSegments(trimmed);
      const lastInk = [...segments].reverse().find((s) => !s.isSpace);
      // trailing spaces and the letter spacing after the last glyph do not count towards the painted width
      const width =
        segments.reduce((n, s) => n + s.width, 0) -
        (segments.length && segments[segments.length - 1].isSpace ? segments[segments.length - 1].width : 0) -
        (lastInk ? lastInk.style.spacing : 0);
      const size = trimmed.length ? Math.max(...trimmed.map((t) => t.style.size)) : baseStyle.size;
      const sizing = trimmed.length ? trimmed.reduce((a, b) => (b.style.size >= a.style.size ? b : a)) : null;
      const font = sizing ? sizing.font : fontString(baseStyle);
      const m = measureMetrics(font);
      const boxH = size * el.lineHeight;
      const baseline = (boxH - (m.ascent + m.descent)) / 2 + m.ascent;
      const line: LayoutLine = { segments, x: indent, y, width, height: boxH, baseline, paragraph: pi, align, size };
      if (list && li === 0) {
        line.marker = {
          text: list === "bullet" ? "•" : `${counter}.`,
          x: 0,
          style: baseStyle,
          font: fontString(baseStyle),
        };
      }
      lines.push(line);
      contentWidth = Math.max(contentWidth, width + indent);
      y += boxH;
    });
  });

  const boxWidth = el.autoWidth ? Math.max(contentWidth, 1) : wrapWidth;

  // horizontal alignment (needs the final box width)
  for (const line of lines) {
    const indent = line.x;
    const free = boxWidth - indent - line.width;
    if (line.align === "center") line.x = indent + free / 2;
    else if (line.align === "right") line.x = indent + free;
    else if (line.align === "justify" && !el.autoWidth) {
      const nextSame = lines[lines.indexOf(line) + 1]?.paragraph === line.paragraph;
      const spaces = line.segments.filter((s) => s.isSpace);
      if (nextSame && spaces.length && free > 0) {
        const extra = free / spaces.reduce((n, s) => n + Math.max(1, s.text.length), 0);
        let shift = 0;
        for (const s of line.segments) {
          s.x += shift;
          if (s.isSpace) {
            const add = extra * Math.max(1, s.text.length);
            s.width += add;
            shift += add;
          }
        }
        line.width += free;
      }
    }
  }

  return { lines, width: boxWidth, height: Math.max(y, el.fontSize * el.lineHeight), contentWidth };
}

export interface CurveGeometry {
  /** total angle of the arc in radians */
  arc: number;
  radius: number;
  /** how far the ends of the text drop (arch up) or rise (arch down) relative to the middle */
  sag: number;
  /** 1 = text arches upwards, -1 = bows downwards */
  dir: 1 | -1;
}

/** Arc used by curved text (curve -100..100 spans up to 220 degrees). Null for straight text. */
export function curveGeometry(el: TextElement, layout: TextLayout): CurveGeometry | null {
  if (!el.curve) return null;
  const arc = (Math.min(Math.abs(el.curve), 100) * 2.2 * Math.PI) / 180;
  if (arc < 0.02) return null;
  const radius = Math.max(layout.contentWidth, 1) / arc;
  return { arc, radius, sag: radius * (1 - Math.cos(arc / 2)), dir: el.curve > 0 ? 1 : -1 };
}

/** Size a text element occupies: width follows content for auto-width boxes; curved text is taller. */
export function measureTextElement(el: TextElement): { width: number; height: number } {
  const l = layoutText(el);
  const curve = curveGeometry(el, l);
  return { width: el.autoWidth ? Math.ceil(l.width) : el.width, height: Math.ceil(l.height + (curve ? curve.sag : 0)) };
}

/** Horizontal fraction of the box that stays put when an auto-width box changes size. */
export function alignAnchor(align: TextAlign): number {
  return align === "center" ? 0.5 : align === "right" ? 1 : 0;
}
