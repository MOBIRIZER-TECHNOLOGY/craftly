/**
 * Minimal studio portfolio: warm paper, one rust accent, a big light serif and a lot of air.
 * Cormorant Garamond for display, DM Sans for text. A fictional architecture studio ("Halden Studio").
 */
import type { Template } from "@/core/types";
import { C, T, template } from "./dsl";
import { atBase, BOTTOM, frame, hrule, makeType, num, photo, RIGHT, rich, slide, SPAN, X } from "./presentations-kit";

const PAPER = "#f3efe7";
const INK = "#1c1b18";
const MUTED = "#625d53";
const HAIR = "#d3ccbd";
const RUST = "#a8461f";

const SERIF = "Cormorant Garamond";
const SANS = "DM Sans";

const { D, LBL, B } = makeType({
  display: SERIF,
  text: SANS,
  ink: INK,
  displayWeight: 300,
  tracking: (s) => (s >= 100 ? -20 : -6),
  labelWeight: 500,
  labelTracking: 200,
});

/** Footer: studio line on the left, page number on the right, both on the bottom margin. */
const folio = (n: number, left = X(0)) => [
  T("Halden Studio  /  Portfolio 2026", left, atBase(SANS, 26, 1.2, BOTTOM), 800, 26, { fontFamily: SANS, fontWeight: 400, color: MUTED, name: "Footer" }),
  T(num(n), RIGHT - 200, atBase(SANS, 26, 1.2, BOTTOM), 200, 26, { fontFamily: SANS, fontWeight: 500, color: MUTED, align: "right", name: "Page number" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  PAPER,
  [
    photo("monstera", X(8), 96, SPAN(4), 888, { fx: 0.5, fy: 0.62, name: "Cover photo", alt: "A single monstera leaf on a cream wall" }),
    C(106, 109, 9, RUST, { name: "Logo dot" }),
    LBL("Halden Studio", X(0) + 30, 96, 600, INK),
    D("Rooms for\nslow living.", X(0), 560, SPAN(8), 150, { name: "Title" }),
    hrule(X(0), 922, SPAN(7), HAIR, 2),
    T("Portfolio 2026", X(0), atBase(SANS, 28, 1.2, BOTTOM), SPAN(3), 28, { fontFamily: SANS, color: INK, fontWeight: 500 }),
    T("Architecture and interiors", X(3), atBase(SANS, 28, 1.2, BOTTOM), SPAN(3), 28, { fontFamily: SANS, color: MUTED }),
    T("Lisbon, Portugal", X(6), atBase(SANS, 28, 1.2, BOTTOM), SPAN(2), 28, { fontFamily: SANS, color: MUTED }),
  ],
  "Let the cover breathe. Say the studio name, the year and one sentence about what you do, then turn the page.",
);

/* ---------------------------------------------------------------- 2 contents */
const chapters: Array<[string, string]> = [
  ["Philosophy", "03"],
  ["Casa Aurelia", "04"],
  ["Materials", "05"],
  ["Client words", "06"],
  ["Contact", "07"],
];
const contents = slide(
  "Contents",
  PAPER,
  [
    LBL("Index", X(0), 96, 500, RUST),
    D("Contents", X(0), 300, SPAN(5), 120),
    B("Selected work from 2019 to 2026: houses, studios and one very small chapel.", X(0), 470, SPAN(4) + 40, MUTED),
    ...chapters.flatMap(([name, page], i) => {
      const y = 150 + i * 150;
      return [
        hrule(X(6), y, SPAN(6), HAIR, 2),
        T(num(i + 1), X(6), atBase(SANS, 26, 1.2, y + 92), 100, 26, { fontFamily: SANS, fontWeight: 500, color: RUST }),
        T(name, X(6) + 120, atBase(SERIF, 64, 1.0, y + 92), SPAN(5), 64, { fontFamily: SERIF, fontWeight: 400, lineHeight: 1.0, letterSpacing: -6, color: INK }),
        T(page, RIGHT - 120, atBase(SANS, 26, 1.2, y + 92), 120, 26, { fontFamily: SANS, fontWeight: 400, color: MUTED, align: "right" }),
      ];
    }),
    hrule(X(6), 150 + chapters.length * 150, SPAN(6), HAIR, 2),
    ...folio(2),
  ],
  "A quick map of the portfolio. One sentence per chapter is plenty.",
);

/* ---------------------------------------------------------------- 3 statement */
const statement = slide(
  "Philosophy",
  PAPER,
  [
    LBL("Philosophy", X(0), 96, 500, RUST),
    hrule(X(0), 330, 72, RUST, 3, { name: "Accent rule" }),
    rich(D(" ", X(0), 400, SPAN(11), 88, { lineHeight: 1.12, name: "Statement" }), [
      ["We design for the hours between the hours: ", { text: "morning light on a plaster wall", italic: true }, ", the weight of a door handle, the quiet of a well-made room."],
    ]),
    T("Ines Halden", X(0), 790, SPAN(4), 28, { fontFamily: SANS, fontWeight: 600, color: INK }),
    T("Founding partner", X(0), 830, SPAN(4), 28, { fontFamily: SANS, color: MUTED }),
    ...folio(3),
  ],
  "This is the one slide where you can read a paragraph aloud. Slow down on the italic phrase.",
);

/* ---------------------------------------------------------------- 4 project (image + text) */
const specs: Array<[string, string]> = [
  ["Area", "240 m²"],
  ["Materials", "Rammed earth, cork, oak"],
  ["Status", "Completed March 2025"],
];
const project = slide(
  "Project",
  PAPER,
  [
    frame(0, 0, X(6) - 24, 1080, { name: "Project photo frame" }),
    LBL("Private house  /  Comporta  /  2025", X(6), 96, SPAN(6), RUST),
    D("Casa\nAurelia", X(6), 200, SPAN(6), 120),
    B("A 240 m² house of rammed earth and cork, turned so the long hall catches the evening sun. Built with local craftspeople over fourteen months.", X(6), 440, SPAN(5) + 20, INK, { lineHeight: 1.55 }),
    ...specs.flatMap(([k, v], i) => {
      const y = 640 + i * 72;
      return [
        hrule(X(6), y, SPAN(6), HAIR, 2),
        T(k, X(6), atBase(SANS, 26, 1.2, y + 48), SPAN(2), 26, { fontFamily: SANS, fontWeight: 500, letterSpacing: 140, textCase: "upper", color: MUTED }),
        T(v, X(6) + 300, atBase(SANS, 28, 1.2, y + 48), 552, 28, { fontFamily: SANS, color: INK }),
      ];
    }),
    hrule(X(6), 640 + specs.length * 72, SPAN(6), HAIR, 2),
    ...folio(4, X(6)),
  ],
  "Replace the frame with your hero photograph. Talk about the site first, then the plan, then one detail.",
);

/* ---------------------------------------------------------------- 5 materials (three columns) */
const materials: Array<[string, string, string, string]> = [
  ["concrete-gray", "Board-marked concrete", "Poured on site, so the grain of the timber stays in the surface.", "i"],
  ["linen-beige", "Belgian linen", "Washed and unlined, for curtains that move with the air.", "ii"],
  ["terrazzo", "Honed terrazzo", "Quarry offcuts set by hand in lime, ground back until they sing.", "iii"],
];
const materialsSlide = slide(
  "Materials",
  PAPER,
  [
    LBL("Materials", X(0), 96, 500, RUST),
    rich(D(" ", X(0), 190, SPAN(9), 88, { lineHeight: 1.04, name: "Title" }), [["Honest materials,"], [{ text: "left to age well.", italic: true }]]),
    ...materials.flatMap(([id, name, text, n], i) => {
      const x = X(i * 4);
      return [
        photo(id, x, 390, SPAN(4), 320, { name: "Material swatch" }),
        T(n, x, atBase(SANS, 26, 1.2, 774), 80, 26, { fontFamily: SANS, fontWeight: 500, color: RUST }),
        T(name, x + 64, atBase(SERIF, 40, 1.0, 774), SPAN(4) - 64, 40, { fontFamily: SERIF, fontWeight: 500, lineHeight: 1.0, letterSpacing: -4, color: INK }),
        B(text, x, 802, SPAN(4) - 24, MUTED, { lineHeight: 1.45 }),
      ];
    }),
    ...folio(5),
  ],
  "Pass a real sample round if you can. Three materials, one sentence each.",
);

/* ---------------------------------------------------------------- 6 quote */
const quote = slide(
  "Quote",
  PAPER,
  [
    T("“", X(0) - 8, 120, 300, 420, { fontFamily: SERIF, fontWeight: 400, color: RUST, lineHeight: 1.0, name: "bleed Quote mark" }),
    rich(D(" ", X(0), 420, SPAN(10), 88, { lineHeight: 1.1, name: "Quote" }), [[{ text: "They gave us a house that feels like it has always been here.", italic: true }]]),
    hrule(X(0), 772, 72, RUST, 3),
    T("Marta and Joel Ferreira", X(0), 812, SPAN(6), 28, { fontFamily: SANS, fontWeight: 600, color: INK }),
    T("Clients, Casa Aurelia", X(0), 852, SPAN(6), 28, { fontFamily: SANS, color: MUTED }),
    ...folio(6),
  ],
  "Read the quote, then stay quiet for two seconds. Swap in your own client's words.",
);

/* ---------------------------------------------------------------- 7 contact */
const contact: Array<[string, string]> = [
  ["Studio", "Rua das Flores 28\n1200-195 Lisbon"],
  ["Write", "hello@halden.studio"],
  ["Call", "+351 21 555 0142"],
];
const contactSlide = slide(
  "Contact",
  PAPER,
  [
    LBL("Contact", X(0), 96, 500, RUST),
    D("Start with a\nconversation.", X(0), 300, SPAN(7), 120),
    C(X(0) + 10, 760, 10, RUST, { name: "Dot" }),
    T("Booking commissions for 2027", X(0) + 40, atBase(SANS, 28, 1.2, 770), SPAN(5), 28, { fontFamily: SANS, color: INK, fontWeight: 500 }),
    ...contact.flatMap(([k, v], i) => {
      const y = 240 + i * 220;
      return [
        hrule(X(8), y, SPAN(4), HAIR, 2),
        LBL(k, X(8), y + 52, SPAN(4), RUST),
        T(v, X(8), atBase(SANS, 32, 1.35, y + 128), SPAN(4), 32, { fontFamily: SANS, fontWeight: 400, lineHeight: 1.35, color: INK }),
      ];
    }),
    ...folio(7),
  ],
  "End on the invitation. Leave the contact details up while you take questions.",
);

export const STUDIO: Template = template(
  {
    slug: "minimal-studio-portfolio",
    category: "presentation",
    size: "presentation",
    tags: ["minimal", "studio", "portfolio", "architecture", "interior", "serif", "elegant", "off-white", "neutral", "design", "whitespace"],
    accent: RUST,
  },
  [cover, contents, statement, project, materialsSlide, quote, contactSlide],
);
