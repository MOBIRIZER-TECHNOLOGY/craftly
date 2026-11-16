/**
 * Startup pitch deck: night violet + acid lime. Bricolage Grotesque for display, Inter for text.
 * A fictional logistics start-up ("Meridian") raising a Series A.
 */
import type { Template } from "@/core/types";
import { C, gradientBg, L, O, RR, T, template, type TextOpts } from "./dsl";
import { atCap, BOTTOM, frame, glow, hrule, num, RIGHT, slide, SPAN, X } from "./presentations-kit";

const BG = "#150a35";
const CARD = "#21124f";
const LINE = "#3b2a7d";
const VIOLET = "#6d3df2";
const LIME = "#c6f432";
const WHITE = "#ffffff";
const LAV = "#cdc4f5";
const MUTED = "#9d92d6";

const DISPLAY = "Bricolage Grotesque";
const TEXT = "Inter";

/** Display type: cap line at `capY`. */
const display = (text: string, x: number, capY: number, w: number, size = 120, o: TextOpts = {}) =>
  T(text, x, atCap(DISPLAY, size, 1.0, capY), w, size, { fontFamily: DISPLAY, fontWeight: 800, lineHeight: 1.0, letterSpacing: size >= 100 ? -28 : -18, color: WHITE, ...o });

/** Small tracked caps label. */
const label = (text: string, x: number, capY: number, w = 700, color = LIME, o: TextOpts = {}) =>
  T(text, x, atCap(TEXT, 26, 1.2, capY), w, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 160, textCase: "upper", color, ...o });

/** Body copy. */
const body = (text: string, x: number, y: number, w: number, color = LAV, o: TextOpts = {}) =>
  T(text, x, y, w, 28, { fontFamily: TEXT, fontWeight: 400, lineHeight: 1.5, color, ...o });

/** Title (40px) used inside cards and rows. */
const title = (text: string, x: number, y: number, w: number, color = WHITE, o: TextOpts = {}) =>
  T(text, x, y, w, 40, { fontFamily: DISPLAY, fontWeight: 700, lineHeight: 1.1, letterSpacing: -10, color, ...o });

const folio = (n: number, total: number, onLight = false) => [
  T("Meridian  /  Series A  /  March 2026", X(0), BOTTOM - 31, 900, 26, { fontFamily: TEXT, fontWeight: 500, color: onLight ? "#3c2a86" : MUTED, name: "Footer" }),
  T(`${num(n)} / ${num(total)}`, RIGHT - 300, BOTTOM - 31, 300, 26, { fontFamily: TEXT, fontWeight: 600, color: onLight ? "#3c2a86" : MUTED, align: "right", name: "Page number" }),
];

const TOTAL = 7;

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  BG,
  [
    glow(1560, 640, 700, VIOLET, 0.6),
    O("ellipse", 1620 - 560, 700 - 560, 1120, 1120, LINE, 3, { name: "Orbit ring" }),
    O("ellipse", 1620 - 490, 700 - 490, 980, 980, VIOLET, 3, { opacity: 0.6, name: "Orbit ring" }),
    C(1620, 700, 420, LIME, { name: "Lime disc" }),
    // the route drawn on the disc
    L(1400, 900, 1500, 700, BG, 10),
    L(1500, 700, 1660, 780, BG, 10),
    L(1660, 780, 1790, 590, BG, 10),
    L(1790, 590, 1650, 470, BG, 10),
    C(1400, 900, 26, BG),
    C(1400, 900, 10, LIME),
    C(1500, 700, 26, BG),
    C(1500, 700, 10, LIME),
    C(1660, 780, 26, BG),
    C(1660, 780, 10, LIME),
    C(1790, 590, 26, BG),
    C(1790, 590, 10, LIME),
    C(1650, 470, 46, BG),
    C(1650, 470, 30, LIME),
    C(1650, 470, 12, BG),
    // brand lockup
    C(110, 118, 15, LIME, { name: "Logo" }),
    C(110, 118, 6, BG, { name: "Logo" }),
    T("Meridian", 142, atCap(DISPLAY, 40, 1.1, 104), 400, 40, { fontFamily: DISPLAY, fontWeight: 800, letterSpacing: -10, lineHeight: 1.1, color: WHITE, name: "Wordmark" }),
    label("Series A  /  March 2026", X(0), 330, 800, LIME, { name: "Eyebrow" }),
    display("Every mile,\noptimised.", X(0), 392, SPAN(8), 120, { name: "Title" }),
    body("Meridian re-plans every van, stop and minute in real time, and cuts last-mile driving by 31%.", X(0), 676, SPAN(6) - 40, LAV, { fontSize: 32, name: "Subtitle" }),
    T("Maya Okafor, co-founder and CEO", X(0), BOTTOM - 33, 800, 28, { fontFamily: TEXT, fontWeight: 600, color: WHITE, name: "Presenter" }),
  ],
  "Open with the promise in one breath: every mile, optimised. Introduce yourself in a sentence, then move straight to the agenda.",
);

/* ---------------------------------------------------------------- 2 agenda */
const agendaRows: Array<[string, string, string]> = [
  ["The problem", "Last-mile delivery burns 53% of shipping cost.", "01"],
  ["Our solution", "Live routing that adapts every 30 seconds.", "02"],
  ["Traction", "$4.2M ARR across 312 fleets, still growing 3x.", "03"],
  ["The ask", "$12M to take Meridian across Europe.", "04"],
];
const agenda = slide(
  "Agenda",
  BG,
  [
    T("?", X(0), 320, 520, 600, { fontFamily: DISPLAY, fontWeight: 800, color: "#4a37a0", lineHeight: 1.0, effect: { kind: "hollow", thickness: 0 }, name: "bleed Question mark" }),
    label("Agenda", X(0), 96, 600, LIME, { name: "Eyebrow" }),
    display("Four questions,\nfour answers.", X(0), 190, SPAN(5), 64, { name: "Title" }),
    ...agendaRows.flatMap(([head, text, n], i) => {
      const y = 150 + i * 184;
      return [
        hrule(X(6), y, SPAN(6), LINE, 2),
        T(n, X(6), atCap(DISPLAY, 40, 1.1, y + 52), 120, 40, { fontFamily: DISPLAY, fontWeight: 800, color: LIME, lineHeight: 1.1 }),
        title(head, X(6) + 132, y + 36, SPAN(5), WHITE),
        body(text, X(6) + 132, y + 92, SPAN(5) - 20, LAV),
      ];
    }),
    ...folio(2, TOTAL),
  ],
  "Four questions, four answers. Keep this slide under 15 seconds: it is a promise about what the audience will get, not a table of contents.",
);

/* ---------------------------------------------------------------- 3 problem (inverted) */
const INK = BG;
const problemStats: Array<[string, string]> = [
  ["28%", "of miles driven are empty return legs"],
  ["1 in 6", "first delivery attempts fail"],
  ["9 a.m.", "is when the night-before plan breaks"],
];
const problem = slide(
  "The problem",
  LIME,
  [
    C(1840, 40, 330, "#b9e22a", { name: "Disc" }),
    label("01  /  The problem", X(0), 96, 700, INK, { name: "Eyebrow" }),
    display("The last mile\ncosts 53%.", X(0), 250, SPAN(8), 120, { color: INK, name: "Title" }),
    body("Fleets still plan routes the night before. By the time the first van leaves, traffic, failed drops and rush orders have already broken the plan.", X(0), 590, SPAN(6) - 20, "#2a1a63", { fontSize: 32, name: "Body" }),
    ...problemStats.flatMap(([big, small], i) => {
      const y = 300 + i * 190;
      return [
        hrule(X(8), y, SPAN(4), "#7ea60f", 2),
        display(big, X(8), y + 52, SPAN(4), 64, { color: INK, name: "Stat" }),
        T(small, X(8), y + 112, SPAN(4), 28, { fontFamily: TEXT, fontWeight: 500, lineHeight: 1.35, color: "#2a1a63" }),
      ];
    }),
    ...folio(3, TOTAL, true),
  ],
  "Land the number: 53% of shipping cost sits in the last mile. Then the three proof points on the right. Do not read them out; let the audience see them.",
);

/* ---------------------------------------------------------------- 4 solution (three cards) */
const cards: Array<[string, string, string, string]> = [
  ["01", "Sync everything", "Orders, vans, drivers and live traffic flow into a single model of the day ahead.", "Live data"],
  ["02", "Optimise routes", "Our solver builds the shortest feasible plan for 5,000 stops in under nine seconds.", "9 sec"],
  ["03", "Adapt all day", "A failed drop or a closed road? Every affected route re-plans within 30 seconds.", "30 sec"],
];
const solution = slide(
  "Solution",
  BG,
  [
    label("02  /  The solution", X(0), 96, 700, LIME, { name: "Eyebrow" }),
    display("Plan once. Adapt all day.", X(0), 170, SPAN(10), 64, { name: "Title" }),
    ...cards.flatMap(([n, head, text, tag], i) => {
      const x = X(i * 4);
      const y = 350;
      return [
        RR(x, y, SPAN(4), 470, 36, CARD, { name: "Card" }),
        display(n, x + 48, y + 48 + 4, 200, 64, { color: LIME }),
        RR(x + SPAN(4) - 48 - 152, y + 48, 152, 52, 26, null, { stroke: { color: LIME, width: 2, style: "solid" }, name: "Tag" }),
        T(tag, x + SPAN(4) - 48 - 152, y + 48 + 11, 152, 26, { fontFamily: TEXT, fontWeight: 600, color: LIME, align: "center", lineHeight: 1.2 }),
        hrule(x + 48, y + 160, SPAN(4) - 96, LINE, 2),
        title(head, x + 48, y + 200, SPAN(4) - 96, WHITE),
        body(text, x + 48, y + 272, SPAN(4) - 96, LAV),
      ];
    }),
    ...folio(4, TOTAL),
  ],
  "Walk the three steps left to right. One sentence each. The numbers in the tags (live, nine seconds, 30 seconds) are the proof points to remember.",
);

/* ---------------------------------------------------------------- 5 product (image + text) */
const checks = ["Drag-and-drop re-assignments", "Driver app with turn-by-turn", "ETAs customers can trust"];
const product = slide(
  "Product",
  BG,
  [
    glow(1400, 520, 520, VIOLET, 0.4),
    label("03  /  Product", X(0), 96, 700, LIME, { name: "Eyebrow" }),
    display("One dispatch\nscreen. Zero\nspreadsheets.", X(0), 170, SPAN(5), 64, { name: "Title" }),
    ...checks.flatMap((c, i) => {
      const y = 480 + i * 96;
      return [
        C(X(0) + 24, y + 24, 24, LIME, { name: "Check" }),
        L(X(0) + 13, y + 25, X(0) + 21, y + 33, BG, 4.5),
        L(X(0) + 21, y + 33, X(0) + 36, y + 16, BG, 4.5),
        T(c, X(0) + 72, y + 4, SPAN(5), 32, { fontFamily: TEXT, fontWeight: 500, color: WHITE, lineHeight: 1.3 }),
      ];
    }),
    RR(X(6), 150, SPAN(6), 732, 32, CARD, { stroke: { color: LINE, width: 2, style: "solid" }, name: "Window" }),
    C(X(6) + 44, 192, 9, "#ff6b8b"),
    C(X(6) + 76, 192, 9, "#ffd166"),
    C(X(6) + 108, 192, 9, LIME),
    frame(X(6) + 24, 232, SPAN(6) - 48, 626, { radius: 16, name: "Screenshot frame" }),
    RR(X(5), 690, SPAN(2) + 24, 150, 24, WHITE, { shadow: { color: "rgba(0,0,0,0.45)", blur: 48, x: 0, y: 24 }, name: "Stat chip" }),
    display("−31%", X(5) + 32, 730, 300, 64, { color: BG }),
    T("fewer miles driven", X(5) + 32, 790, 280, 28, { fontFamily: TEXT, fontWeight: 600, color: "#3c2a86", lineHeight: 1.2 }),
    ...folio(5, TOTAL),
  ],
  "Show, do not tell. Replace the frame with a screenshot of your dispatch board and talk through one re-assignment.",
);

/* ---------------------------------------------------------------- 6 traction (big numbers) */
const stats: Array<[string, string]> = [
  ["$4.2M", "annual recurring revenue, up from $1.4M a year ago"],
  ["312", "fleets live in the UK, Germany and France"],
  ["31%", "fewer miles per delivery, audited by customers"],
  ["142%", "net revenue retention across all cohorts"],
];
const arr = [0.9, 1.3, 1.9, 2.8, 3.5, 4.2];
const traction = slide(
  "Traction",
  BG,
  [
    label("04  /  Traction", X(0), 96, 700, LIME, { name: "Eyebrow" }),
    display("Growing 3x year on year", X(0), 170, SPAN(10), 64, { name: "Title" }),
    ...stats.flatMap(([big, small], i) => {
      const x = X((i % 2) * 3);
      const y = 330 + Math.floor(i / 2) * 300;
      return [
        hrule(x, y, SPAN(3), LINE, 2),
        display(big, x, y + 52, SPAN(3), 120, { color: LIME, name: "Stat" }),
        T(small, x, y + 52 + 81 + 34, SPAN(3) - 24, 28, { fontFamily: TEXT, fontWeight: 400, lineHeight: 1.4, color: LAV }),
      ];
    }),
    T("ARR by quarter, $M", X(7), 330, SPAN(5), 28, { fontFamily: TEXT, fontWeight: 600, color: LAV }),
    ...arr.flatMap((v, i) => {
      const x = X(7) + i * 122;
      const h = v * 100;
      const last = i === arr.length - 1;
      return [
        RR(x, 850 - h, 96, h, 18, last ? LIME : VIOLET, { name: "Bar" }),
        T(v.toFixed(1), x, 850 - h - 42, 96, 26, { fontFamily: TEXT, fontWeight: 700, color: last ? LIME : LAV, align: "center" }),
        T(`Q${(i % 4) + 1}`, x, 868, 96, 26, { fontFamily: TEXT, fontWeight: 500, color: MUTED, align: "center" }),
      ];
    }),
    ...folio(6, TOTAL),
  ],
  "Four numbers, one chart. Say: we tripled ARR while customers drove 31% fewer miles. Pause on net revenue retention, it is the one investors probe.",
);

/* ---------------------------------------------------------------- 7 ask */
const fund: Array<[string, string, number, string]> = [
  ["45%", "Engineering", 0.45, LIME],
  ["35%", "Go-to-market", 0.35, WHITE],
  ["20%", "Operations", 0.2, "#8b6bff"],
];
const ask = slide(
  "The ask",
  gradientBg(160, "#3f1fb3", "#1b0c4a"),
  [
    C(1780, 130, 280, LIME, { name: "Lime disc" }),
    O("ellipse", 1780 - 380, 130 - 380, 760, 760, "#8b6bff", 3, { name: "Ring" }),
    label("05  /  The ask", X(0), 96, 700, LIME, { name: "Eyebrow" }),
    display("We're raising\n$12M Series A.", X(0), 220, SPAN(10), 120, { name: "Title" }),
    body("To put Meridian in every European fleet by 2027 and ship the driver wellbeing suite.", X(0), 510, SPAN(6), "#e1dbff", { fontSize: 32, name: "Body" }),
    T("Use of funds", X(0), 656, 600, 28, { fontFamily: TEXT, fontWeight: 600, color: "#e1dbff" }),
    ...(() => {
      const total = SPAN(12) - 16;
      let x = X(0);
      return fund.flatMap(([pct, name, share, color]) => {
        const w = Math.round(total * share);
        const els = [
          RR(x, 712, w, 28, 14, color, { name: "Segment" }),
          display(pct, x, 790, w, 64, { color: WHITE }),
          T(name, x, 850, w, 28, { fontFamily: TEXT, fontWeight: 500, color: "#e1dbff" }),
        ];
        x += w + 8;
        return els;
      });
    })(),
    T("maya@meridian.example", X(0), BOTTOM - 33, 700, 28, { fontFamily: TEXT, fontWeight: 600, color: WHITE, name: "Contact" }),
    T("meridian.example/investors", X(6), BOTTOM - 33, 700, 28, { fontFamily: TEXT, fontWeight: 600, color: LIME, name: "Contact" }),
    T(`${num(7)} / ${num(TOTAL)}`, RIGHT - 300, BOTTOM - 31, 300, 26, { fontFamily: TEXT, fontWeight: 600, color: "#cdc4f5", align: "right", name: "Page number" }),
  ],
  "Close on the number and what it buys. Leave this slide up during Q and A. Replace the contact details with your own.",
);

export const PITCH: Template = template(
  {
    slug: "startup-pitch-violet",
    category: "presentation",
    size: "presentation",
    tags: ["pitch", "startup", "investor", "series a", "funding", "venture", "saas", "violet", "lime", "dark", "bold", "traction"],
    accent: LIME,
  },
  [cover, agenda, problem, solution, product, traction, ask],
);
