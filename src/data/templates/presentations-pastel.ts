/**
 * Soft pastel education deck: warm cream, mint, lilac and peach with deep indigo text.
 * Fredoka for display, Nunito for text. A fictional primary-school science unit ("Plants & Pollinators").
 */
import type { Template } from "@/core/types";
import { C, L, R, RR, S, T, template } from "./dsl";
import { atBase, BOTTOM, frame, gfx, makeType, RIGHT, slide, SPAN, X } from "./presentations-kit";

const CREAM = "#fff6e6";
const WHITE = "#ffffff";
const INK = "#2c2a5e";
const SOFT = "#56537f";
const MINT = "#cdeedd";
const MINT_D = "#a8dcc2";
const BUTTER = "#fff0b3";
const LILAC = "#ddd3ff";
const PEACH = "#ffd9c9";
const CORAL = "#ff7a59";

const DISPLAY = "Fredoka";
const TEXT = "Nunito";

const { D, B } = makeType({
  display: DISPLAY,
  text: TEXT,
  ink: INK,
  displayWeight: 600,
  tracking: (s) => (s >= 100 ? -8 : 0),
  bodyLh: 1.45,
});

/** Rounded label pill with centred text. */
const pill = (text: string, x: number, y: number, w: number, fill: string, color = INK, h = 56) => [
  RR(x, y, w, h, h / 2, fill, { name: "Pill" }),
  T(text, x, y + (h - 26 * 1.2) / 2 + 1, w, 26, { fontFamily: TEXT, fontWeight: 800, color, align: "center", lineHeight: 1.2, name: "Pill text" }),
];

const folio = (n: number, color = SOFT) => [
  T("Bright Minds Primary  /  Grade 3 Science", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 900, 26, { fontFamily: TEXT, fontWeight: 600, color, name: "Footer" }),
  T(`${n} / 7`, RIGHT - 200, atBase(TEXT, 26, 1.2, BOTTOM), 200, 26, { fontFamily: TEXT, fontWeight: 800, color, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  CREAM,
  [
    S("blob-2", 1090, 140, 760, 760, MINT, { name: "Blob" }),
    S("blob-5", 1560, 640, 330, 330, PEACH, { name: "Blob" }),
    gfx("nature-clouds", 1100, 120, 300, { opacity: 0.95 }),
    gfx("nature-sun", 1600, 96, 210),
    gfx("nature-daisy", 1270, 250, 460),
    gfx("decor-sparkles", 1150, 620, 170),
    ...pill("Unit 4  /  Grade 3 Science", X(0), 96, 440, LILAC),
    D("Plants &\nPollinators", X(0), 270, SPAN(8), 120, { name: "Title" }),
    B("Where do apples come from? Let's follow a bee to find out.", X(0), 580, SPAN(6), SOFT, { fontSize: 32, name: "Subtitle" }),
    C(X(0) + 36, 880, 36, LILAC, { name: "Avatar" }),
    T("MA", X(0), 880 - 18, 72, 26, { fontFamily: DISPLAY, fontWeight: 600, color: INK, align: "center", lineHeight: 1.2 }),
    T("Ms. Alvarez", X(0) + 96, 852, 500, 28, { fontFamily: TEXT, fontWeight: 800, color: INK }),
    T("Room 12  /  Term 2", X(0) + 96, 890, 500, 28, { fontFamily: TEXT, color: SOFT }),
  ],
  "Greet the class and ask the hook question: where do apples come from? Take two or three guesses before you click on.",
);

/* ---------------------------------------------------------------- 2 agenda */
const steps: Array<[string, string, string, string, string, string]> = [
  ["1", "Warm-up", "Guess which of your favourite foods need bees to grow.", "10 min", MINT, "nature-sun"],
  ["2", "Learn", "Meet the parts of a flower and who comes to visit it.", "15 min", BUTTER, "education-open-book"],
  ["3", "Try it", "Plant a bean and set up your own tiny garden.", "20 min", LILAC, "education-flask"],
  ["4", "Share", "Tell a partner one thing that surprised you today.", "10 min", PEACH, "tech-chat-bubbles"],
];
const agenda = slide(
  "Agenda",
  "#f7f3ff",
  [
    ...pill("Lesson plan", X(0), 96, 240, LILAC),
    D("Today's adventure", X(0), 196, SPAN(10), 64, { name: "Title" }),
    gfx("doodles-underline-zigzag", X(0), 262, 380, { colors: { "#12b5a6": CORAL } }),
    ...steps.flatMap(([n, name, text, time, color, icon], i) => {
      const x = X(i * 3);
      const y = 370;
      return [
        RR(x, y, SPAN(3), 520, 44, color, { name: "Card" }),
        C(x + 36 + 38, y + 36 + 38, 38, WHITE, { name: "Number disc" }),
        T(n, x + 36, y + 36 + 12, 76, 40, { fontFamily: DISPLAY, fontWeight: 700, color: INK, align: "center", lineHeight: 1.2 }),
        gfx(icon, x + SPAN(3) - 36 - 120, y + 28, 120),
        D(name, x + 36, y + 190, SPAN(3) - 72, 40, { fontWeight: 600, lineHeight: 1.1 }),
        B(text, x + 36, y + 244, SPAN(3) - 72, INK),
        ...pill(time, x + 36, y + 520 - 36 - 56, 150, WHITE),
      ];
    }),
    ...folio(2),
  ],
  "Four steps, about an hour. Point at the timing pills so the class knows when each part ends.",
);

/* ---------------------------------------------------------------- 3 divider */
const tufts: Array<[number, number, number]> = [
  [150, 600, 150],
  [430, 616, 120],
  [1190, 590, 130],
  [1700, 670, 120],
];
const divider = slide(
  "Part one",
  "#d6f1e3",
  [
    gfx("nature-sun", 1480, 100, 300),
    gfx("nature-clouds", 1170, 230, 260),
    C(300, 1250, 560, MINT_D, { name: "Hill" }),
    C(1500, 1300, 640, "#98d4b8", { name: "Hill" }),
    ...tufts.map(([x, y, w]) => gfx("nature-grass", x, y, w)),
    gfx("nature-tulips", 1470, 600, 260),
    ...pill("Part 1", X(0), 96, 200, WHITE),
    D("How plants\ngrow", X(0), 230, SPAN(9), 120, { name: "Title" }),
    B("Seeds, sunlight, water and a little patience.", X(0), 500, SPAN(7), INK, { fontSize: 32, name: "Subtitle" }),
  ],
  "A short pause. Ask: what do you think a seed needs before anything else?",
);

/* ---------------------------------------------------------------- 4 fun fact (big statement) */
const funFact = slide(
  "Fun fact",
  "#e4dbfd",
  [
    S("burst", X(0), 96, 250, 250, BUTTER, { rotation: -10, params: { points: 14, inner: 0.8 }, name: "Burst" }),
    T("FUN\nFACT", X(0), 96 + 62, 250, 40, { fontFamily: DISPLAY, fontWeight: 700, color: INK, align: "center", rotation: -10, lineHeight: 1.05, name: "Burst text" }),
    D("One bee can visit up to 5,000 flowers in a single day.", X(0), 440, 1100, 80, { lineHeight: 1.08, name: "Statement" }),
    C(1500, 560, 290, WHITE, { name: "Circle" }),
    T("5,000", 1500 - 290, atBase(DISPLAY, 140, 1.0, 600), 580, 140, { fontFamily: DISPLAY, fontWeight: 700, color: INK, align: "center", lineHeight: 1.0, letterSpacing: -10, name: "Big number" }),
    T("flowers a day", 1500 - 290, 640, 580, 32, { fontFamily: TEXT, fontWeight: 800, color: SOFT, align: "center", lineHeight: 1.2 }),
    gfx("nature-daisy", 1180, 100, 150),
    gfx("decor-sparkles", 1690, 150, 130),
    ...folio(4),
  ],
  "Let the number land. Ask the class to estimate how many flowers they could visit in a day.",
);

/* ---------------------------------------------------------------- 5 timeline */
function plant(stage: number, cx: number, cy: number) {
  const els = [S("half-circle", cx - 56, cy + 36, 112, 44, "#b88a62", { name: "Soil" })];
  if (stage === 1) els.push(S("ellipse", cx - 18, cy + 26, 36, 24, "#6b4423", { name: "Seed", rotation: -15 }));
  if (stage >= 2) {
    const top = stage === 2 ? cy - 4 : stage === 3 ? cy - 34 : cy - 30;
    els.push(R(cx - 4, top, 8, cy + 40 - top, "#52b788", { name: "Stem" }));
    els.push(S("ellipse", cx - 52, top - 6, 52, 26, "#74c69d", { rotation: -28, name: "Leaf" }));
    els.push(S("ellipse", cx, top - 10, 52, 26, "#52b788", { rotation: 28, name: "Leaf" }));
    if (stage >= 3) {
      els.push(S("ellipse", cx - 50, top + 26, 50, 24, "#52b788", { rotation: -20, name: "Leaf" }));
      els.push(S("ellipse", cx, top + 22, 50, 24, "#74c69d", { rotation: 20, name: "Leaf" }));
    }
    if (stage === 4) {
      els.push(S("flower", cx - 36, top - 62, 72, 72, "#ff8fb1", { name: "Flower" }));
      els.push(C(cx, top - 26, 13, "#ffd23f", { name: "Flower centre" }));
    }
  }
  return els;
}
const stages: Array<[string, string, string, string]> = [
  ["Seed", "Day 1", "A dry bean wakes up when it gets wet.", PEACH],
  ["Sprout", "Day 7", "A tiny root grows down, a stem pushes up.", MINT],
  ["Seedling", "Day 21", "The first true leaves reach for the sunlight.", BUTTER],
  ["Flower", "Day 45", "Bees visit and the plant makes new seeds.", LILAC],
];
const timeline = slide(
  "Life cycle",
  CREAM,
  [
    ...pill("Life cycle", X(0), 96, 220, MINT),
    D("The life of a bean plant", X(0), 196, SPAN(10), 64, { name: "Title" }),
    L(X(0) + 207, 520, X(9) + 207, 520, MINT_D, 8, { stroke: { color: MINT_D, width: 8, style: "dotted", cap: "round" }, name: "Path" }),
    ...stages.flatMap(([name, day, text, color], i) => {
      const cx = X(i * 3) + 207;
      return [
        C(cx, 520, 112, color, { name: "Stage disc" }),
        ...plant(i + 1, cx, 520),
        ...pill(day, cx - 80, 668, 160, WHITE),
        D(name, cx - 190, 754, 380, 40, { align: "center", lineHeight: 1.1 }),
        B(text, cx - 190, 812, 380, SOFT, { align: "center" }),
      ];
    }),
    ...folio(5),
  ],
  "Walk along the dotted path from left to right. Ask which stage the class beans are at today.",
);

/* ---------------------------------------------------------------- 6 experiment (image + text) */
const how = ["Wet a paper towel and fold it in half.", "Slide a bean inside and seal the bag.", "Tape it to a sunny window and watch."];
const experiment = slide(
  "Experiment",
  "#fff1ea",
  [
    S("blob-1", X(0) - 24, 150, 800, 800, LILAC, { name: "Blob" }),
    frame(X(0) + 24, 120, 780, 780, { mask: "blob-3", name: "Photo frame" }),
    gfx("decor-star-sticker", X(0) + 640, 96, 130, { rotation: 12 }),
    ...pill("Try it at home", X(7), 96, 300, PEACH),
    D("Grow a bean\nin a bag", X(7), 210, SPAN(5), 64, { lineHeight: 1.05, name: "Title" }),
    ...how.flatMap((text, i) => {
      const y = 420 + i * 116;
      return [
        C(X(7) + 34, y + 34, 34, i === 0 ? MINT : i === 1 ? BUTTER : LILAC, { name: "Step disc" }),
        T(String(i + 1), X(7), y + 34 - 20, 68, 36, { fontFamily: DISPLAY, fontWeight: 700, color: INK, align: "center", lineHeight: 1.2 }),
        B(text, X(7) + 96, y + 2, SPAN(5) - 96, INK, { lineHeight: 1.4 }),
      ];
    }),
    RR(X(7), 780, SPAN(5), 130, 32, BUTTER, { name: "Tip box" }),
    T("Tip", X(7) + 36, 780 + 24, 120, 28, { fontFamily: DISPLAY, fontWeight: 700, color: INK, lineHeight: 1.2 }),
    B("Draw a line on the bag each day to track how far your bean has grown.", X(7) + 36, 780 + 58, SPAN(5) - 72, INK, { fontSize: 26, lineHeight: 1.3 }),
    ...folio(6),
  ],
  "Replace the frame with a photo of your own bean bag. Demo the first step live.",
);

/* ---------------------------------------------------------------- 7 thank you */
const homework = ["Water your bean every morning.", "Draw it on Monday and Thursday.", "Bring one flower to share.", "Ask a grown-up where honey comes from."];
const thanks = slide(
  "Homework",
  "#ffe2d4",
  [
    gfx("nature-rainbow", X(0), 100, 300),
    D("Great job,\nexplorers!", X(0), 340, SPAN(7), 120, { name: "Title" }),
    B("See you on Thursday to compare our beans.", X(0), 700, SPAN(6), INK, { fontSize: 32, name: "Subtitle" }),
    T("Ms. Alvarez  /  Room 12", X(0), 800, 700, 28, { fontFamily: TEXT, fontWeight: 800, color: INK }),
    T("alvarez@brightminds.example", X(0), 840, 700, 28, { fontFamily: TEXT, color: SOFT }),
    RR(X(7), 130, SPAN(5), 730, 48, WHITE, { name: "Homework card" }),
    ...pill("Homework", X(7) + 48, 130 + 48, 220, MINT),
    ...homework.flatMap((text, i) => {
      const y = 130 + 180 + i * 122;
      return [
        RR(X(7) + 48, y, 56, 56, 16, null, { stroke: { color: INK, width: 5, style: "solid" }, name: "Checkbox" }),
        B(text, X(7) + 48 + 90, y - 6, SPAN(5) - 48 - 90 - 48, INK, { fontSize: 32, lineHeight: 1.3 }),
      ];
    }),
    gfx("decor-star-sticker", 1690, 70, 120, { rotation: 14 }),
    ...folio(7, SOFT),
  ],
  "End on the homework. Read the three tasks aloud and send a copy home.",
);

export const PASTEL: Template = template(
  {
    slug: "pastel-classroom-science",
    category: "presentation",
    size: "presentation",
    tags: ["education", "school", "classroom", "science", "teacher", "pastel", "kids", "lesson", "plants", "cute", "friendly"],
    accent: MINT_D,
  },
  [cover, agenda, divider, funFact, timeline, experiment, thanks],
);
