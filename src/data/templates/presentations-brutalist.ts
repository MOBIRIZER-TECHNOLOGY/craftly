/**
 * Neo-brutalist deck: flat saturated colour, 6px black outlines, hard offset shadows, mono type.
 * Archivo Black for display, Space Mono for text. A fictional no-code tool ("Brickbox") and its Q3 roadmap.
 */
import type { Template } from "@/core/types";
import { C, O, patternBg, R, S, T, template, type ShapeOpts, type TextOpts } from "./dsl";
import { atBase, BOTTOM, frame, makeType, num, RIGHT, rich, slide, SPAN, X } from "./presentations-kit";

const CREAM = "#fff4d6";
const BLACK = "#0d0d0d";
const WHITE = "#ffffff";
const YELLOW = "#ffd93d";
const PINK = "#ff8ad0";
const BLUE = "#62a0ff";
const GREEN = "#43e0a0";
const ORANGE = "#ff8a3d";

const DISPLAY = "Archivo Black";
const MONO = "Space Mono";

const { D, LBL, B } = makeType({
  display: DISPLAY,
  text: MONO,
  ink: BLACK,
  displayWeight: 400,
  tracking: (s) => (s >= 100 ? -8 : -4),
  bodyLh: 1.45,
  labelWeight: 700,
  labelTracking: 80,
});

const line = (w = 6) => ({ color: BLACK, width: w, style: "solid" as const });
const hard = (d = 14) => ({ color: BLACK, blur: 0, x: d, y: d });
/** A flat box with the thick outline and hard shadow. */
const box = (x: number, y: number, w: number, h: number, fill: string, o: ShapeOpts = {}) => R(x, y, w, h, fill, { stroke: line(), shadow: hard(), ...o });
/** Upper-case display type. */
const U = (text: string, x: number, capY: number, w: number, size = 120, o: TextOpts = {}) => D(text, x, capY, w, size, { textCase: "upper", ...o });
/** Mono text. */
const M = (text: string, x: number, y: number, w: number, size = 28, o: TextOpts = {}) => B(text, x, y, w, BLACK, { fontSize: size, ...o });
/** Mono bold label (not tracked-caps). */
const MB = (text: string, x: number, y: number, w: number, size = 28, o: TextOpts = {}) => B(text, x, y, w, BLACK, { fontSize: size, fontWeight: 700, ...o });

const folio = (n: number, total = 7, color = BLACK) => [
  T("BRICKBOX / Q3 ROADMAP", X(0), atBase(MONO, 26, 1.2, BOTTOM), 800, 26, { fontFamily: MONO, fontWeight: 700, letterSpacing: 40, color, name: "Footer" }),
  T(`${num(n)}/${num(total)}`, RIGHT - 240, atBase(MONO, 26, 1.2, BOTTOM), 240, 26, { fontFamily: MONO, fontWeight: 700, color, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  patternBg("grid", "#ecdfb8", CREAM, 1.5),
  [
    box(X(0), 96, 440, 72, WHITE, { shadow: hard(8), name: "Tag" }),
    T("BRICKBOX / ROADMAP", X(0), 96 + 21, 440, 26, { fontFamily: MONO, fontWeight: 700, letterSpacing: 40, align: "center", color: BLACK }),
    U("Hard", X(0), 300, SPAN(8), 230, { lineHeight: 0.95, name: "Title" }),
    box(X(0) - 8, 560, 1130, 236, YELLOW, { name: "Highlight" }),
    U("Launch", X(0) + 16, 600, SPAN(9), 230, { lineHeight: 0.95, name: "Title" }),
    M("Our Q3 2026 product roadmap. Five big things, shipped loudly, on dates we can all see.", X(0), 868, SPAN(7), 28, { name: "Subtitle" }),
    // stickers
    S("burst", 1292, 120, 560, 560, PINK, { stroke: line(), shadow: hard(), rotation: 9, params: { points: 14, inner: 0.8 }, name: "Burst sticker" }),
    rich(T(" ", 1292 + 40, 120 + 120, 480, 300, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: 9, lineHeight: 1.0, name: "Burst text" }), [
      [{ text: "Q3", size: 190, font: DISPLAY }],
      [{ text: "2026", size: 70, font: DISPLAY }],
    ]),
    box(1340, 760, 440, 120, BLUE, { rotation: -7, name: "Ship tag" }),
    T("SHIP IT LOUD", 1340, 760 + 34, 440, 40, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: -7, letterSpacing: -4, name: "Ship tag text" }),
    C(1760, 930, 56, GREEN, { stroke: line(), shadow: hard(10), name: "Dot" }),
  ],
  "Open loud. Say the quarter, say the promise: five things, real dates. Then go straight to the agenda.",
);

/* ---------------------------------------------------------------- 2 agenda */
const plan: Array<[string, string, string, string]> = [
  ["01", "Where we are", "5 min", YELLOW],
  ["02", "The big three", "15 min", PINK],
  ["03", "Dates that matter", "5 min", BLUE],
  ["04", "Who owns what", "3 min", GREEN],
  ["05", "Your questions", "2 min", ORANGE],
];
const agenda = slide(
  "Agenda",
  CREAM,
  [
    U("Today's\nplan", X(0), 140, SPAN(5), 120, { name: "Title" }),
    box(X(0), 480, 268, 80, WHITE, { rotation: -5, shadow: hard(8), name: "Sticker" }),
    T("30 MIN", X(0), 480 + 17, 268, 40, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: -5, name: "Sticker text" }),
    ...plan.flatMap(([n, name, time, color], i) => {
      const y = 130 + i * 150;
      return [
        box(X(6), y, SPAN(6), 112, color, { name: "Row" }),
        R(X(6), y, 112, 112, BLACK, { name: "Number block" }),
        T(n, X(6), y + 22, 112, 56, { fontFamily: DISPLAY, color: YELLOW, align: "center", lineHeight: 1.1, name: "Number" }),
        MB(name.toUpperCase(), X(6) + 144, y + 36, 440, 32, { lineHeight: 1.2 }),
        MB(time.toUpperCase(), X(6) + SPAN(6) - 40 - 160, y + 40, 160, 28, { align: "right", lineHeight: 1.2 }),
      ];
    }),
    ...folio(2),
  ],
  "Thirty minutes. The big three get half the time, so protect it.",
);

/* ---------------------------------------------------------------- 3 divider */
const TAPE = "* THREE BETS * ONE QUARTER * NO EXCUSES * ".repeat(3).slice(0, 112);
const divider = slide(
  "Part two",
  PINK,
  [
    T("02", X(0) - 10, atBase(DISPLAY, 620, 0.9, 700), SPAN(9), 620, { fontFamily: DISPLAY, color: BLACK, lineHeight: 0.9, letterSpacing: -30, name: "bleed Numeral" }),
    box(1264, 150, 560, 150, WHITE, { rotation: 5, name: "Sticker" }),
    T("PART TWO", 1264, 150 + 28, 560, 40, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: 5, name: "Sticker text" }),
    T("THE BIG THREE", 1264, 150 + 82, 560, 28, { fontFamily: MONO, fontWeight: 700, color: BLACK, align: "center", rotation: 5, name: "Sticker text" }),
    U("The big three", X(0), 744, SPAN(12), 120, { name: "Title" }),
    R(-100, 900, 2120, 120, BLACK, { rotation: -2, name: "Tape" }),
    T(TAPE, -340, 934, 2800, 40, { fontFamily: MONO, fontWeight: 700, color: YELLOW, rotation: -2, lineHeight: 1.2, name: "bleed Tape text" }),
  ],
  "Section break. The next three slides are the heart of the quarter.",
);

/* ---------------------------------------------------------------- 4 three cards */
const bets: Array<[string, string, string, string, string, string, number]> = [
  ["01", "Marketplace", "Sell templates made by the community. We keep 30%, makers keep 70%.", "AUG 12", YELLOW, "DANA K.", 2],
  ["02", "Team mode", "Live cursors, comments and roles. Built for teams of up to 20 people.", "SEP 02", PINK, "OMAR S.", 1],
  ["03", "Ship button", "One click to publish to your own domain. No DNS dance.", "SEP 30", BLUE, "LEILA N.", 0],
];
const cards = slide(
  "Three bets",
  CREAM,
  [
    U("Three bets", X(0), 130, SPAN(10), 120, { name: "Title" }),
    ...bets.flatMap(([n, name, text, date, color, owner, done], i) => {
      const x = X(i * 4);
      const y = 320;
      return [
        box(x, y, SPAN(4), 570, WHITE, { name: "Card" }),
        R(x, y, SPAN(4), 160, color, { stroke: line(), name: "Card header" }),
        U(n, x + 36, y + 44, 200, 96, { lineHeight: 1.0 }),
        box(x + SPAN(4) - 36 - 190, y + 48, 190, 60, WHITE, { shadow: hard(6), stroke: line(5), name: "Date tag" }),
        T(date, x + SPAN(4) - 36 - 190, y + 48 + 15, 190, 28, { fontFamily: MONO, fontWeight: 700, color: BLACK, align: "center" }),
        U(name, x + 36, y + 206, SPAN(4) - 72, 40, { lineHeight: 1.1 }),
        M(text, x + 36, y + 276, SPAN(4) - 72, 28, { lineHeight: 1.45 }),
        ...[0, 1, 2].map((k) => R(x + 36 + k * 64, y + 424, 48, 48, k < done ? BLACK : WHITE, { stroke: line(5), name: "Progress" })),
        T(`${done} OF 3 DONE`, x + 36 + 3 * 64 + 8, y + 436, SPAN(4) - 72 - 200, 26, { fontFamily: MONO, fontWeight: 700, color: BLACK }),
        R(x + 36, y + 500, SPAN(4) - 72, 4, BLACK, { name: "Rule" }),
        T(`OWNER  ${owner}`, x + 36, y + 522, SPAN(4) - 72, 26, { fontFamily: MONO, fontWeight: 700, color: BLACK }),
      ];
    }),
    ...folio(4),
  ],
  "One card per bet: what it is, when it lands, who owns it. Do not read the cards aloud.",
);

/* ---------------------------------------------------------------- 5 image + text */
const demo = slide(
  "Demo",
  CREAM,
  [
    R(X(0) + 20, 140 + 20, SPAN(6), 740, BLACK, { name: "Frame shadow" }),
    frame(X(0), 140, SPAN(6), 740, { name: "Screenshot frame" }),
    O("rect", X(0), 140, SPAN(6), 740, BLACK, 6, { name: "Frame outline" }),
    box(X(0) - 36, 100, 300, 84, YELLOW, { rotation: -7, shadow: hard(8), name: "bleed Sticker" }),
    T("LIVE DEMO", X(0) - 36, 100 + 20, 300, 40, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: -7, name: "bleed Sticker text" }),
    LBL("Team mode / Sep 02", X(6), 140, 700, BLACK),
    U("See it\nrun live.", X(6), 214, SPAN(6), 120, { name: "Title" }),
    M("Ten minutes, no slides: we build a small shop from scratch and invite the whole room into the file.", X(6), 524, SPAN(5) + 60, 28, { name: "Body" }),
    box(X(6), 720, 420, 100, BLACK, { shadow: { color: YELLOW, blur: 0, x: 12, y: 12 }, stroke: line(6), name: "Button" }),
    T("BOOK A SEAT >", X(6), 720 + 33, 420, 32, { fontFamily: MONO, fontWeight: 700, color: YELLOW, align: "center", letterSpacing: 40 }),
    ...folio(5),
  ],
  "Replace the frame with a screenshot or a photo from the last demo day.",
);

/* ---------------------------------------------------------------- 6 stats */
const numbers: Array<[string, string, string]> = [
  ["12K", "shops live on Brickbox today", YELLOW],
  ["38", "minutes median time to a first sale", PINK],
  ["94%", "of makers would recommend us", BLUE],
  ["$3M", "processed through checkout in July", GREEN],
];
const stats = slide(
  "Numbers",
  CREAM,
  [
    U("July, in numbers", X(0), 130, SPAN(12), 120, { name: "Title" }),
    ...numbers.flatMap(([big, text, color], i) => {
      const x = X(i * 3);
      const y = 340;
      return [
        box(x, y, SPAN(3), 480, color, { name: "Stat block" }),
        U(big, x + 32, y + 56, SPAN(3) - 48, 150, { lineHeight: 1.0 }),
        R(x + 32, y + 270, SPAN(3) - 64, 6, BLACK, { name: "Rule" }),
        MB(text, x + 32, y + 306, SPAN(3) - 64, 28, { lineHeight: 1.4 }),
      ];
    }),
    ...folio(6),
  ],
  "Four numbers, one breath each. If you only keep one: 38 minutes to a first sale.",
);

/* ---------------------------------------------------------------- 7 thanks */
const contacts: Array<[string, string]> = [
  ["dana@brickbox.example", WHITE],
  ["brickbox.example/roadmap", PINK],
  ["#roadmap-q3 on Slack", BLUE],
];
const thanks = slide(
  "Thanks",
  YELLOW,
  [
    box(X(0), 96, 440, 72, WHITE, { shadow: hard(8), name: "Tag" }),
    T("THAT'S A WRAP", X(0), 96 + 21, 440, 26, { fontFamily: MONO, fontWeight: 700, letterSpacing: 40, align: "center", color: BLACK }),
    U("Thanks!", X(0), 340, SPAN(9), 240, { lineHeight: 1.0, name: "Title" }),
    S("burst", 1380, 160, 440, 440, WHITE, { stroke: line(), shadow: hard(), rotation: -10, params: { points: 12, inner: 0.82 }, name: "Burst sticker" }),
    T("QUESTIONS?", 1380 + 30, 160 + 190, 380, 40, { fontFamily: DISPLAY, color: BLACK, align: "center", rotation: -10, name: "Burst text" }),
    ...contacts.flatMap(([text, color], i) => {
      const x = X(i * 4);
      return [
        box(x, 640, SPAN(4), 120, color, { name: "Contact box" }),
        MB(text, x + 24, 640 + 40, SPAN(4) - 48, 28, { align: "center", lineHeight: 1.2 }),
      ];
    }),
    ...folio(7),
  ],
  "Leave this up for questions. Replace the contact boxes with your own channels.",
);

export const BRUTALIST: Template = template(
  {
    slug: "neo-brutalist-roadmap",
    category: "presentation",
    size: "presentation",
    tags: ["brutalist", "neo-brutalism", "roadmap", "bold", "mono", "stickers", "colourful", "startup", "product", "quarterly", "playful"],
    accent: YELLOW,
  },
  [cover, agenda, divider, cards, demo, stats, thanks],
);
