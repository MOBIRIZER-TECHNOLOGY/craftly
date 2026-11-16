/**
 * Warm earthy wellness deck: sand, terracotta, sage and olive; arches and a calm serif.
 * Lora for display, Raleway for text. A fictional retreat company ("Terra & Tide Retreats").
 */
import type { Template } from "@/core/types";
import { C, O, S, T, template } from "./dsl";
import { atBase, BOTTOM, frame, gfx, hrule, makeType, num, photo, RIGHT, rich, slide, SPAN, X } from "./presentations-kit";

const SAND = "#f3e9d9";
const CREAM = "#fbf6ec";
const INK = "#2c2b21";
const SOFT = "#5d5a4c";
const TERRA = "#a24a2d";
const TERRA_T = "#8c3d22";
const TERRA_L = "#c8684b";
const CLAY = "#e0b49c";
const CLAY_L = "#efd6c6";
const SAGE = "#8c9b7a";
const SAGE_L = "#d6dcc7";
const OLIVE = "#4d5b41";
const DUNE = "#e6d6bd";

const DISPLAY = "Lora";
const TEXT = "Raleway";

const { D, LBL, B } = makeType({
  display: DISPLAY,
  text: TEXT,
  ink: INK,
  displayWeight: 400,
  tracking: (s) => (s >= 100 ? -14 : -4),
  bodyLh: 1.55,
  textWeight: 500,
  labelWeight: 700,
  labelTracking: 300,
});

const folio = (n: number, color = SOFT, accent = TERRA) => [
  T("TERRA & TIDE RETREATS", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 700, 26, { fontFamily: TEXT, fontWeight: 600, letterSpacing: 220, color, name: "Footer" }),
  T(num(n), RIGHT - 160, atBase(TEXT, 26, 1.2, BOTTOM), 160, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 120, color: accent, align: "right", name: "Page number" }),
];

/** Nested arch outlines growing outwards from an arch at (x, y, w, h). */
const halo = (x: number, y: number, w: number, h: number, colors: string[], gap = 24) =>
  colors.map((c, i) => O("arch", x - (i + 1) * gap, y - (i + 1) * gap, w + (i + 1) * gap * 2, h + (i + 1) * gap, c, 5, { name: "Halo" }));

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  SAND,
  [
    ...halo(X(8), 150, SPAN(4), 780, [TERRA_L, SAGE, CLAY]),
    photo("desert-dunes", X(8), 150, SPAN(4), 780, { mask: "arch", fx: 0.5, fy: 0.55, name: "Cover photo", alt: "Warm sand dunes" }),
    C(X(7) + 20, 860, 34, SAGE, { name: "Dot" }),
    C(RIGHT - 10, 90, 22, TERRA_L, { name: "Dot" }),
    C(116, 118, 20, TERRA, { name: "Logo" }),
    LBL("Terra & Tide  /  Autumn 2026", X(0) + 52, 96, 800, TERRA),
    D("Slow weekends", X(0), 300, SPAN(8), 120, { name: "Title" }),
    rich(D(" ", X(0), 426, SPAN(8), 120, { name: "Title" }), [[{ text: "by the sea.", italic: true, color: TERRA }]]),
    B("Two nights of yoga, long shared meals and cold-water swims on Portugal's Alentejo coast.", X(0), 690, SPAN(6) - 20, SOFT, { fontSize: 32, name: "Subtitle" }),
    T("Eight places each weekend", X(0), atBase(TEXT, 28, 1.2, BOTTOM), 700, 28, { fontFamily: TEXT, fontWeight: 600, letterSpacing: 120, textCase: "upper", color: INK, name: "Tagline" }),
  ],
  "Start slowly. Say where, how many people, and what a weekend is for. Pause before the next slide.",
);

/* ---------------------------------------------------------------- 2 agenda */
const days: Array<[string, string, string]> = [
  ["Friday", "Arrive and settle", "Unpack, swim, share supper."],
  ["Saturday", "Move, eat, rest", "Sunrise yoga, walk, sauna."],
  ["Sunday", "Walk and close", "A silent walk and brunch."],
];
const agenda = slide(
  "The weekend",
  CREAM,
  [
    gfx("decor-boho-arches", 1170, 340, 660),
    LBL("The weekend", X(0), 96, 600, TERRA),
    D("A weekend,\ngently.", X(0), 190, SPAN(7), 96, { lineHeight: 1.04, name: "Title" }),
    ...days.flatMap(([day, name, text], i) => {
      const y = 520 + i * 142;
      return [
        hrule(X(0), y, SPAN(7), CLAY, 2),
        T(String(i + 1), X(0), atBase(DISPLAY, 64, 1.0, y + 92), 100, 64, { fontFamily: DISPLAY, italic: true, color: TERRA, lineHeight: 1.0 }),
        T(day.toUpperCase(), X(0) + 110, atBase(TEXT, 26, 1.2, y + 52), 400, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 240, color: TERRA }),
        T(name, X(0) + 110, atBase(DISPLAY, 40, 1.1, y + 100), 700, 40, { fontFamily: DISPLAY, color: INK, lineHeight: 1.1 }),
        B(text, X(0) + 480, y + 38, SPAN(7) - 480, SOFT, { fontSize: 28, lineHeight: 1.4 }),
      ];
    }),
    ...folio(2),
  ],
  "Three days, three rhythms. Do not over-explain: the details come later in the deck.",
);

/* ---------------------------------------------------------------- 3 divider */
const divider = slide(
  "Part one",
  OLIVE,
  [
    S("arch", 1000, 300, 880, 780, "#586a4b", { name: "Arch" }),
    S("arch", 1120, 440, 640, 640, "#65785a", { name: "Arch" }),
    S("arch", 1240, 580, 400, 500, "#74886a", { name: "Arch" }),
    S("arch", 1340, 720, 200, 360, "#869a7a", { name: "Arch" }),
    LBL("Part one", X(0), 96, 600, CREAM),
    D("Arrive", X(0), 330, SPAN(8), 200, { italic: true, color: CREAM, name: "Title" }),
    B("Friday evening: unpack, breathe and meet the room.", X(0), 620, SPAN(6), CREAM, { fontSize: 32, name: "Subtitle" }),
    ...folio(3, CREAM, CREAM),
  ],
  "A breath. Tell the group the weekend starts with doing nothing at all.",
);

/* ---------------------------------------------------------------- 4 statement */
const statement = slide(
  "Philosophy",
  SAND,
  [
    gfx("nature-olive-branch", 1290, 150, 560, { colors: { "#8b6b4a": "#8a6a4f", "#6a994e": OLIVE, "#a7c957": SAGE, "#e76f51": TERRA_L } }),
    LBL("Our belief", X(0), 96, 600, TERRA),
    rich(D(" ", X(0), 330, SPAN(9), 96, { lineHeight: 1.1, name: "Statement" }), [["Rest is not a reward."], [{ text: "It is part of the work.", italic: true, color: TERRA }]]),
    hrule(X(0), 760, 96, TERRA, 3),
    T("Marta Oliveira", X(0), 800, SPAN(5), 28, { fontFamily: TEXT, fontWeight: 700, color: INK }),
    T("Founder, Terra & Tide", X(0), 840, SPAN(5), 28, { fontFamily: TEXT, fontWeight: 500, color: SOFT }),
    ...folio(4),
  ],
  "Say it plainly and do not rush. This is the idea the whole retreat is built on.",
);

/* ---------------------------------------------------------------- 5 offers (three cards) */
const offers: Array<[string, string, string, string, string, string]> = [
  ["Move", "Sunrise yoga and a long coastal walk, at a pace anyone can keep.", "Saturday  07:30", CLAY_L, "nature-sun", "sun"],
  ["Nourish", "Suppers cooked on open fire and shared at one long table.", "Every day  19:30", SAGE_L, "food-avocado", "avocado"],
  ["Rest", "Wood-fired sauna, a cold Atlantic swim, then a slow sound bath.", "Sunday  17:00", DUNE, "nature-moon-stars", "moon"],
];
const recolor: Record<string, Record<string, string>> = {
  sun: { "#ff9f1c": TERRA_L, "#ffc233": "#e29a76", "#ffd96b": "#f2d7b6" },
  avocado: {},
  moon: { "#7c83fd": "#fbf6ec" },
};
const cards = slide(
  "Offerings",
  CREAM,
  [
    LBL("What we offer", X(0), 96, 600, TERRA),
    D("Three simple things", X(0), 170, SPAN(10), 64, { name: "Title" }),
    ...offers.flatMap(([name, text, time, fill, icon, key], i) => {
      const x = X(i * 4);
      const y = 290;
      return [
        S("arch", x, y, SPAN(4), 640, fill, { name: "Card" }),
        gfx(icon, x + SPAN(4) / 2 - 90, y + 110, 180, { colors: recolor[key] }),
        D(name, x + 40, y + 340, SPAN(4) - 80, 48, { align: "center", lineHeight: 1.1 }),
        B(text, x + 56, y + 410, SPAN(4) - 112, INK, { align: "center", lineHeight: 1.45 }),
        T(time.toUpperCase(), x + 40, atBase(TEXT, 26, 1.2, y + 610), SPAN(4) - 80, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 160, color: TERRA_T, align: "center" }),
      ];
    }),
  ],
  "One card per pillar. Let people picture a morning, a meal and an evening.",
);

/* ---------------------------------------------------------------- 6 schedule (image + list) */
const hours: Array<[string, string]> = [
  ["07:30", "Sunrise yoga on the terrace"],
  ["09:00", "A very long breakfast"],
  ["11:00", "Coastal walk to the cove"],
  ["14:00", "Free afternoon, no plans"],
  ["17:30", "Sauna, then the sea"],
  ["19:30", "Supper by candlelight"],
];
const schedule = slide(
  "Saturday",
  SAND,
  [
    ...halo(X(0), 140, SPAN(4), 760, [TERRA_L, SAGE, CLAY]),
    frame(X(0), 140, SPAN(4), 760, { mask: "arch", name: "Photo frame" }),
    LBL("Saturday", X(5), 96, 600, TERRA),
    D("A day, hour by hour", X(5), 170, SPAN(7), 64, { name: "Title" }),
    ...hours.flatMap(([time, text], i) => {
      const y = 330 + i * 98;
      return [
        hrule(X(5), y, SPAN(7), CLAY, 2),
        T(time, X(5), atBase(TEXT, 28, 1.2, y + 62), 200, 28, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 120, color: TERRA }),
        T(text, X(5) + 220, atBase(DISPLAY, 40, 1.1, y + 64), SPAN(7) - 220, 40, { fontFamily: DISPLAY, color: INK, lineHeight: 1.1, letterSpacing: -4 }),
      ];
    }),
    hrule(X(5), 330 + hours.length * 98, SPAN(7), CLAY, 2),
    ...folio(6),
  ],
  "Replace the frame with a photo of your own terrace. Read two or three rows and skip the rest.",
);

/* ---------------------------------------------------------------- 7 closing */
const closing = slide(
  "See you by the sea",
  TERRA,
  [
    S("arch", 1130, 220, 760, 860, "#b0573a", { name: "Arch" }),
    S("arch", 1250, 360, 520, 720, "#bf6847", { name: "Arch" }),
    S("arch", 1370, 500, 280, 580, "#cc7c5a", { name: "Arch" }),
    C(1510, 330, 120, CLAY_L, { name: "Sun" }),
    gfx("decor-dried-palm", 1630, 500, 200, { colors: { "#b08968": CLAY_L }, opacity: 0.9 }),
    LBL("Book your weekend", X(0), 96, 700, CREAM),
    D("See you\nby the sea.", X(0), 260, SPAN(8), 140, { italic: true, color: CREAM, lineHeight: 1.0, name: "Title" }),
    T("17 to 19 October 2026", X(0), 650, SPAN(7), 40, { fontFamily: DISPLAY, color: CREAM, lineHeight: 1.2 }),
    T("Eight places, all meals included, from €480 each.", X(0), 710, SPAN(7), 28, { fontFamily: TEXT, fontWeight: 500, color: CREAM, lineHeight: 1.5 }),
    T("hello@terraandtide.example", X(0), 830, SPAN(5), 28, { fontFamily: TEXT, fontWeight: 700, color: CREAM }),
    T("terraandtide.example", X(4), 830, SPAN(4), 28, { fontFamily: TEXT, fontWeight: 500, color: CREAM }),
    ...folio(7, CREAM, CREAM),
  ],
  "Close with the invitation: dates, price, one email address. Then stop talking.",
);

export const WELLNESS: Template = template(
  {
    slug: "earthy-wellness-retreat",
    category: "presentation",
    size: "presentation",
    tags: ["wellness", "yoga", "retreat", "spa", "earthy", "terracotta", "sage", "calm", "boho", "natural", "mindfulness", "arches"],
    accent: TERRA_L,
  },
  [cover, agenda, divider, statement, cards, schedule, closing],
);
