/**
 * "Download as a web page": one .html file that shows the pages of a design as a slideshow in any browser, for
 * people who do not have Craftly. This module is the pure part: from a title and the pages as pictures (data URLs)
 * to the text of the file. Painting the pages is in webPageExport.ts.
 *
 * The pages are pictures, not inline SVG. The SVG writer mirrors the canvas painter rather than being it, several
 * SVGs in one document would share one id space for their gradients and clip paths, and embedded fonts would need a
 * `font-src` in the policy; a picture from the editor's own painter looks like the editor, whatever the browser.
 *
 * The file is inert. Everything that comes from the design (title, page names, alt texts, notes) is escaped and
 * only ever stands where text stands. A Content-Security-Policy inside the file allows pictures from data URLs,
 * inline style and one script, named by its SHA-256 hash, and nothing else: no network, no fonts, no frames. The
 * script is the same in every file (it reads the pages from the document), which is what lets the hash be a
 * constant; a test recomputes it.
 */
import type { DesignElement, Page } from "@/core/types";
import { ExportError } from "./errors";

export interface WebPageSlide {
  /** the page as a picture: a PNG or JPEG data URL in base64, nothing else is accepted */
  src: string;
  /** what the page shows, for someone who cannot see it */
  alt?: string;
  /** the name of the page, if it has one */
  name?: string;
  /** presenter notes; written into the file only when `notes` is asked for */
  notes?: string;
}

export interface WebPageInput {
  title: string;
  /** design pixels: the proportions of every page */
  width: number;
  height: number;
  slides: WebPageSlide[];
  /** language of the file (a BCP 47 tag such as "en" or "pt-BR"); anything else becomes "en" */
  lang?: string;
  /** include the presenter notes (default false: they are private) */
  notes?: boolean;
}

/** The most one web page may weigh: more than this is slow to open and too much for most mail. */
export const MAX_WEB_PAGE_BYTES = 40 * 1024 * 1024;

// eslint-disable-next-line no-control-regex -- control characters are not text: they are dropped (tab and line ends stay)
const NOT_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe for element content and for a quoted attribute alike. */
export function escapeHtml(text: string): string {
  return text.replace(NOT_TEXT, "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** The alt texts of what is on a page, back to front and into groups, as one sentence-like string ("" when there are none). */
export function pageAltText(page: Pick<Page, "elements">): string {
  const texts: string[] = [];
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    const alt = el.alt?.trim();
    if (alt) texts.push(alt);
    if (el.type === "group") el.children.forEach(visit);
  };
  page.elements.forEach(visit);
  return texts.join("; ");
}

const STYLE = `*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:#111418;color:#f2f4f7;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
[hidden]{display:none!important}
main{flex:1;min-height:0}
#stage{position:relative;height:100%}
.slide{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
.slide img{display:block;max-width:100%;height:auto}
.notes{width:100%;max-width:60em;padding:8px 14px;border-radius:8px;background:#1b1f26;overflow:auto}
.notes h2{margin:0 0 4px;font-size:13px;font-weight:600;color:#aab2bf}
.notes p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
nav{display:none;flex:none;align-items:center;justify-content:center;gap:8px;padding:8px 12px;background:#1b1f26}
button{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
button:hover{background:#2a303a}
button[aria-disabled="true"]{opacity:.35;cursor:default}
button[aria-disabled="true"]:hover{background:transparent}
:focus-visible{outline:3px solid #7cb7ff;outline-offset:2px}
svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#count{min-width:8em;text-align:center;font-variant-numeric:tabular-nums}
.js nav{display:flex}
.js .slide{position:absolute;top:0;right:0;bottom:0;left:0;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility 0s linear .3s}
.js .slide.is-on{opacity:1;visibility:visible;transition:opacity .3s ease}
.js .slide img{width:auto;min-height:0;max-height:100%;object-fit:contain;cursor:pointer}
.js .has-notes img{max-height:70%}
.js .notes{flex:none;max-height:calc(30% - 12px)}
@media (prefers-reduced-motion: reduce){.js .slide,.js .slide.is-on{transition: none}}
@media print{body{display:block;background:#fff;color:#000}nav,.js nav{display:none}.js .slide{position:static;opacity:1;visibility:visible;page-break-after:always}.notes{background:none}}`;

/**
 * The whole behaviour of the file: which page is shown, the buttons, the keys, a click, a swipe, the full screen.
 * Plain old JavaScript in plain characters, and no word of the design in it: it must be byte for byte the same in
 * every file, because the policy names its hash. Without it (a reader that runs no script) the pages simply stand
 * one under the other.
 */
export const WEB_PAGE_SCRIPT = `(function () {
  "use strict";
  var doc = document;
  var root = doc.documentElement;
  var slides = Array.prototype.slice.call(doc.querySelectorAll(".slide"));
  var stage = doc.getElementById("stage");
  var count = doc.getElementById("count");
  var prev = doc.getElementById("prev");
  var next = doc.getElementById("next");
  var full = doc.getElementById("full");
  var last = slides.length - 1;
  var at = 0;
  var startX = null;
  var startY = 0;

  function show(index) {
    at = Math.max(0, Math.min(last, index));
    slides.forEach(function (slide, i) {
      slide.classList.toggle("is-on", i === at);
      slide.setAttribute("aria-hidden", i === at ? "false" : "true");
    });
    count.textContent = "Page " + (at + 1) + " of " + slides.length;
    prev.setAttribute("aria-disabled", at === 0 ? "true" : "false");
    next.setAttribute("aria-disabled", at === last ? "true" : "false");
  }

  function isFull() {
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  }

  function toggleFull() {
    var enter = root.requestFullscreen || root.webkitRequestFullscreen;
    var leave = doc.exitFullscreen || doc.webkitExitFullscreen;
    var done = isFull() ? leave && leave.call(doc) : enter.call(root);
    if (done && done.catch) done.catch(function () {});
  }

  function fullChanged() {
    full.setAttribute("aria-label", isFull() ? "Leave full screen" : "Full screen");
  }

  root.classList.add("js");
  show(0);

  prev.addEventListener("click", function () {
    show(at - 1);
  });
  next.addEventListener("click", function () {
    show(at + 1);
  });
  stage.addEventListener("click", function (event) {
    if (event.target && event.target.nodeName === "IMG") show(at + 1);
  });

  stage.addEventListener(
    "touchstart",
    function (event) {
      startX = event.changedTouches[0].clientX;
      startY = event.changedTouches[0].clientY;
    },
    { passive: true }
  );
  stage.addEventListener(
    "touchend",
    function (event) {
      if (startX === null) return;
      var dx = event.changedTouches[0].clientX - startX;
      var dy = event.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(at + (dx < 0 ? 1 : -1));
    },
    { passive: true }
  );

  doc.addEventListener("keydown", function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var key = event.key;
    var onButton = event.target && event.target.nodeName === "BUTTON";
    if (onButton && (key === " " || key === "Enter")) return;
    var to = null;
    if (key === "ArrowRight" || key === "PageDown" || key === " ") to = at + 1;
    else if (key === "ArrowLeft" || key === "PageUp") to = at - 1;
    else if (key === "Home") to = 0;
    else if (key === "End") to = last;
    if (to !== null) {
      event.preventDefault();
      show(to);
    } else if ((key === "f" || key === "F") && !full.hidden) {
      toggleFull();
    }
  });

  if (root.requestFullscreen || root.webkitRequestFullscreen) {
    full.addEventListener("click", toggleFull);
    doc.addEventListener("fullscreenchange", fullChanged);
    doc.addEventListener("webkitfullscreenchange", fullChanged);
  } else {
    full.hidden = true;
  }
})();`;

/** `'sha256-...'` of WEB_PAGE_SCRIPT, as the policy names it. Change the script and the test tells the new value. */
export const WEB_PAGE_SCRIPT_HASH = "sha256-ULwZXG4Hm1xADWbukGQA7oz+PBIrOjiQGS3h8km23RI=";

const DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

/** The error for a file beyond MAX_WEB_PAGE_BYTES (also thrown by the exporter, as soon as the pictures alone are too many). */
export const webPageTooLarge = () => new ExportError("too-large", `These pages make a web page of more than ${MAX_WEB_PAGE_BYTES / (1024 * 1024)} MB. Choose fewer pages.`);

/**
 * The text of the .html file. Throws an `ExportError`: "no-pages" without a page, "invalid-design" for a picture that
 * is not a PNG or JPEG data URL, "too-large" beyond MAX_WEB_PAGE_BYTES.
 */
export function buildWebPage(input: WebPageInput): string {
  const { slides } = input;
  if (!slides.length) throw new ExportError("no-pages", "Select at least one page to download.");
  // weighed before anything is put together: the pictures are all but the whole file
  if (slides.reduce((sum, s) => sum + s.src.length, 0) > MAX_WEB_PAGE_BYTES) throw webPageTooLarge();
  for (const slide of slides) {
    if (!DATA_URL.test(slide.src)) throw new ExportError("invalid-design", "A page could not be turned into a picture for the web page.");
  }

  const title = escapeHtml(input.title.trim() || "Untitled design");
  const lang = input.lang && LANGUAGE_TAG.test(input.lang) ? input.lang : "en";
  const size = (n: number) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  const width = size(input.width);
  const height = size(input.height);

  const sections = slides.map((slide, i) => {
    const name = slide.name?.trim();
    const named = name ? `: ${name}` : "";
    const alt = slide.alt?.trim() || `Page ${i + 1}${named}`;
    const notes = input.notes ? slide.notes?.trim() : "";
    return [
      `<section class="slide${notes ? " has-notes" : ""}" aria-roledescription="slide" aria-label="${escapeHtml(`Page ${i + 1} of ${slides.length}${named}`)}">`,
      `<img src="${slide.src}" alt="${escapeHtml(alt)}" width="${width}" height="${height}">`,
      ...(notes ? [`<div class="notes"><h2>Notes</h2><p>${escapeHtml(notes)}</p></div>`] : []),
      `</section>`,
    ].join("\n");
  });

  const html = [
    `<!doctype html>`,
    `<html lang="${lang}">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src '${WEB_PAGE_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="referrer" content="no-referrer">`,
    `<meta name="generator" content="Craftly">`,
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    `</head>`,
    `<body>`,
    `<main aria-roledescription="carousel" aria-label="${title}">`,
    `<div id="stage">`,
    ...sections,
    `</div>`,
    `</main>`,
    `<nav aria-label="Pages">`,
    `<button type="button" id="prev" aria-label="Previous page">${icon("M15 5l-7 7 7 7")}</button>`,
    `<span id="count" aria-live="polite">Page 1 of ${slides.length}</span>`,
    `<button type="button" id="next" aria-label="Next page">${icon("M9 5l7 7-7 7")}</button>`,
    `<button type="button" id="full" aria-label="Full screen">${icon("M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5")}</button>`,
    `</nav>`,
    `<script>${WEB_PAGE_SCRIPT}</script>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
  // (long notes could still take it over the line)
  if (html.length > MAX_WEB_PAGE_BYTES) throw webPageTooLarge();
  return html;
}
