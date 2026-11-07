/**
 * Editorial magazine deck: cream paper, black, vermilion. Playfair Display for display, Work Sans for text.
 * A fictional quarterly ("Oblique", Issue 12: The Craft Issue).
 */
import type { Template } from "@/core/types";
import { R, RR, T, template } from "./dsl";
import { atBase, atCap, BOTTOM, frame, hrule, makeType, num, photo, RIGHT, slide, SPAN, X } from "./presentations-kit";

const PAPER = "#f4eee1";
const INK = "#121212";
const RED = "#c9261a";
const GREY = "#575246";
const FAINT = "#cfc6b0";

const SERIF = "Playfair Display";
const SANS = "Work Sans";

const { D, LBL, B } = makeType({
  display: SERIF,
  text: SANS,
  ink: INK,
  displayWeight: 900,
  tracking: (s) => (s >= 200 ? -30 : s >= 100 ? -15 : -5),
  bodyLh: 1.55,
  labelWeight: 600,
  labelTracking: 220,
});

const shade = (stops: Array<[number, number]>) => ({
  type: "linear" as const,
  angle: 180,
  stops: stops.map(([offset, a]) => ({ offset, color: `rgba(18,8,4,${a})` })),
});

/** Running foot: wordmark and issue on the left, page number on the right. */
const folio = (n: number, onDark = false) => [
  T("OBLIQUE", X(0), atBase(SERIF, 26, 1.2, BOTTOM), 220, 26, { fontFamily: SERIF, fontWeight: 900, letterSpacing: 120, color: onDark ? PAPER : INK, name: "Footer" }),
  T("Issue 12  /  The Craft Issue", X(0) + 190, atBase(SANS, 26, 1.2, BOTTOM), 700, 26, { fontFamily: SANS, fontWeight: 500, color: onDark ? PAPER : GREY, name: "Footer" }),
  T(num(n), RIGHT - 200, atBase(SERIF, 28, 1.2, BOTTOM), 200, 28, { fontFamily: SERIF, fontWeight: 700, italic: true, color: onDark ? PAPER : RED, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const coverLines: Array<[string, string]> = [
  ["18", "The last chairmaker"],
  ["34", "Houses that grow back"],
  ["52", "The slow kitchen"],
];
const cover = slide(
  "Cover",
  INK,
  [
    photo("canyon-glow", 0, 0, 1920, 1080, { fy: 0.4, name: "Cover photo", alt: "Glowing red canyon at dusk" }),
    R(0, 0, 1920, 1080, shade([[0, 0.66], [0.36, 0.5], [0.54, 0.14], [0.7, 0.64], [1, 0.92]]), { name: "Shade" }),
    LBL("Issue 12", X(0), 96, 500, PAPER),
    LBL("Autumn 2026", X(4), 96, SPAN(4), PAPER, { align: "center" }),
    LBL("The Craft Issue", RIGHT - 600, 96, 600, PAPER, { align: "right" }),
    D("OBLIQUE", X(0), 150, SPAN(12), 381, { color: PAPER, align: "center", name: "Masthead" }),
    D("Made by hand,\nfinished by time.", X(0), 640, SPAN(8), 96, { color: PAPER, italic: true, fontWeight: 700, name: "Cover line" }),
    B("Inside the last chair workshop in Alfama, where nothing is sanded twice.", X(0), 846, SPAN(6) - 40, PAPER, { name: "Cover line text" }),
    ...coverLines.flatMap(([page, text], i) => {
      const y = 740 + i * 86;
      return [
        RR(X(8), y, 74, 52, 26, RED, { name: "Page tag" }),
        T(page, X(8), y + 9, 74, 26, { fontFamily: SANS, fontWeight: 700, color: PAPER, align: "center" }),
        T(text, X(8) + 98, atBase(SANS, 28, 1.2, y + 38), SPAN(4) - 98, 28, { fontFamily: SANS, fontWeight: 500, color: PAPER }),
      ];
    }),
  ],
  "The cover is the poster. Name the issue, say the one-line promise, then point at the three stories that follow.",
);

/* ---------------------------------------------------------------- 2 contents */
const features: Array<[string, string, string]> = [
  ["18", "The last chairmaker of Alfama", "A family workshop that has built one design since 1962."],
  ["34", "Houses that grow back", "Rammed earth, hemp and architects who farm walls."],
  ["52", "The slow kitchen", "Seven cooks, one wood-fired oven and no menu."],
  ["70", "Letters to a young maker", "Advice from nine masters, hand-lettered."],
];
const contents = slide(
  "Contents",
  PAPER,
  [
    photo("mountain-lake", X(0), 96, SPAN(4), 804, { fx: 0.5, name: "Contents photo", alt: "A mountain lake at dawn" }),
    R(X(5), 96, SPAN(7), 6, INK, { name: "Rule" }),
    LBL("In this issue", X(5), 138, 600, RED),
    D("Four stories worth the time", X(5), 214, SPAN(7), 64, { fontWeight: 900 }),
    ...features.flatMap(([page, title, text], i) => {
      const y = 352 + i * 142;
      return [
        hrule(X(5), y, SPAN(7), INK, 2),
        T(page, X(5), atCap(SERIF, 64, 1.0, y + 34), SPAN(1), 64, { fontFamily: SERIF, fontWeight: 900, italic: true, lineHeight: 1.0, color: RED }),
        T(title, X(6), atCap(SERIF, 40, 1.1, y + 34), SPAN(6), 40, { fontFamily: SERIF, fontWeight: 700, lineHeight: 1.1, letterSpacing: -5, color: INK }),
        B(text, X(6), y + 84, SPAN(6), GREY),
      ];
    }),
    ...folio(2),
  ],
  "Four stories, one line each. Resist reading the descriptions; point at the page numbers.",
);

/* ---------------------------------------------------------------- 3 divider */
const divider = slide(
  "Part two",
  INK,
  [
    photo("forest-mist", 0, 0, 1920, 1080, { fy: 0.5, name: "Divider photo", alt: "Pine forest in morning mist" }),
    R(0, 0, 1920, 1080, "rgba(8,12,10,0.6)", { name: "Shade" }),
    LBL("Part two  /  Craft", X(0), 96, 700, PAPER),
    T("02", X(5), atBase(SERIF, 600, 1.0, 984), SPAN(7), 600, { fontFamily: SERIF, fontWeight: 900, italic: true, lineHeight: 1.0, letterSpacing: -40, color: PAPER, align: "right", effect: { kind: "hollow", thickness: 0 }, name: "bleed Numeral" }),
    R(X(0), 520, 96, 8, RED, { name: "Accent bar" }),
    D("The\nWorkshop", X(0), 600, SPAN(8), 120, { color: PAPER, name: "Title" }),
    B("Where sixty-four years of the same chair begin.", X(0), 846, SPAN(6), PAPER, { fontSize: 32, name: "Subtitle" }),
  ],
  "Section break. Dim the room, say the section name and let the image carry two beats of silence.",
);

/* ---------------------------------------------------------------- 4 pull quote */
const pullQuote = slide(
  "Pull quote",
  RED,
  [
    T("“", 40, -150, 760, 860, { fontFamily: SERIF, fontWeight: 900, color: "#b11f14", lineHeight: 1.0, name: "bleed Quote mark" }),
    D("You can hurry\na sandwich. You\ncannot hurry\na chair.", X(0), 196, SPAN(11), 120, { color: PAPER, italic: true, fontWeight: 800, name: "Quote" }),
    hrule(X(0), 792, 96, PAPER, 4),
    LBL("Eduardo Valente, chairmaker", X(0), 836, SPAN(8), PAPER),
    T("Alfama, Lisbon", X(0), 874, SPAN(6), 28, { fontFamily: SANS, color: PAPER }),
    ...folio(4, true),
  ],
  "Read it once, slowly. If your audience only remembers one line from the article, it is this one.",
);

/* ---------------------------------------------------------------- 5 article (two columns + drop cap) */
const bodyY = 410;
const LINE_H = 28 * 1.55;
const article = slide(
  "Article",
  PAPER,
  [
    R(X(0), 96, SPAN(12), 6, INK, { name: "Rule" }),
    LBL("Feature  /  Craft", X(0), 138, 700, RED),
    D("The last chairmaker\nof Alfama", X(0), 196, SPAN(10), 96, { name: "Headline" }),
    // column 1 with a three-line drop cap
    T("T", X(0), atCap(SERIF, 147, 1.0, bodyY + 12.5), 120, 147, { fontFamily: SERIF, fontWeight: 900, lineHeight: 1.0, letterSpacing: 0, color: RED, name: "Drop cap" }),
    B("he chairs of Alfama are not\nso much made as remembered.\nIn a workshop no wider than", X(0) + 116, bodyY, SPAN(4) - 116, INK, { name: "Column 1 lead" }),
    B("a tram, three generations of the Valente family still build the ladder-back their grandfather sketched on a bakery bag in 1962, turning every leg by hand until the grain agrees with the load. Nothing is sanded twice.", X(0), bodyY + LINE_H * 3, SPAN(4), INK, { name: "Column 1" }),
    // column 2
    B("Eduardo, seventy-one, works the lathe each morning. His granddaughter Rita, who left a design degree to join him, weaves the rush seats in the afternoon: eleven hours to a chair and never a pattern on paper. They sell forty-three a year. Not forty-four. “More,” Eduardo says, “and the chair starts to forget who made it.”", X(4), bodyY, SPAN(4), INK, { name: "Column 2" }),
    // column 3: photo + caption
    frame(X(8), bodyY, SPAN(4), 360, { name: "Article photo frame" }),
    T("Rita Valente weaving a rush seat.", X(8), bodyY + 384, SPAN(4), 28, { fontFamily: SERIF, italic: true, fontWeight: 400, lineHeight: 1.35, color: GREY, name: "Caption" }),
    ...folio(5),
  ],
  "Replace the frame with a portrait of your subject. Keep the headline to two lines.",
);

/* ---------------------------------------------------------------- 6 numbers */
const numbers: Array<[string, string]> = [
  ["1962", "the year the Valente workshop opened on Rua de São Miguel"],
  ["43", "chairs built each year, and never one more"],
  ["11 h", "to weave a single rush seat entirely by hand"],
  ["3", "apprentices at the bench, all of them under 25"],
];
const stats = slide(
  "Numbers",
  INK,
  [
    LBL("The workshop in numbers", X(0), 96, 900, "#ff6a5a"),
    D("Small by design.", X(0), 190, SPAN(11), 120, { color: PAPER }),
    ...numbers.flatMap(([big, text], i) => {
      const x = X(i * 3);
      return [
        R(x, 520, SPAN(3), 4, PAPER, { name: "Rule" }),
        T(big, x, atCap(SANS, 160, 1.0, 592), SPAN(3), 160, { fontFamily: SANS, fontWeight: 800, lineHeight: 1.0, letterSpacing: -40, color: PAPER, name: "Stat" }),
        B(text, x, 760, SPAN(3) - 24, FAINT, { lineHeight: 1.45 }),
      ];
    }),
    ...folio(6, true),
  ],
  "Four numbers, left to right. The point: smallness is the product.",
);

/* ---------------------------------------------------------------- 7 subscribe */
const subscribe = slide(
  "Subscribe",
  PAPER,
  [
    R(X(7), 0, 1920 - X(7), 1080, RED, { name: "Red panel" }),
    LBL("Next issue  /  Winter 2026", X(0), 96, 800, RED),
    D("Keep\nreading.", X(0), 250, SPAN(6), 160, { name: "Title" }),
    B("Editor-in-chief  Inês Carvalho\nArt direction  Tomás Rey\nPhotography  Ana Lopes, João Reis\nPrinted on recycled paper in Porto", X(0), 700, SPAN(6), GREY, { lineHeight: 1.55, name: "Credits" }),
    LBL("Subscribe", X(8), 96, 560, PAPER),
    D("Four issues,\none year.", X(8), 190, SPAN(4), 64, { color: PAPER, name: "Offer" }),
    D("€48", X(8), 470, SPAN(4), 200, { color: PAPER, name: "Price" }),
    B("Free shipping across Europe.\nCancel any time.", X(8), 700, SPAN(4), PAPER),
    RR(X(8), 800, SPAN(4), 84, 42, PAPER, { name: "Button" }),
    T("oblique.example/subscribe", X(8), 800 + 25, SPAN(4), 28, { fontFamily: SANS, fontWeight: 700, color: RED, align: "center" }),
    T(num(7), RIGHT - 200, atBase(SERIF, 28, 1.2, BOTTOM), 200, 28, { fontFamily: SERIF, fontWeight: 700, italic: true, color: PAPER, align: "right", name: "Page number" }),
    T("OBLIQUE", X(0), atBase(SERIF, 26, 1.2, BOTTOM), 220, 26, { fontFamily: SERIF, fontWeight: 900, letterSpacing: 120, color: INK, name: "Footer" }),
  ],
  "Close with the offer. One price, one link. Put the link on screen for the Q and A.",
);

export const EDITORIAL: Template = template(
  {
    slug: "editorial-magazine-feature",
    name: "Editorial Magazine Feature",
    category: "presentation",
    size: "presentation",
    tags: ["editorial", "magazine", "feature", "serif", "cream", "red", "photo", "article", "publishing", "quarterly", "cover story"],
    accent: RED,
  },
  [cover, contents, divider, pullQuote, article, stats, subscribe],
);
