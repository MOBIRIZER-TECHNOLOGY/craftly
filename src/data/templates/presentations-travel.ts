/**
 * Photo-led travel story: full-bleed photographs under dim overlays, tall condensed caps and a quiet serif.
 * Oswald for display and labels, Lora for text. A fictional trip report ("Chasing Northern Light").
 */
import type { Template } from "@/core/types";
import { C, L, R, T, template } from "./dsl";
import { atBase, BOTTOM, frame, makeType, num, photo, RIGHT, slide, SPAN, vshade, X } from "./presentations-kit";

const NIGHT = "#07111f";
const ICE = "#eaf4ff";
const MIST = "#a9bdd4";
const TEAL = "#3de0c0";
const AMBER = "#ffb45a";
const RGB = "5,12,24";

const DISPLAY = "Oswald";
const TEXT = "Lora";

const { D, LBL, B } = makeType({
  display: DISPLAY,
  text: TEXT,
  ink: ICE,
  displayWeight: 600,
  tracking: (s) => (s >= 200 ? 0 : s >= 100 ? 6 : 12),
  displayLh: 1.0,
  bodyLh: 1.55,
});

/** Condensed caps display type. */
const U = (text: string, x: number, capY: number, w: number, size = 120, o: Parameters<typeof D>[5] = {}) => D(text, x, capY, w, size, { textCase: "upper", ...o });
/** Tracked caps label in the display face (Oswald, not Lora). */
const tag = (text: string, x: number, capY: number, w: number, color = ICE, o: Parameters<typeof LBL>[5] = {}) => LBL(text, x, capY, w, color, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 240, ...o });
/** Italic serif line. */
const note = (text: string, x: number, y: number, w: number, size = 28, color = ICE, o: Parameters<typeof B>[5] = {}) => B(text, x, y, w, color, { italic: true, fontSize: size, ...o });

const folio = (n: number) => [
  T("NORTHERN LIGHT  /  ARCTIC NORWAY", X(0), atBase(DISPLAY, 26, 1.2, BOTTOM), 900, 26, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 200, color: MIST, name: "Footer" }),
  T(`${num(n)} / 07`, RIGHT - 240, atBase(DISPLAY, 26, 1.2, BOTTOM), 240, 26, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 200, color: ICE, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  NIGHT,
  [
    photo("aurora-night", 0, 0, 1920, 1080, { fx: 0.5, fy: 0.5, name: "Cover photo", alt: "Green aurora over a dark fjord" }),
    R(0, 0, 1920, 1080, vshade([[0, 0.55], [0.22, 0.08], [0.42, 0.2], [0.62, 0.62], [1, 0.9]], RGB), { name: "Shade" }),
    tag("A travel story", X(0), 96, 600),
    tag("Arctic Norway  /  7 days", RIGHT - 800, 96, 800, ICE, { align: "right" }),
    U("Chasing\nNorthern Light", X(0), 600, SPAN(12), 150, { lineHeight: 0.98, fontWeight: 700, name: "Title" }),
    note("Words and photographs by Ingrid Solvang", X(0), 912, SPAN(8), 32, ICE, { name: "Byline" }),
  ],
  "Start in the dark: let the cover sit for a beat. Say where, when and how long the trip was.",
);

/* ---------------------------------------------------------------- 2 itinerary */
const stops: Array<[string, string, string, string]> = [
  ["Day 1 - 2", "Tromsø", "Arrive, adjust and meet the dogs.", "0 km"],
  ["Day 3", "Senja", "Where the mountains drop into the sea.", "160 km"],
  ["Day 4 - 5", "Lofoten", "Red cabins, white peaks, one long road.", "640 km"],
  ["Day 6 - 7", "Bodø", "Ferry out, with the lights overhead.", "1,420 km"],
];
const itinerary = slide(
  "Itinerary",
  NIGHT,
  [
    photo("mountain-lake", X(0), 96, SPAN(4), 804, { fx: 0.5, name: "Itinerary photo", alt: "Snowy peaks reflected in a still lake" }),
    tag("The route", X(5), 96, 600, TEAL),
    U("Seven days, four stops", X(5), 170, SPAN(7), 64, { name: "Title" }),
    L(X(5) + 14, 350, X(5) + 14, 800, "#2c5c63", 3, { name: "Route" }),
    ...stops.flatMap(([days, place, text, km], i) => {
      const y = 330 + i * 150;
      return [
        C(X(5) + 14, y + 22, 14, NIGHT, { stroke: { color: TEAL, width: 4, style: "solid" }, name: "Stop" }),
        tag(days, X(5) + 60, y + 14, 300, AMBER),
        U(place, X(5) + 330, y + 4, 420, 64, { lineHeight: 1.0 }),
        note(text, X(5) + 60, y + 66, SPAN(7) - 60, 28, MIST),
        T(km.toUpperCase(), RIGHT - 300, atBase(DISPLAY, 40, 1.0, y + 50), 300, 40, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 120, color: TEAL, align: "right", lineHeight: 1.0, name: "Distance" }),
      ];
    }),
    ...folio(2),
  ],
  "Four stops in seven days. Trace the route with your finger on the map if you have one to hand.",
);

/* ---------------------------------------------------------------- 3 day divider */
const divider = slide(
  "Day three",
  NIGHT,
  [
    photo("snowy-peaks", 0, 0, 1920, 1080, { fx: 0.5, fy: 0.3, name: "Divider photo", alt: "Jagged snowy peaks in cold light" }),
    R(0, 0, 1920, 1080, vshade([[0, 0.45], [0.35, 0.1], [0.62, 0.15], [1, 0.82]], RGB), { name: "Shade" }),
    tag("Day 03  /  69° N", X(0), 96, 700),
    U("Senja", X(0), 560, SPAN(12), 300, { lineHeight: 1.0, fontWeight: 700, name: "Title" }),
    note("Where the mountains drop straight into the sea.", X(0), 880, SPAN(9), 40, ICE, { name: "Subtitle" }),
  ],
  "Day three is the pivot of the trip: the first night the sky really moved.",
);

/* ---------------------------------------------------------------- 4 quote */
const quote = slide(
  "Quote",
  NIGHT,
  [
    photo("starfield", 0, 0, 1920, 1080, { fx: 0.5, fy: 0.5, name: "Starfield", alt: "A dense field of stars" }),
    R(0, 0, 1920, 1080, vshade([[0, 0.3], [0.5, 0.45], [1, 0.8]], RGB), { name: "Shade" }),
    T("“", X(0) - 8, 90, 300, 400, { fontFamily: TEXT, fontWeight: 700, color: TEAL, lineHeight: 1.0, name: "bleed Quote mark" }),
    B("We came for the lights. We stayed for the quiet between them.", X(0), 360, SPAN(10), ICE, { italic: true, fontSize: 80, lineHeight: 1.18, name: "Quote" }),
    R(X(0), 700, 96, 4, TEAL, { name: "Rule" }),
    tag("Ingrid Solvang", X(0), 770, SPAN(6), ICE),
    T("Aurora guide, Tromsø", X(0), 810, SPAN(6), 28, { fontFamily: TEXT, italic: true, color: MIST }),
    ...folio(4),
  ],
  "Read the quote slowly, then pause. It sets up the numbers on the next slides.",
);

/* ---------------------------------------------------------------- 5 image + text */
const split = slide(
  "Lofoten",
  NIGHT,
  [
    photo("forest-mist", 0, 0, X(6) - 24, 1080, { fx: 0.5, fy: 0.45, name: "Lofoten photo", alt: "Pines rising out of morning mist" }),
    R(0, 0, X(6) - 24, 1080, vshade([[0, 0.25], [0.6, 0.0], [1, 0.45]], RGB), { name: "Shade" }),
    tag("Day 04  /  Lofoten", X(6), 96, SPAN(6), AMBER),
    U("The road\nto Å", X(6), 190, SPAN(6), 120, { lineHeight: 1.1, name: "Title" }),
    B("The E10 runs out of land at a village with a single letter for a name. We drove it twice, once in sleet and once under a sky that turned green over the harbour, and could not decide which was better.", X(6), 470, SPAN(5) + 40, ICE, { name: "Body" }),
    frame(X(6), 690, SPAN(6), 230, { name: "Photo frame" }),
    T("NORTHERN LIGHT  /  ARCTIC NORWAY", X(6), atBase(DISPLAY, 26, 1.2, BOTTOM), 700, 26, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 200, color: MIST, name: "Footer" }),
    T(`${num(5)} / 07`, RIGHT - 240, atBase(DISPLAY, 26, 1.2, BOTTOM), 240, 26, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 200, color: ICE, align: "right", name: "Page number" }),
  ],
  "Tell the one story from the road that people will repeat. Swap the frame for your own photograph.",
);

/* ---------------------------------------------------------------- 6 numbers */
const numbers: Array<[string, string]> = [
  ["1,420", "kilometres by road, from Tromsø to Bodø"],
  ["7", "days, four stops and one rented van"],
  ["3", "nights when the aurora actually showed up"],
  ["−14°", "the coldest morning, on the road to Å"],
];
const stats = slide(
  "Numbers",
  NIGHT,
  [
    photo("nebula", 0, 0, 1920, 1080, { fx: 0.5, fy: 0.5, name: "Backdrop" }),
    R(0, 0, 1920, 1080, vshade([[0, 0.7], [1, 0.82]], RGB), { name: "Shade" }),
    tag("The trip in numbers", X(0), 96, 800, TEAL),
    U("What seven days add up to", X(0), 170, SPAN(11), 64, { name: "Title" }),
    ...numbers.flatMap(([big, text], i) => {
      const x = X(i * 3);
      return [
        R(x, 420, 3, 380, "#3b5675", { name: "Divider" }),
        U(big, x + 28, 470, SPAN(3) - 28, 150, { color: TEAL, lineHeight: 1.0, fontWeight: 700, name: "Stat" }),
        note(text, x + 28, 680, SPAN(3) - 56, 28, ICE, { lineHeight: 1.45 }),
      ];
    }),
    ...folio(6),
  ],
  "Four numbers, left to right. The third one is the one everyone asks about.",
);

/* ---------------------------------------------------------------- 7 closing */
const closing = slide(
  "Plan your own",
  NIGHT,
  [
    photo("sunset-hills", 0, 0, 1920, 1080, { fx: 0.5, fy: 0.5, name: "Closing photo", alt: "Hills under a sunrise sky" }),
    R(0, 0, 1920, 1080, vshade([[0, 0.5], [0.4, 0.2], [1, 0.82]], RGB), { name: "Shade" }),
    tag("Take the road", X(0), 96, 700, AMBER),
    U("Plan your\nown north.", X(0), 330, SPAN(10), 170, { lineHeight: 0.98, fontWeight: 700, name: "Title" }),
    B("Itineraries, packing lists and the best nights for aurora, free for everyone.", X(0), 760, SPAN(8), ICE, { fontSize: 32, italic: true, name: "Subtitle" }),
    T("northernlight.example", X(0), 880, SPAN(5), 40, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 80, color: TEAL, name: "Contact" }),
    T("@ingrid.solvang", X(6), 880, SPAN(4), 40, { fontFamily: DISPLAY, fontWeight: 500, letterSpacing: 80, color: ICE, name: "Contact" }),
  ],
  "Close warm: the only sunrise in the deck. Leave the web address up.",
);

export const TRAVEL: Template = template(
  {
    slug: "travel-story-northern-light",
    name: "Travel Story Photo Deck",
    category: "presentation",
    size: "presentation",
    tags: ["travel", "photo", "story", "adventure", "norway", "aurora", "journal", "full-bleed", "cinematic", "blog", "destination"],
    accent: TEAL,
  },
  [cover, itinerary, divider, quote, split, stats, closing],
);
