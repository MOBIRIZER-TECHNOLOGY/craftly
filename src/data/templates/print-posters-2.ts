/** Four more posters (1728 x 2304): talk series on a Swiss grid, plant swap, travel, jazz night. */
import type { DesignElement, Template } from "@/core/types";
import { C, O, R, RR, S, T, pg, template } from "./dsl";
import { fade, font, frame, group, gxb, hr, ph } from "./print-kit";

const W = 1728;
const M = 96;

/* ------------------------------------------------------------------ */
/* 6. Talk series on a grid - Open Studio Talks                         */
/* ------------------------------------------------------------------ */

function studioTalks(): Template {
  const PAPER = "#f3f1ea";
  const INK = "#14151a";
  const BLUE = "#1f3fd6";
  const RED = "#e2432a";
  const GREY = "#4a4d57";
  const black = font("Archivo Black", { color: INK, lineHeight: 0.95 });
  const sans = font("Inter", { color: INK });
  const talks: Array<[string, string, string, string]> = [
    ["14 JAN", "Glaze is a slow conversation", "Inés Baptista, potter", "CERAMICS"],
    ["11 FEB", "Drawing letters by hand first", "Tomasz Wren, type designer", "TYPE"],
    ["11 MAR", "Small tools that outlive the project", "Priya Nambiar, programmer", "CODE"],
    ["08 APR", "What the loom taught me about grids", "Odile Marsh, weaver", "TEXTILES"],
    ["13 MAY", "Printing in two colours, on purpose", "Kofi Adeyemi, printmaker", "PRINT"],
    ["10 JUN", "A chair, forty prototypes later", "Sana Lindqvist, furniture maker", "WOOD"],
  ];
  const els: DesignElement[] = [
    sans("OPEN STUDIO TALKS", M, 92, 800, 28, { fontWeight: 700, letterSpacing: 220 }),
    sans("SEASON SIX  /  2027", 928, 92, 704, 28, { fontWeight: 700, letterSpacing: 220, align: "right" }),
    hr(M, 150, W - M * 2, INK, 4),
    C(1016, 742, 132, RED),
    black("06", M - 22, 196, 980, 720, { color: BLUE, letterSpacing: -30, lineHeight: 0.9 }),
    black("SIX\nEVENINGS\nON MAKING\nTHINGS", 1072, 236, 580, 84, { lineHeight: 1.04 }),
    hr(M, 900, W - M * 2, INK, 4),
    sans("Six working potters, weavers and programmers open their studios and talk about how the work really gets made. Bring questions.", M, 940, 820, 34, { lineHeight: 1.45 }),
    sans("EVERY SECOND THURSDAY", 1072, 944, 560, 28, { fontWeight: 700, letterSpacing: 160, color: BLUE }),
    sans("7 pm, doors at 6:30", 1072, 990, 560, 34, { fontWeight: 600 }),
  ];
  talks.forEach(([date, title, who, tag], i) => {
    const y = 1180 + i * 150;
    els.push(
      hr(M, y, W - M * 2, INK, 2),
      black(date, M, y + 44, 330, 56, { color: BLUE, lineHeight: 1.1 }),
      sans(title, 450, y + 30, 830, 40, { fontWeight: 700, lineHeight: 1.2 }),
      sans(who, 450, y + 86, 830, 30, { color: GREY }),
      sans(tag, 1300, y + 56, 332, 26, { fontWeight: 700, letterSpacing: 200, align: "right" }),
    );
  });
  els.push(
    hr(M, 2080, W - M * 2, INK, 4),
    sans("THE FOUNDRY ROOM, 8 KILN LANE, ALDERBROOK", M, 2112, W - M * 2, 28, { fontWeight: 700, letterSpacing: 160 }),
    sans("Free entry. Seats are limited, so book a place at openstudiotalks.example.com", M, 2160, W - M * 2, 30, { color: GREY }),
  );
  return template(
    { slug: "open-studio-talks", name: "Open Studio Talks Series Poster", category: "poster", size: "poster", tags: ["talk", "lecture", "series", "poster", "schedule", "swiss", "grid", "design", "blue"], accent: BLUE },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Plant swap - playful illustration poster                          */
/* ------------------------------------------------------------------ */

function plantSwap(): Template {
  const CREAM = "#f7efd9";
  const GREEN = "#1f5c3a";
  const LEAF = "#a9d99a";
  const PINK = "#ff9db2";
  const YELLOW = "#ffcf4a";
  const INK = "#1d3a2a";
  const head = font("Fredoka", { color: GREEN });
  const body = font("Nunito", { color: INK });
  const SHELF = 1010;
  const els: DesignElement[] = [
    S("blob-2", -150, 150, 900, 820, YELLOW),
    S("blob-4", 930, 240, 900, 760, PINK),
    C(820, 560, 250, LEAF),
    body("SATURDAY 17 APRIL  /  10 AM TO 2 PM", M, 100, W - M * 2, 32, { align: "center", fontWeight: 800, letterSpacing: 220, color: GREEN }),
    gxb("nature-cactus", 170, SHELF, 330),
    gxb("objects-plant-pot", 590, SHELF, 440),
    gxb("nature-monstera", 1090, SHELF, 500),
    RR(M, SHELF, W - M * 2, 26, 13, GREEN),
    C(1500, 330, 128, GREEN),
    T("100%\nFREE", 1500 - 120, 330 - 76, 240, 68, { fontFamily: "Fredoka", fontWeight: 700, color: CREAM, align: "center", lineHeight: 1.1, rotation: -10 }),
    head("Spring\nPlant Swap", M, 1080, W - M * 2, 256, { align: "center", fontWeight: 700, lineHeight: 0.98 }),
    body("Bring a cutting, take one home. No money changes hands.", M, 1630, W - M * 2, 44, { align: "center", fontWeight: 700 }),
  ];
  const cards: Array<[string, string, string, string, string]> = [
    ["WHERE", "Wrenfield Library", "Garden courtyard, Fern Road", GREEN, CREAM],
    ["BRING", "Cuttings and pots", "Labelled, if you know the name", YELLOW, INK],
    ["ALSO", "Free repotting", "Soil and advice from 11 am", PINK, INK],
  ];
  cards.forEach(([k, v, s, fill, ink], i) => {
    const x = M + i * 520;
    els.push(
      RR(x, 1800, 496, 256, 40, fill),
      body(k, x + 36, 1834, 424, 26, { fontWeight: 800, letterSpacing: 260, color: ink }),
      head(v, x + 36, 1876, 424, 46, { fontWeight: 600, color: ink, lineHeight: 1.15 }),
      body(s, x + 36, 1948, 424, 28, { fontWeight: 600, color: ink, lineHeight: 1.3 }),
    );
  });
  els.push(
    S("star-4", 250, 2146, 44, 44, PINK),
    S("star-4", 1434, 2146, 44, 44, YELLOW),
    body("Hosted by the Wrenfield Garden Club  /  plantswap.example.com", M, 2146, W - M * 2, 32, { align: "center", fontWeight: 700, color: GREEN }),
  );
  return template(
    { slug: "spring-plant-swap", name: "Spring Plant Swap Poster", category: "poster", size: "poster", tags: ["plants", "swap", "garden", "community", "poster", "spring", "playful", "illustration", "green"], accent: GREEN },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 8. Travel poster - North Coast                                       */
/* ------------------------------------------------------------------ */

function northCoast(): Template {
  const CREAM = "#f4ead5";
  const TEAL = "#0f4f5a";
  const RUST = "#b0401e";
  const display = font("Yeseva One", { color: TEAL });
  const sans = font("Lato", { color: TEAL });
  const els: DesignElement[] = [
    ph("ocean-waves", M, M, W - M * 2, 1500, { fx: 0.5, fy: 0.5, alt: "Waves rolling onto a shore" }),
    R(M, M, W - M * 2, 700, fade(180, "rgba(8,45,52,0.86)", "rgba(8,45,52,0.6)", "rgba(8,45,52,0)")),
    frame(M + 26, M + 26, W - M * 2 - 52, 1448, CREAM, 3, { opacity: 0.85 }),
    sans("VISIT THE", M, 196, W - M * 2, 40, { align: "center", fontWeight: 700, letterSpacing: 620, color: CREAM }),
    display("North Coast", M + 40, 256, W - M * 2 - 80, 224, { align: "center", color: CREAM, lineHeight: 1.1 }),
    C(1400, 1596, 152, RUST),
    O("ellipse", 1400 - 132, 1596 - 132, 264, 264, CREAM, 3, { stroke: { color: CREAM, width: 3, style: "dashed" } }),
    T("280 KM\nOF SHORE", 1400 - 130, 1596 - 58, 260, 46, { fontFamily: "Yeseva One", color: CREAM, align: "center", lineHeight: 1.25, rotation: -8 }),
    sans("SEA STACKS  /  TIDE POOLS  /  LIGHT UNTIL TEN", M, 1668, 1100, 30, { fontWeight: 900, letterSpacing: 260, color: RUST }),
    display("Slow trains, cold swims,\nwarm bakeries.", M, 1740, W - M * 2, 96, { lineHeight: 1.12 }),
    hr(M, 2010, W - M * 2, TEAL, 3),
  ];
  const cols: Array<[string, string]> = [
    ["GETTING THERE", "The Coast Line from Port Merrow, every hour"],
    ["BEST MONTHS", "May to September, and bright days in March"],
    ["PLAN YOUR TRIP", "northcoast.example.com"],
  ];
  cols.forEach(([k, v], i) => {
    const x = M + i * 528;
    els.push(sans(k, x, 2046, 480, 24, { fontWeight: 900, letterSpacing: 260, color: RUST }), sans(v, x, 2086, 470, 34, { fontWeight: 700, lineHeight: 1.3 }));
  });
  return template(
    { slug: "north-coast-travel", name: "North Coast Travel Poster", category: "poster", size: "poster", tags: ["travel", "tourism", "coast", "sea", "poster", "photo", "vintage", "holiday", "teal"], accent: TEAL },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 9. Jazz night - Blue Hour Quartet                                    */
/* ------------------------------------------------------------------ */

function blueHour(): Template {
  const NIGHT = "#0d1430";
  const BLUE = "#2646c8";
  const GOLD = "#f0b64a";
  const CREAM = "#f5ecd8";
  const DUSK = "#aab4de";
  const display = font("Abril Fatface", { color: CREAM, lineHeight: 1 });
  const sans = font("Josefin Sans", { color: CREAM });
  const CX = 1150;
  const CY = 670;
  const notes: Array<[number, number]> = [
    [220, 4],
    [400, 2],
    [560, 3],
    [1380, 1],
    [1540, 3],
  ];
  const els: DesignElement[] = [
    sans("LATE SESSIONS AT THE CELLAR DOOR", M, 100, 1100, 30, { fontWeight: 700, letterSpacing: 380, color: GOLD }),
    sans("NO. 27", 1232, 100, 400, 30, { fontWeight: 700, letterSpacing: 380, color: GOLD, align: "right" }),
    group("Record", [
      C(CX, CY, 500, BLUE),
      ...[420, 340, 260].map((r) => O("ellipse", CX - r, CY - r, r * 2, r * 2, NIGHT, 3, { opacity: 0.55 })),
      C(CX, CY, 150, GOLD),
      C(CX, CY, 24, NIGHT),
    ]),
    S("half-circle", M, 520, 420, 210, CREAM),
    S("half-circle", M, 730, 420, 210, GOLD, { flipV: true }),
    group("Staff lines", [0, 1, 2, 3, 4].map((i) => R(M, 1196 + i * 26, W - M * 2, 3, GOLD, { opacity: 0.8 }))),
    ...notes.map(([x, line]) => C(x, 1197 + line * 26, 15, CREAM)),
    display("Blue Hour", M - 8, 1320, W - M * 2, 280),
    display("Quartet", M - 8, 1600, W - M * 2, 280, { color: GOLD }),
    hr(M, 1946, W - M * 2, GOLD, 2),
    sans("FRIDAY 22 OCTOBER  /  DOORS 8 PM  /  MUSIC 9 PM", M, 1984, W - M * 2, 40, { fontWeight: 700, letterSpacing: 120 }),
    sans("Four players, two sets and one long encore. Standards, slow blues and new tunes written for the room.", M, 2062, 900, 34, { color: DUSK, lineHeight: 1.45 }),
    sans("TICKETS $12  /  STUDENTS $8", 1052, 2066, 580, 30, { fontWeight: 700, letterSpacing: 160, color: GOLD, align: "right" }),
    sans("cellardoor.example.com", 1052, 2116, 580, 34, { align: "right" }),
  ];
  return template(
    { slug: "blue-hour-jazz", name: "Blue Hour Quartet Jazz Poster", category: "poster", size: "poster", tags: ["jazz", "music", "concert", "gig", "poster", "night", "geometric", "dark", "gold"], accent: BLUE },
    [pg(NIGHT, els)],
  );
}

export const POSTER_TEMPLATES_2: Template[] = [studioTalks(), plantSwap(), northCoast(), blueHour()];
