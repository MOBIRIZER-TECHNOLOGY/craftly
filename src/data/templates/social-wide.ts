/** Facebook, LinkedIn, X and Pinterest templates: listing, bookstore pick, hiring, insight, podcast cover, recipe pin. */
import type { DesignElement, Template } from "@/core/types";
import { C, L, O, P, R, RR, S, T, gradientBg, pg, photoBg, template } from "./dsl";
import { cardShadow, centered, gfx, icon, pill, sparkle, stars, tilt } from "./social-kit";

/* ------------------------------------------------------------------ */
/* Facebook 1: just listed (real estate)                               */
/* ------------------------------------------------------------------ */

function harbourListing(): Template {
  const NAVY = "#0f1f3d";
  const GOLD = "#dcb865";
  const SERIF = "Playfair Display";
  const SANS = "Montserrat";

  const spec = (x: number, ic: "bed" | "bath" | "ruler" | "home", text: string, textW: number): DesignElement[] => [
    icon(ic, x, 658, 42, GOLD, { stroke: 1.8, name: `${ic} icon` }),
    T(text, x + 54, 662, textW, 34, { fontFamily: SANS, fontWeight: 600, color: "#ffffff", lineHeight: 1.2, name: text }),
  ];

  const page = pg(NAVY, [
    P("glass-towers", 0, 0, 940, 450, { name: "Building photo", alt: "Glass apartment tower seen from below" }),
    S("rect", 0, 250, 940, 200, { type: "linear", angle: 180, stops: [{ offset: 0, color: "rgba(15,31,61,0)" }, { offset: 1, color: "rgba(15,31,61,0.9)" }] }, { name: "Photo fade" }),
    ...pill("Just listed", 64, 64, 236, 58, GOLD, NAVY, 28, { font: SANS, weight: 800, spacing: 80, upper: true }),
    RR(572, 64, 304, 132, 18, "rgba(15,31,61,0.86)", { stroke: { color: GOLD, width: 2, style: "solid" }, name: "Open house card" }),
    T("Open house", 596, 82, 260, 28, { fontFamily: SANS, fontWeight: 800, letterSpacing: 100, textCase: "upper", color: GOLD, lineHeight: 1.2, name: "Open house label" }),
    T("Sat, 12 - 3 PM", 596, 124, 262, 42, { fontFamily: SERIF, fontWeight: 700, color: "#ffffff", lineHeight: 1.2, name: "Open house time" }),
    T("$685,000", 64, 484, 520, 82, { fontFamily: SERIF, fontWeight: 800, color: GOLD, lineHeight: 1.1, name: "Price" }),
    T("2 Harbour Street, Seattle", 64, 574, 520, 34, { fontFamily: SANS, fontWeight: 600, color: "#ffffff", lineHeight: 1.2, name: "Address" }),
    RR(604, 500, 272, 76, 38, GOLD, { name: "Button" }),
    centered("Book a viewing", 740, 538, 260, 30, { fontFamily: SANS, fontWeight: 800, color: NAVY, name: "Button label" }),
    T("harbourlofts.com", 604, 592, 272, 30, { fontFamily: SANS, fontWeight: 500, color: "#c9d3e8", align: "center", lineHeight: 1.2, name: "Website" }),
    L(64, 632, 876, 632, "#ffffff", 2, { opacity: 0.22, name: "Rule" }),
    ...spec(64, "bed", "2 bed", 104),
    ...spec(244, "bath", "2 bath", 124),
    ...spec(448, "ruler", "1,150 sq ft", 240),
    ...spec(746, "home", "Loft", 90),
  ]);

  return template(
    { slug: "harbour-loft-listing", name: "Harbour Loft Listing", category: "social", size: "facebook", accent: "#14284f", tags: ["real estate", "listing", "just listed", "property", "open house", "navy", "gold", "facebook", "home", "agent"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* Facebook 2: staff pick (bookstore)                                  */
/* ------------------------------------------------------------------ */

function staffPickBook(): Template {
  const BURGUNDY = "#7a1f2b";
  const TEAL = "#17494d";
  const GOLD = "#e0a526";
  const CREAM = "#f6ecd9";
  const INK = "#2a1a14";
  const SERIF = "Libre Baskerville";
  const SANS = "Work Sans";

  const book = tilt(
    [
      RR(112, 150, 300, 450, 10, TEAL, { name: "Book cover", shadow: { color: "rgba(20,8,6,0.4)", blur: 30, x: 8, y: 18 } }),
      R(112, 150, 26, 450, "#0f3438", { name: "Spine" }),
      O("rect", 160, 190, 212, 370, GOLD, 3, { name: "Cover frame" }),
      T("The Salt\nLibrary", 160, 262, 212, 44, { fontFamily: SERIF, fontWeight: 700, color: CREAM, align: "center", lineHeight: 1.18, name: "Cover title" }),
      gfx("travel-compass", 206, 372, 120, { name: "Cover compass" }),
      T("IMOGEN HART", 160, 520, 212, 24, { fontFamily: SANS, fontWeight: 700, letterSpacing: 100, color: GOLD, align: "center", lineHeight: 1.2, name: "Cover author" }),
    ],
    262,
    375,
    -7,
  );

  const page = pg(photoBg("paper-cream"), [
    C(250, 392, 214, BURGUNDY, { name: "Backdrop" }),
    ...book,
    S("scallop", 312, 74, 146, 146, GOLD, { rotation: 12, name: "Price sticker", shadow: cardShadow("rgba(40,10,10,0.3)", 20, 10) }),
    centered("$18", 385, 147, 140, 44, { fontFamily: SERIF, fontWeight: 700, color: INK, rotation: 12, name: "Price" }),
    S("star", 496, 70, 36, 36, BURGUNDY, { name: "Star" }),
    T("Staff pick", 546, 72, 300, 32, { fontFamily: SANS, fontWeight: 800, letterSpacing: 200, textCase: "upper", color: BURGUNDY, lineHeight: 1.2, name: "Eyebrow" }),
    T("Read this if you\nlove slow burns.", 496, 122, 380, 48, { fontFamily: SERIF, fontWeight: 700, italic: true, color: INK, lineHeight: 1.22, name: "Headline" }),
    ...stars(5, 496, 270, 36, 10, GOLD),
    T("A lighthouse, a missing keeper and a library that only opens at low tide.", 496, 330, 380, 34, { fontFamily: SANS, fontWeight: 500, color: "#3a2a22", lineHeight: 1.38, name: "Blurb" }),
    T("Nora, Fiction shelf", 496, 556, 380, 34, { fontFamily: SERIF, italic: true, color: BURGUNDY, lineHeight: 1.2, name: "Signature" }),
    RR(64, 654, 812, 70, 35, BURGUNDY, { name: "Footer pill" }),
    centered("Paper & Pine Books  ·  Front table now", 470, 689, 780, 32, { fontFamily: SANS, fontWeight: 700, color: CREAM, name: "Footer" }),
  ]);

  return template(
    { slug: "staff-pick-bookshop", name: "Staff Pick Bookshop", category: "social", size: "facebook", accent: "#e8d9bd", tags: ["book", "bookstore", "recommendation", "staff pick", "reading", "review", "burgundy", "facebook", "library", "novel"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* LinkedIn 1: we're hiring                                            */
/* ------------------------------------------------------------------ */

function northwindHiring(): Template {
  const TEAL = "#16d5c8";
  const NAVY = "#0b1630";
  const FONT = "Manrope";
  const roles: Array<[string, string]> = [
    ["Product Designer", "Remote  ·  Full-time"],
    ["Backend Engineer", "Remote  ·  Full-time"],
    ["Growth Marketer", "Hybrid  ·  Lisbon"],
  ];
  const els: DesignElement[] = [
    O("ellipse", 640, -230, 640, 640, "#2f6bff", 2, { opacity: 0.35, name: "Ring" }),
    O("ellipse", 720, -150, 480, 480, "#2f6bff", 2, { opacity: 0.25, name: "Ring" }),
    C(1180, 600, 220, "#2f6bff", { opacity: 0.22, name: "Disc" }),
    C(88, 98, 18, TEAL, { name: "Logo dot" }),
    T("Northwind Labs", 124, 80, 460, 30, { fontFamily: FONT, fontWeight: 800, letterSpacing: 120, textCase: "upper", color: "#ffffff", lineHeight: 1.2, name: "Brand" }),
    T("We’re hiring.", 72, 142, 680, 92, { fontFamily: FONT, fontWeight: 800, color: "#ffffff", lineHeight: 1.05, letterSpacing: -20, name: "Headline" }),
    T("Three open roles, remote-first, shipping something real this quarter.", 72, 262, 620, 38, { fontFamily: FONT, fontWeight: 500, color: "#c8d4f0", lineHeight: 1.35, name: "Subheading" }),
    RR(72, 438, 560, 84, 42, TEAL, { name: "Button" }),
    T("Apply at northwind.io/jobs", 108, 462, 470, 34, { fontFamily: FONT, fontWeight: 800, color: NAVY, lineHeight: 1.2, name: "Button label" }),
    icon("arrowRight", 570, 460, 40, NAVY, { stroke: 2.6, name: "Arrow" }),
    RR(744, 84, 384, 456, 28, "#ffffff", { name: "Roles card", shadow: cardShadow("rgba(0,0,10,0.4)", 50, 24) }),
    T("Open roles", 776, 112, 320, 36, { fontFamily: FONT, fontWeight: 800, color: NAVY, lineHeight: 1.2, name: "Roles heading" }),
  ];
  roles.forEach(([title, meta], i) => {
    const y = 176 + i * 114;
    els.push(L(776, y - 6, 1096, y - 6, "#e3e8f4", 2, { name: "Divider" }));
    els.push(T(title, 776, y + 8, 320, 34, { fontFamily: FONT, fontWeight: 800, color: NAVY, lineHeight: 1.2, name: title }));
    els.push(T(meta, 776, y + 52, 320, 30, { fontFamily: FONT, fontWeight: 500, color: "#4a5878", lineHeight: 1.2, name: `${title} meta` }));
  });
  els.push(gfx("business-rocket", 1010, 18, 150, { rotation: 14, name: "Rocket" }));

  return template(
    { slug: "northwind-hiring", name: "Northwind Now Hiring", category: "social", size: "linkedin", accent: "#14295e", tags: ["hiring", "jobs", "careers", "recruitment", "linkedin", "we are hiring", "team", "navy", "announcement", "open roles"] },
    [pg(gradientBg(120, NAVY, "#14295e"), els)],
  );
}

/* ------------------------------------------------------------------ */
/* LinkedIn 2: insight card                                            */
/* ------------------------------------------------------------------ */

function insightStat(): Template {
  const INK = "#161616";
  const ORANGE = "#e84a1c";
  const SERIF = "DM Serif Display";
  const SANS = "Inter";
  const base = 420;

  const page = pg("#f6efe2", [
    T("Cold email, decoded", 72, 70, 560, 28, { fontFamily: SANS, fontWeight: 700, letterSpacing: 200, textCase: "upper", color: "#6b6254", lineHeight: 1.2, name: "Eyebrow" }),
    T("3.4x", 66, 100, 700, 270, { fontFamily: SERIF, color: ORANGE, lineHeight: 0.95, letterSpacing: -20, name: "Statistic" }),
    T("more replies when a cold email stays under 75 words.", 72, 372, 640, 42, { fontFamily: SANS, fontWeight: 700, color: INK, lineHeight: 1.25, name: "Insight" }),
    T("Source: 12,000 outbound emails, 2025", 72, 520, 560, 30, { fontFamily: SANS, fontWeight: 500, color: "#6b6254", lineHeight: 1.2, name: "Source" }),
    L(748, 70, 748, 556, INK, 2, { opacity: 0.18, name: "Divider line" }),
    RR(790, base - 250, 130, 250, 14, ORANGE, { name: "Bar short email" }),
    RR(970, base - 73, 130, 73, 14, "#cfc5b2", { name: "Bar long email" }),
    centered("34%", 855, base - 250 - 44, 150, 58, { fontFamily: SERIF, color: ORANGE, name: "Value short" }),
    centered("10%", 1035, base - 73 - 44, 150, 58, { fontFamily: SERIF, color: "#6b6254", name: "Value long" }),
    L(770, base + 2, 1120, base + 2, INK, 3, { name: "Axis" }),
    centered("Under 75", 855, base + 38, 170, 32, { fontFamily: SANS, fontWeight: 700, color: INK, name: "Label short" }),
    centered("Over 200", 1035, base + 38, 170, 32, { fontFamily: SANS, fontWeight: 700, color: INK, name: "Label long" }),
    T("Reply rate by length", 770, 488, 350, 30, { fontFamily: SANS, fontWeight: 500, color: "#6b6254", align: "center", lineHeight: 1.25, name: "Chart caption" }),
  ]);

  return template(
    { slug: "cold-email-insight", name: "Cold Email Insight Stat", category: "social", size: "linkedin", accent: "#efe3cd", tags: ["insight", "statistic", "data", "linkedin", "chart", "thought leadership", "marketing", "big number", "cream", "report"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* X / Twitter: podcast episode cover                                  */
/* ------------------------------------------------------------------ */

function podcastEpisode(): Template {
  const CYAN = "#4df0ff";
  const MAGENTA = "#ff3d8b";
  const DISPLAY = "Righteous";
  const SANS = "Outfit";

  const bars: DesignElement[] = [];
  const heights = [60, 110, 170, 90, 220, 140, 260, 180, 310, 200, 250, 120, 190, 280, 150, 230, 100, 170, 80, 130, 60, 100, 50];
  const cx = 1230;
  const cy = 450;
  heights.forEach((h, i) => {
    const x = cx - 253 + i * 22;
    bars.push(RR(x, cy - h / 2, 12, h, 6, i % 3 === 0 ? CYAN : "#ffffff", { name: "Wave bar" }));
  });

  const page = pg(photoBg("mesh-midnight"), [
    S("rect", 0, 0, 1600, 900, { type: "linear", angle: 90, stops: [{ offset: 0, color: "rgba(10,6,36,0.55)" }, { offset: 0.6, color: "rgba(10,6,36,0)" }] }, { name: "Left shade" }),
    C(cx, cy, 330, { type: "linear", angle: 135, stops: [{ offset: 0, color: "#7a2cff" }, { offset: 1, color: MAGENTA }] }, { name: "Cover disc", shadow: { color: "rgba(10,0,40,0.5)", blur: 60, x: 0, y: 30 } }),
    O("ellipse", cx - 290, cy - 290, 580, 580, "#ffffff", 2, { opacity: 0.35, name: "Ring" }),
    O("ellipse", cx - 250, cy - 250, 500, 500, "#ffffff", 2, { opacity: 0.2, name: "Ring" }),
    ...bars,
    C(cx + 215, cy + 245, 74, "#ffffff", { name: "Play button", shadow: { color: "rgba(10,0,40,0.4)", blur: 30, x: 0, y: 14 } }),
    S("triangle", cx + 215 - 22, cy + 245 - 26, 52, 52, "#2a0f6b", { rotation: 90, name: "Play" }),
    ...pill("Episode 47", 96, 112, 280, 64, CYAN, "#0a0624", 30, { font: SANS, weight: 800, spacing: 140, upper: true }),
    T("Why Nobody Reads the Manual", 96, 200, 880, 132, { fontFamily: DISPLAY, color: "#ffffff", lineHeight: 1.04, name: "Episode title" }),
    T("with Dr. Leila Okafor, usability researcher", 96, 626, 780, 42, { fontFamily: SANS, fontWeight: 500, color: "#e4dcff", lineHeight: 1.25, name: "Guest" }),
    T("Spotify  ·  Apple Podcasts  ·  YouTube", 96, 706, 860, 36, { fontFamily: SANS, fontWeight: 700, color: CYAN, lineHeight: 1.2, name: "Platforms" }),
    T("The Friction Files", 96, 782, 700, 36, { fontFamily: SANS, fontWeight: 800, letterSpacing: 120, textCase: "upper", color: "#ffffff", lineHeight: 1.2, name: "Show name" }),
  ]);

  return template(
    { slug: "friction-files-podcast", name: "Friction Files Podcast Cover", category: "social", size: "twitter", accent: "#3b1177", tags: ["podcast", "episode", "audio", "waveform", "show", "twitter", "x post", "purple", "interview", "listen now"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* Pinterest: pizza dough recipe pin                                   */
/* ------------------------------------------------------------------ */

function pizzaPin(): Template {
  const TOMATO = "#e63b1f";
  const CREAM = "#fff6e5";
  const INK = "#2b1810";
  const BASIL = "#2f6b3a";
  const SERIF = "Abril Fatface";
  const SANS = "Lato";

  const page = pg(TOMATO, [
    C(500, 470, 400, "#f8573a", { name: "Glow" }),
    C(500, 470, 330, CREAM, { name: "Plate" }),
    O("ellipse", 500 - 360, 470 - 360, 720, 720, "#ffffff", 3, { opacity: 0.35, name: "Ring" }),
    gfx("food-pizza-slice", 500 - 280, 470 - 280, 560, { rotation: -10, name: "Pizza slice" }),
    gfx("nature-olive-branch", 90, 170, 260, { rotation: -30, name: "Branch", colors: { "#e76f51": "#ff9d7a" } }),
    gfx("nature-fern", 740, 640, 200, { rotation: 25, name: "Basil", colors: { "#1f5a3e": BASIL } }),
    S("scallop", 740, 90, 200, 200, "#ffcf3a", { rotation: 12, name: "Time sticker", shadow: cardShadow("rgba(80,10,0,0.35)", 24, 12) }),
    T("15\nMIN", 740, 134, 200, 62, { fontFamily: SERIF, color: INK, align: "center", lineHeight: 1.0, rotation: 12, name: "Time" }),
    S("ellipse", -120, 820, 1240, 300, CREAM, { name: "Curve" }),
    R(0, 960, 1000, 540, CREAM, { name: "Panel" }),
    T("5 ingredients, no mixer", 90, 862, 820, 32, { fontFamily: SANS, fontWeight: 900, letterSpacing: 200, textCase: "upper", color: "#c42e14", align: "center", lineHeight: 1.2, name: "Eyebrow" }),
    T("Easy Crispy Pizza Dough", 70, 920, 860, 104, { fontFamily: SERIF, color: INK, align: "center", lineHeight: 1.04, name: "Title" }),
    T("No stand mixer, no fancy flour. Mix, rest and bake in about 15 minutes.", 110, 1160, 780, 38, { fontFamily: SANS, fontWeight: 400, color: "#4a3328", align: "center", lineHeight: 1.4, name: "Description" }),
    RR(300, 1290, 400, 92, 46, "#cf3217", { name: "Button" }),
    centered("Get the recipe", 500, 1336, 380, 38, { fontFamily: SANS, fontWeight: 900, color: "#ffffff", name: "Button label" }),
    T("sundaytable.co", 300, 1394, 400, 30, { fontFamily: SANS, fontWeight: 700, letterSpacing: 80, color: INK, align: "center", lineHeight: 1.2, name: "Website" }),
    sparkle(130, 640, 60, "#ffffff", { name: "Sparkle" }),
    sparkle(880, 420, 40, "#ffffff", { name: "Sparkle" }),
  ]);

  return template(
    { slug: "pizza-dough-pin", name: "Pizza Dough Recipe Pin", category: "social", size: "pinterest", accent: "#e63b1f", tags: ["pinterest", "recipe", "pizza", "food", "cooking", "pin", "tomato", "easy dinner", "baking", "kitchen"] },
    [page],
  );
}

export const WIDE_TEMPLATES: Template[] = [harbourListing(), staffPickBook(), northwindHiring(), insightStat(), podcastEpisode(), pizzaPin()];

