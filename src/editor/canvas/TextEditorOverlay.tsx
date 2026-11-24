import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { normalizeHex } from "@/core/color";
import { normalizeParagraphs } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { TextElement, TextParagraph, TextRun } from "@/core/types";
import { cssFontFamily, customFontDefs, FONT_CATALOG } from "@/render/fonts";
import { findElement } from "@/core/ops";
import { takePendingCaret, takeSelectAllOnEdit } from "./controller";
import { worldBox } from "./frame";
import { registerTextEditor, useTextSelectionStyle, type InlineFormat } from "./textEditing";

/* ------------------------------------------------------------------ */
/* model <-> DOM                                                       */
/* ------------------------------------------------------------------ */

/** The background that marks the selected characters while a weight is set on them (see `applyInline`): no text has one. */
const WEIGHT_MARK = "#010203";
const WEIGHT_MARK_RGB = "rgb(1, 2, 3)";

function applyRunStyle(style: CSSStyleDeclaration, run: TextRun, zoom: number): void {
  if (run.weight !== undefined) style.fontWeight = String(run.weight);
  else if (run.bold !== undefined) style.fontWeight = run.bold ? "700" : "400";
  if (run.italic !== undefined) style.fontStyle = run.italic ? "italic" : "normal";
  const deco: string[] = [];
  if (run.underline) deco.push("underline");
  if (run.strike) deco.push("line-through");
  if (run.underline !== undefined || run.strike !== undefined) style.textDecoration = deco.join(" ") || "none";
  if (run.color) style.color = run.color;
  if (run.size) style.fontSize = `${run.size * zoom}px`;
  if (run.font) style.fontFamily = cssFontFamily(run.font);
}

/**
 * Builds the editable DOM for the paragraphs with createElement and CSSOM
 * setters (never innerHTML), so a crafted design file cannot inject markup.
 */
function buildDom(paragraphs: TextParagraph[], base: TextElement, zoom: number): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const p of paragraphs) {
    const div = document.createElement("div");
    const list = p.list ?? base.list ?? null;
    if (list) div.setAttribute("data-list", list);
    if (p.align) div.style.textAlign = p.align;
    let any = false;
    for (const run of p.runs) {
      if (!run.text) continue;
      any = true;
      run.text.split("\n").forEach((part, i) => {
        if (i > 0) div.appendChild(document.createElement("br"));
        if (!part) return;
        const span = document.createElement("span");
        applyRunStyle(span.style, run, zoom);
        span.textContent = part;
        div.appendChild(span);
      });
    }
    if (!any) div.appendChild(document.createElement("br"));
    frag.appendChild(div);
  }
  return frag;
}

const BLOCK = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"]);

function familyFromCss(value: string): string {
  const first = value
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
  // an uploaded family is registered under a name the app made up: the document stores the name the person knows it by
  const def = [...FONT_CATALOG, ...customFontDefs()].find((f) => f.css === first || f.family === first);
  return def ? def.family : first;
}

function styleAt(node: Node | null, root: HTMLElement, base: TextElement, zoom: number): Partial<TextRun> {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  if (!el || !root.contains(el)) return {};
  const cs = getComputedStyle(el);
  const run: Partial<TextRun> = {};
  const weight = parseInt(cs.fontWeight, 10) || 400;
  if (weight !== base.fontWeight) {
    if (weight === 700 && base.fontWeight < 600) run.bold = true;
    else if (weight === 400 && base.fontWeight >= 600) run.bold = false;
    else run.weight = weight;
  }
  const italic = cs.fontStyle === "italic" || cs.fontStyle === "oblique";
  if (italic !== base.italic) run.italic = italic;
  let underline = false;
  let strike = false;
  for (let a: HTMLElement | null = el; a && a !== root.parentElement; a = a.parentElement) {
    const line = getComputedStyle(a).textDecorationLine;
    if (line.includes("underline")) underline = true;
    if (line.includes("line-through")) strike = true;
    if (a === root) break;
  }
  if (underline !== base.underline) run.underline = underline;
  if (strike !== base.strike) run.strike = strike;
  const color = normalizeHex(cs.color);
  const baseColor = normalizeHex(base.gradient?.stops[0]?.color ?? base.color);
  if (color !== baseColor) run.color = color;
  const size = Math.round((parseFloat(cs.fontSize) / zoom) * 10) / 10;
  if (Math.abs(size - base.fontSize) > 0.6) run.size = size;
  const font = familyFromCss(cs.fontFamily);
  if (font !== base.fontFamily) run.font = font;
  return run;
}

function domToParagraphs(root: HTMLElement, base: TextElement, zoom: number): TextParagraph[] {
  const out: TextParagraph[] = [];
  let loose: TextParagraph | null = null;

  // `parent` is the real element the nodes live in, when `container` is only a one-node wrapper around a loose child
  const collectRuns = (container: Node, para: TextParagraph, parent: Node = container) => {
    container.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = (n.textContent ?? "").replace(/\u200b/g, "");
        if (text) para.runs.push({ text, ...styleAt(n, root, base, zoom) });
      } else if (n instanceof HTMLElement) {
        if (n.tagName === "BR") {
          // a lone <br> is an empty line, a <br> after text is a soft line break
          if (parent.childNodes.length > 1) para.runs.push({ text: "\n", ...styleAt(n, root, base, zoom) });
        } else if (!BLOCK.has(n.tagName)) collectRuns(n, para);
        else flushBlock(n);
      }
    });
  };

  const flushBlock = (el: HTMLElement) => {
    const hasBlockChild = Array.from(el.children).some((c) => BLOCK.has(c.tagName));
    if (hasBlockChild) {
      el.childNodes.forEach((c) => {
        if (c instanceof HTMLElement && BLOCK.has(c.tagName)) flushBlock(c);
        else {
          const p: TextParagraph = loose ?? { runs: [] };
          if (!loose) {
            loose = p;
            out.push(p);
          }
          collectRuns({ childNodes: [c] } as unknown as Node, p, el);
        }
      });
      loose = null;
      return;
    }
    loose = null;
    const p: TextParagraph = { runs: [] };
    const list = el.getAttribute("data-list");
    if (list === "bullet" || list === "number") p.list = list;
    const align = el.style.textAlign as TextParagraph["align"];
    if (align) p.align = align;
    collectRuns(el, p);
    out.push(p);
  };

  root.childNodes.forEach((n) => {
    if (n instanceof HTMLElement && BLOCK.has(n.tagName)) flushBlock(n);
    else if (n.nodeType === Node.TEXT_NODE || n instanceof HTMLElement) {
      if (!loose) {
        loose = { runs: [] };
        out.push(loose);
      }
      collectRuns({ childNodes: [n] } as unknown as Node, loose, root);
    }
  });
  if (!out.length) out.push({ runs: [{ text: "" }] });
  for (const p of out) if (!p.runs.length) p.runs.push({ text: "" });
  return normalizeParagraphs(out);
}

/** What the editor should do when it opens, remembered per editor element (see the mount effect). */
const startIntent = new WeakMap<HTMLElement, { selectAll: boolean; caret: { x: number; y: number } | null }>();

/* ------------------------------------------------------------------ */

export function TextEditorOverlay() {
  const id = useEditor((s) => s.editingTextId);
  const page = useEditor((s) => getActivePage(s));
  if (!id || !page) return null;
  const el = findElement(page, id);
  const box = worldBox(page, id);
  if (!el || el.type !== "text" || !box) return null;
  return <TextEditor key={id} el={el} box={box} />;
}

function TextEditor({ el, box }: { el: TextElement; box: { x: number; y: number; width: number; height: number; rotation: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useEditor((s) => s.zoom);
  const spellCheck = useEditor((s) => s.spellCheck);
  const elRef = useRef(el);
  elRef.current = el;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const lastRange = useRef<Range | null>(null);
  const id = el.id;

  const commit = () => {
    const root = ref.current;
    if (!root) return;
    getActions().setTextParagraphs(id, domToParagraphs(root, elRef.current, zoomRef.current));
  };

  /* initial content + caret (runs once per edit session) */
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.replaceChildren(buildDom(el.paragraphs, el, zoom));
    root.focus({ preventScroll: true });
    const sel = window.getSelection();
    const range = document.createRange();
    // The one-shot flags are consumed once per editor element; React StrictMode runs this effect twice in dev.
    let start = startIntent.get(root);
    if (!start) {
      start = { selectAll: takeSelectAllOnEdit(), caret: takePendingCaret() };
      startIntent.set(root, start);
    }
    if (start.selectAll) {
      range.selectNodeContents(root);
    } else {
      const caret = start.caret;
      let placed = false;
      if (caret) {
        const doc = document as Document & {
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        };
        const pos = doc.caretPositionFromPoint?.(caret.x, caret.y);
        const r = pos
          ? (() => {
              const rr = document.createRange();
              rr.setStart(pos.offsetNode, pos.offset);
              return rr;
            })()
          : doc.caretRangeFromPoint?.(caret.x, caret.y);
        if (r && root.contains(r.startContainer)) {
          range.setStart(r.startContainer, r.startOffset);
          range.collapse(true);
          placed = true;
        }
      }
      if (!placed) {
        range.selectNodeContents(root);
        range.collapse(false);
      }
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The DOM keeps absolute px sizes, so they are rescaled when the zoom changes. They are rescaled where they are: building
   * the box again from the model would throw the caret and the selection away, and the next format chosen in the toolbar
   * would have nothing to apply to. A size is rounded as it is when the box is read back (styleAt), so zooming never makes
   * it drift.
   */
  const shownZoom = useRef(zoom);
  useEffect(() => {
    const from = shownZoom.current;
    if (from === zoom) return;
    shownZoom.current = zoom;
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
      const size = node.style.fontSize;
      if (size.endsWith("px")) node.style.fontSize = `${(Math.round((parseFloat(size) / from) * 10) / 10) * zoom}px`;
    });
  }, [zoom]);

  /* element-level list / alignment changed while editing: the paragraph DOM was built once, so sync it */
  const prevBlock = useRef({ list: el.list, align: el.align });
  useEffect(() => {
    const root = ref.current;
    const prev = prevBlock.current;
    prevBlock.current = { list: el.list, align: el.align };
    if (!root || (prev.list === el.list && prev.align === el.align)) return;
    root.querySelectorAll<HTMLElement>(":scope > div").forEach((div) => {
      if (el.list) div.setAttribute("data-list", el.list);
      else div.removeAttribute("data-list");
      div.style.textAlign = "";
    });
  }, [el.list, el.align]);

  /* selection tracking + inline formatting API */
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return;
      lastRange.current = sel.getRangeAt(0).cloneRange();
      const s = styleAt(sel.anchorNode, root, elRef.current, zoomRef.current);
      const base = elRef.current;
      useTextSelectionStyle.getState().set({
        active: true,
        collapsed: sel.isCollapsed,
        style: {
          bold: s.bold ?? (s.weight ?? base.fontWeight) >= 600,
          weight: s.weight ?? base.fontWeight,
          italic: s.italic ?? base.italic,
          underline: s.underline ?? base.underline,
          strike: s.strike ?? base.strike,
          color: s.color ?? base.color,
          size: s.size ?? base.fontSize,
          font: s.font ?? base.fontFamily,
        },
      });
    };
    document.addEventListener("selectionchange", onSel);
    onSel();

    const restore = () => {
      if (document.activeElement !== root) root.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (lastRange.current && sel) {
        sel.removeAllRanges();
        sel.addRange(lastRange.current);
      }
    };

    registerTextEditor({
      focus: () => restore(),
      hasSelection: () => !!lastRange.current && !lastRange.current.collapsed,
      applyInline: (f: InlineFormat) => {
        if (!lastRange.current || lastRange.current.collapsed) return false;
        restore();
        const cmd = (name: string, value?: string) => document.execCommand(name, false, value);
        cmd("styleWithCSS", "true");
        const toggle = (name: string, want: boolean | undefined) => {
          if (want === undefined) return;
          if (document.queryCommandState(name) !== want) cmd(name);
        };
        toggle("bold", f.bold);
        toggle("italic", f.italic);
        toggle("underline", f.underline);
        toggle("strikeThrough", f.strike);
        if (f.color) cmd("foreColor", f.color);
        if (f.font) cmd("fontName", cssFontFamily(f.font));
        // select the styled text again: replacing or restyling nodes can collapse the selection
        const reselect = (made: HTMLElement[]) => {
          if (!made.length) return;
          const range = document.createRange();
          range.setStartBefore(made[0]);
          range.setEndAfter(made[made.length - 1]);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          lastRange.current = range.cloneRange();
        };
        if (f.size) {
          cmd("fontSize", "7");
          const made: HTMLElement[] = [];
          root.querySelectorAll<HTMLElement>('font[size="7"], span[style*="xxx-large"]').forEach((n) => {
            const span = document.createElement("span");
            span.style.cssText = n.getAttribute("style") ?? "";
            span.style.fontSize = `${f.size! * zoomRef.current}px`;
            while (n.firstChild) span.appendChild(n.firstChild);
            n.replaceWith(span);
            made.push(span);
          });
          reselect(made);
        }
        if (f.weight) {
          // There is no command for a weight, and borrowing the one for the size would take the sizes of the characters away. A
          // background no text has (text has none at all) marks what is selected instead: the browser splits the spans at the ends
          // of the selection, and every element that carries the mark gets the weight in its place.
          cmd("hiliteColor", WEIGHT_MARK);
          const made: HTMLElement[] = [];
          root.querySelectorAll<HTMLElement>("[style*='background-color']").forEach((n) => {
            if (n.style.backgroundColor !== WEIGHT_MARK_RGB) return;
            n.style.backgroundColor = "";
            n.style.fontWeight = String(f.weight);
            // a bold or a weight further in would still win over the one set here
            n.querySelectorAll<HTMLElement>("*").forEach((inner) => {
              if (inner.style.backgroundColor === WEIGHT_MARK_RGB) return;
              if (inner.tagName === "B" || inner.tagName === "STRONG") inner.style.fontWeight = "inherit";
              else if (inner.style.fontWeight) inner.style.fontWeight = "";
            });
            made.push(n);
          });
          reselect(made);
        }
        commit();
        return true;
      },
    });
    return () => {
      document.removeEventListener("selectionchange", onSel);
      registerTextEditor(null);
      useTextSelectionStyle.getState().set({ active: false, collapsed: true, style: {} });
      // discard text boxes that were left empty (not one that somebody else is typing in, in a shared design: it is theirs now)
      const text = root.textContent?.replace(/\u200b/g, "").trim() ?? "";
      if (!text && getActions().textHolder(id) === null) {
        const s = useEditor.getState();
        const page = getActivePage(s);
        if (page && findElement(page, id)) getActions().deleteElements([id]);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useMemo<React.CSSProperties>(() => {
    const first = el.gradient?.stops[0]?.color;
    return {
      left: box.x * zoom,
      top: box.y * zoom,
      width: el.autoWidth ? "max-content" : box.width * zoom,
      minWidth: 6,
      transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
      fontFamily: cssFontFamily(el.fontFamily),
      fontSize: el.fontSize * zoom,
      fontWeight: el.fontWeight,
      fontStyle: el.italic ? "italic" : "normal",
      textDecoration: `${el.underline ? "underline" : ""} ${el.strike ? "line-through" : ""}`.trim() || "none",
      lineHeight: el.lineHeight,
      letterSpacing: `${el.letterSpacing / 1000}em`,
      textAlign: el.align,
      textTransform: el.textCase === "upper" ? "uppercase" : el.textCase === "lower" ? "lowercase" : el.textCase === "title" ? "capitalize" : "none",
      color: first ?? el.color,
      caretColor: first ?? el.color,
      whiteSpace: el.autoWidth ? "pre" : "pre-wrap",
      opacity: el.opacity,
      ["--cf-list" as string]: el.list ?? "none",
    };
  }, [el, box.x, box.y, box.width, box.rotation, zoom]);

  return (
    <div
      ref={ref}
      className="cf-texteditor"
      data-cf-text-editor
      data-list={el.list ?? undefined}
      contentEditable
      suppressContentEditableWarning
      spellCheck={spellCheck}
      style={style}
      onInput={commit}
      onKeyDown={(e) => {
        // the keys stay with the text, but for Save and Print: the editor's own shortcuts (src/editor/hotkeys.ts, Editor.tsx)
        // would never see them, and the browser would take them ("Save page as", a print of the editor around the page)
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
        const key = e.key.toLowerCase();
        if (!(mod && (key === "s" || (key === "p" && !e.shiftKey)))) e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          commit();
          getActions().endTextEdit();
        } else if (e.key === "Tab") e.preventDefault();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        if (text) document.execCommand("insertText", false, text);
      }}
      onDrop={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
