/**
 * Retro 70s deck: warm paper, chocolate, tomato, orange, mustard and teal; concentric arcs and records.
 * Fraunces for display, Josefin Sans for text. A fictional lifestyle brand ("Sunset Social Club").
 */
import type { Template } from "@/core/types";
import { C, O, S, T, template, type TextOpts } from "./dsl";
import { atBase, BOTTOM, frame, gfx, hrule, makeType, num, photo, RIGHT, slide, SPAN, X } from "./presentations-kit";

const CREAM = "#f7ead0";
const BROWN = "#3a1f12";
const TOMATO = "#b82e1a";
const ORANGE = "#e8591c";
const MUSTARD = "#f0a91b";
const TEAL = "#17695f";
const PEACH = "#f4c79a";
const VINYL = "#150b06";

const DISPLAY = "Fraunces";
const TEXT = "Josefin Sans";

const { D, LBL, B } = makeType({
  display: DISPLAY,
  text: TEXT,
  ink: BROWN,
  displayWeight: 900,
  tracking: (s) => (s >= 100 ? -24 : -10),
  displayLh: 1.0,
  bodyLh: 1.5,
  textWeight: 500,
  labelWeight: 700,
  labelTracking: 240,
});

/** Italic display type. */
const DI = (text: string, x: number, capY: number, w: number, size = 120, o: TextOpts = {}) => D(text, x, capY, w, size, { italic: true, fontWeight: 800, ...o });

/** Concentric half circles sitting on `baseY`, largest first. */
const arcs = (cx: number, baseY: number, radii: number[], colors: string[]) =>
  radii.map((r, i) => S("half-circle", cx - r, baseY - r, r * 2, r, colors[i % colors.length], { name: "Arc" }));

const folio = (n: number, color = BROWN) => [
  T("SUNSET SOCIAL CLUB  /  BRAND PLAYBOOK 2026", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 1000, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 140, color, name: "Footer" }),
  T(`${num(n)} / 07`, RIGHT - 220, atBase(TEXT, 26, 1.2, BOTTOM), 220, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 140, color, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  CREAM,
  [
    ...arcs(1500, 1140, [760, 640, 520, 400, 280, 160], [TOMATO, ORANGE, MUSTARD, CREAM, TEAL, MUSTARD]),
    LBL("Est. 2019  /  Marlow Lane", X(0), 96, 800, TOMATO),
    DI("Sunset\nSocial Club", X(0), 250, SPAN(9), 150, { name: "Title" }),
    B("Brand playbook 2026. Everything we know about looking, sounding and feeling like golden hour.", X(0), 660, SPAN(5) + 60, BROWN, { fontSize: 32, name: "Subtitle" }),
    T("Tastes like golden hour", X(0), atBase(TEXT, 28, 1.2, BOTTOM), 700, 28, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 120, textCase: "upper", color: BROWN, name: "Tagline" }),
  ],
  "Open with the feeling, not the logo: golden hour. Then say what this playbook is for.",
);

/* ---------------------------------------------------------------- 2 tracklist (agenda) */
const tracks: Array<[string, string]> = [
  ["Who we are", "2:40"],
  ["How we sound", "3:15"],
  ["Colours and type", "4:05"],
  ["Where we show up", "3:30"],
  ["What's next", "2:10"],
];
const tracklist = slide(
  "Tracklist",
  BROWN,
  [
    C(1490, 540, 330, VINYL, { name: "Record" }),
    ...[300, 270, 240, 210, 180].map((r) => O("ellipse", 1490 - r, 540 - r, r * 2, r * 2, "#2b190f", 3, { name: "Groove" })),
    C(1490, 540, 120, TOMATO, { name: "Record label" }),
    T("SIDE A", 1490 - 100, 540 - 74, 200, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 200, color: CREAM, align: "center", lineHeight: 1.2 }),
    T("PLAYBOOK", 1490 - 100, 540 + 34, 200, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 120, color: CREAM, align: "center", lineHeight: 1.2 }),
    C(1490, 540, 11, BROWN, { name: "Spindle" }),
    LBL("Side A  /  The essentials", X(0), 96, 800, MUSTARD),
    DI("Tracklist", X(0), 190, SPAN(8), 120, { color: CREAM, name: "Title" }),
    ...tracks.flatMap(([name, time], i) => {
      const y = 430 + i * 98;
      return [
        hrule(X(0), y, SPAN(7), "#6b4630", 2),
        T(num(i + 1), X(0), atBase(DISPLAY, 40, 1.0, y + 64), 90, 40, { fontFamily: DISPLAY, fontWeight: 800, italic: true, color: MUSTARD, lineHeight: 1.0 }),
        T(name, X(0) + 100, atBase(DISPLAY, 40, 1.0, y + 64), SPAN(5), 40, { fontFamily: DISPLAY, fontWeight: 600, color: CREAM, lineHeight: 1.0, letterSpacing: -10 }),
        T(time, X(0) + SPAN(7) - 140, atBase(TEXT, 28, 1.2, y + 62), 140, 28, { fontFamily: TEXT, fontWeight: 600, color: PEACH, align: "right" }),
      ];
    }),
    hrule(X(0), 430 + tracks.length * 98, SPAN(7), "#6b4630", 2),
    ...folio(2, PEACH),
  ],
  "Treat it like a record sleeve: five tracks, under sixteen minutes. Keep the pace brisk.",
);

/* ---------------------------------------------------------------- 3 divider */
const divider = slide(
  "Side B",
  TEAL,
  [
    ...[430, 350, 270, 190, 110].map((r, i) => C(1470, 540, r, [MUSTARD, TOMATO, CREAM, ORANGE, BROWN][i], { name: "Target ring" })),
    LBL("Side B", X(0), 96, 700, CREAM),
    DI("The look\nand feel", X(0), 300, SPAN(8), 140, { color: CREAM, name: "Title" }),
    B("Colour, type, photography and the way we sound.", X(0), 690, SPAN(6), CREAM, { fontSize: 32, name: "Subtitle" }),
    ...folio(3, CREAM),
  ],
  "Flip the record. Everything before this was who we are, everything after is how it shows.",
);

/* ---------------------------------------------------------------- 4 statement */
const statement = slide(
  "Voice",
  CREAM,
  [
    gfx("abstract-sunburst", 1130, 100, 780, { colors: { "#ffb703": MUSTARD } }),
    C(1520, 490, 150, TOMATO, { name: "Sun" }),
    LBL("Our voice", X(0), 96, 700, TOMATO),
    DI("Warm, loud\nand a little\nlate.", X(0), 250, SPAN(8), 150, { lineHeight: 0.98, name: "Statement" }),
    B("Six words we use to check any caption, poster or email before it goes out.", X(0), 760, SPAN(6), BROWN, { fontSize: 32, name: "Caption" }),
    ...folio(4),
  ],
  "If a sentence is not warm, loud or a bit late, rewrite it.",
);

/* ---------------------------------------------------------------- 5 palette (three cards) */
const palette: Array<[string, string, string, string, string]> = [
  ["Tomato", "#B82E1A", "Appetite and action. Buttons, signs, the big number.", TOMATO, CREAM],
  ["Mustard", "#F0A91B", "Sunshine and warmth. Backgrounds and highlights.", MUSTARD, BROWN],
  ["Teal", "#17695F", "The cool shadow. Menus, small type and nights.", TEAL, CREAM],
];
const paletteSlide = slide(
  "Palette",
  CREAM,
  [
    LBL("Colour", X(0), 96, 700, TOMATO),
    DI("Three colours, no apologies.", X(0), 170, SPAN(11), 64, { fontWeight: 800 }),
    ...palette.flatMap(([name, hex, text, fill, ink], i) => {
      const x = X(i * 4);
      return [
        S("arch", x, 290, SPAN(4), 640, fill, { name: "Swatch" }),
        T(name, x + 44, atBase(DISPLAY, 64, 1.0, 700), SPAN(4) - 88, 64, { fontFamily: DISPLAY, fontWeight: 900, italic: true, color: ink, lineHeight: 1.0, letterSpacing: -10 }),
        T(hex, x + 44, atBase(TEXT, 26, 1.2, 750), SPAN(4) - 88, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 200, color: ink }),
        B(text, x + 44, 790, SPAN(4) - 88, ink, { fontSize: 28, lineHeight: 1.4 }),
      ];
    }),
  ],
  "Hold up a real swatch if you can. Say each colour's job in one line.",
);

/* ---------------------------------------------------------------- 6 photography (image + text) */
const rules = ["Shoot between five and seven p.m.", "Add ten per cent grain, never a filter.", "Faces first, product second."];
const photography = slide(
  "Photography",
  CREAM,
  [
    O("arch", X(0) - 60, 36, SPAN(5) + 120, 870, TOMATO, 6, { name: "Halo" }),
    O("arch", X(0) - 40, 56, SPAN(5) + 80, 850, ORANGE, 6, { name: "Halo" }),
    O("arch", X(0) - 20, 76, SPAN(5) + 40, 830, MUSTARD, 6, { name: "Halo" }),
    photo("sunset-hills", X(0), 96, SPAN(5), 790, { mask: "arch", fx: 0.5, name: "Arch photo", alt: "Hills at sunset" }),
    C(X(0) + SPAN(5) - 30, 790, 150, CREAM, { name: "Frame ring" }),
    frame(X(0) + SPAN(5) - 30 - 130, 790 - 130, 260, 260, { mask: "ellipse", name: "Photo frame" }),
    LBL("Photography", X(6), 96, 700, TOMATO),
    DI("Golden hour is\nour house style.", X(6), 170, SPAN(6), 64, { fontWeight: 800, lineHeight: 1.08 }),
    ...rules.flatMap((text, i) => {
      const y = 470 + i * 130;
      return [
        hrule(X(6), y, SPAN(6), BROWN, 2),
        T(num(i + 1), X(6), atBase(DISPLAY, 40, 1.0, y + 80), 90, 40, { fontFamily: DISPLAY, fontWeight: 800, italic: true, color: TOMATO, lineHeight: 1.0 }),
        B(text, X(6) + 100, y + 34, SPAN(6) - 100, BROWN, { fontSize: 32, lineHeight: 1.25 }),
      ];
    }),
    ...folio(6),
  ],
  "Show the arch photo, then swap the round frame for one of your own pictures from the last shoot.",
);

/* ---------------------------------------------------------------- 7 closing */
const closing = slide(
  "See you at sundown",
  TOMATO,
  [
    ...[640, 520, 400, 280, 160].map((r, i) => C(1920, 0, r, [ORANGE, MUSTARD, CREAM, TEAL, MUSTARD][i], { name: "Arc" })),
    LBL("Thank you", X(0), 96, 700, CREAM),
    DI("See you at\nsundown.", X(0), 330, SPAN(10), 150, { color: CREAM, lineHeight: 0.98, name: "Title" }),
    T("hello@sunsetsocial.example", X(0), 800, SPAN(6), 32, { fontFamily: TEXT, fontWeight: 700, color: CREAM }),
    T("@sunsetsocialclub", X(0), 850, SPAN(6), 32, { fontFamily: TEXT, fontWeight: 500, color: CREAM }),
    T("Rooftop, 8 Marlow Lane", X(6), 800, SPAN(6), 32, { fontFamily: TEXT, fontWeight: 700, color: CREAM }),
    T("Open Thursday to Sunday from five", X(6), 850, SPAN(6), 32, { fontFamily: TEXT, fontWeight: 500, color: CREAM }),
    ...folio(7, CREAM),
  ],
  "End on the invitation. Give out the address and the opening hours, then stay for a drink.",
);

export const RETRO: Template = template(
  {
    slug: "retro-70s-sunset-club",
    name: "Retro 70s Brand Playbook",
    category: "presentation",
    size: "presentation",
    tags: ["retro", "70s", "vintage", "groovy", "brand", "playbook", "warm", "orange", "mustard", "vinyl", "rainbow", "seventies"],
    accent: ORANGE,
  },
  [cover, tracklist, divider, statement, paletteSlide, photography, closing],
);
