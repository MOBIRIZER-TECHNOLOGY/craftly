/** Five posters (1728 x 2304): event, music festival, minimalist exhibition, movie one-sheet, motivational type. */
import type { DesignElement, Template } from "@/core/types";
import { C, G, R, S, T, gradientBg, photoBg, pg, template } from "./dsl";
import { lighthouseScene, synthScene } from "./print-art";
import { fade, font, frame, gxw, hr, ph, vr } from "./print-kit";

const W = 1728;
const H = 2304;
const M = 96;

/* ------------------------------------------------------------------ */
/* 1. Event poster - Golden Hour Night Market                           */
/* ------------------------------------------------------------------ */

function nightMarket(): Template {
  const INK = "#2a1812";
  const CREAM = "#f8eedb";
  const TOMATO = "#d8452a";
  const MUSTARD = "#f2b02e";
  const mono = font("Space Mono", { color: INK });
  const cond = font("Anton", { color: INK, lineHeight: 0.9 });
  const cols = [
    { k: "WHEN", v: "FRI - SUN", s: "5 PM until 11 PM, every night" },
    { k: "WHERE", v: "THE PIER LAWN", s: "Harbor Point Plaza, Pier 7" },
    { k: "ENTRY", v: "FREE", s: "Bring a friend and a tote bag" },
  ];
  const colW = 480;
  const els: DesignElement[] = [
    mono("AUGUST 13 - 15, 2027", M, 88, 760, 30, { fontWeight: 700, letterSpacing: 140 }),
    mono("HARBOR POINT PLAZA, SEATTLE", 828, 88, 804, 30, { fontWeight: 700, letterSpacing: 140, align: "right" }),
    hr(M, 146, W - M * 2, INK, 4),
    // concentric arch frame + photo
    S("arch", 232, 196, 1264, 1340, null, { stroke: { color: INK, width: 4, style: "solid" } }),
    ph("sunset-hills", 264, 228, 1200, 1276, { mask: "arch", fx: 0.52, tune: { saturation: 8 } }),
    // stars
    S("star-4", 118, 520, 84, 84, TOMATO),
    S("star-4", 1536, 1010, 64, 64, MUSTARD),
    S("star-4", 150, 1180, 46, 46, MUSTARD),
    // round sticker
    C(1402, 478, 142, MUSTARD),
    O_RING(1402, 478, 122, INK),
    T("FREE\nENTRY", 1402 - 110, 478 - 60, 220, 52, { fontFamily: "Anton", color: INK, align: "center", lineHeight: 1.08, rotation: -12, letterSpacing: 40 }),
    // headline
    cond("NIGHT", M, 1090, W - M * 2, 400, { color: CREAM, align: "center", letterSpacing: 10 }),
    cond("MARKET", M, 1546, W - M * 2, 400, { color: INK, align: "center", letterSpacing: 10 }),
  ];
  // details
  cols.forEach((c, i) => {
    const x = M + i * (colW + 48);
    els.push(
      mono(c.k, x, 1958, colW, 26, { color: TOMATO, fontWeight: 700, letterSpacing: 220 }),
      cond(c.v, x, 1996, colW, 84, { lineHeight: 1.05 }),
      mono(c.s, x, 2098, colW, 27, { lineHeight: 1.3 }),
    );
    if (i > 0) els.push(vr(x - 24, 1958, 196, INK, 2));
  });
  els.push(
    hr(M, 2186, W - M * 2, INK, 4),
    mono("120+ FOOD STALLS  /  LIVE MUSIC  /  LOCAL MAKERS  /  LANTERN PARADE AT 9", M, 2208 - 6, W - M * 2, 26, { fontWeight: 700, letterSpacing: 90, align: "center" }),
  );
  return template(
    { slug: "night-market", name: "Golden Hour Night Market Poster", category: "poster", size: "poster", tags: ["event", "poster", "night market", "summer", "festival", "community", "outdoor", "food"], accent: TOMATO },
    [pg(photoBg("paper-cream"), els)],
  );
}

/** Outline circle helper local to the posters. */
function O_RING(cx: number, cy: number, r: number, color: string): DesignElement {
  return S("ellipse", cx - r, cy - r, r * 2, r * 2, null, { stroke: { color, width: 3, style: "dashed" } });
}

/* ------------------------------------------------------------------ */
/* 2. Music festival - Neon Horizon                                     */
/* ------------------------------------------------------------------ */

function neonHorizon(): Template {
  const WHITE = "#ffffff";
  const PINK = "#ff3ea5";
  const CYAN = "#3df2ff";
  const dim = "#c9b8ff";
  const cond = font("Anton", { color: WHITE, lineHeight: 0.92 });
  const mono = font("JetBrains Mono", { color: dim });
  const scene = synthScene(W, 1900, { horizon: 1380, sunR: 440, gridBottom: 1790, seed: 5 });
  const els: DesignElement[] = [
    G(scene, 0, 0, W, 1900),
    mono("SOUNDWAVE PRESENTS", M, 92, 800, 28, { fontWeight: 700, letterSpacing: 220, color: CYAN }),
    mono("VOL. 12", 928, 92, 704, 28, { fontWeight: 700, letterSpacing: 220, align: "right", color: CYAN }),
    hr(M, 148, W - M * 2, "#6f4fc9", 2),
    cond("NEON", M, 190, W - M * 2, 420, { align: "center", effect: { kind: "neon", color: PINK, intensity: 60 }, letterSpacing: 40 }),
    cond("HORIZON", M, 596, W - M * 2, 410, { align: "center", effect: { kind: "neon", color: CYAN, intensity: 55 }, letterSpacing: 20 }),
    // lineup
    mono("3 DAYS  /  4 STAGES  /  60 ARTISTS", M, 1836, W - M * 2, 26, { align: "center", letterSpacing: 260, fontWeight: 700, color: PINK }),
    cond("THE MIDNIGHT ORBIT  *  VIOLET STATIC", M, 1894, W - M * 2, 92, { align: "center", letterSpacing: 30 }),
    cond("CHROME HALO  *  KAIJU DISCO  *  LUNAR TIDES  *  NOVA RIOT", M, 2006, W - M * 2, 50, { align: "center", color: "#ffd9f2", letterSpacing: 40 }),
    mono("PALM CIRCUIT / DJ SABLE / ECHO PARK CHOIR / GLASS MERIDIAN / TOKYO BLUE HOUR / MARA VEGA / THE LONG DRIVE / SIDE B", M + 80, 2086, W - M * 2 - 160, 25, { align: "center", lineHeight: 1.5, letterSpacing: 60, color: "#b9a6f5" }),
    hr(M, 2170, W - M * 2, "#6f4fc9", 2),
    mono("JULY 23 - 25, 2027  /  CEDAR FLATS, AUSTIN TX", M, 2194, 1000, 26, { fontWeight: 700, letterSpacing: 120, color: WHITE }),
    mono("NEONHORIZON.FM", 1128, 2194, 504, 26, { fontWeight: 700, letterSpacing: 120, color: CYAN, align: "right" }),
  ];
  return template(
    { slug: "neon-horizon", name: "Neon Horizon Music Festival Poster", category: "poster", size: "poster", tags: ["music", "festival", "poster", "synthwave", "neon", "concert", "lineup", "night"], accent: PINK },
    [pg(gradientBg(180, "#0a0120", "#1c0646", "#2a0a5e", "#12032c"), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Minimalist exhibition poster - Quiet Objects                      */
/* ------------------------------------------------------------------ */

function quietObjects(): Template {
  const INK = "#1d1b19";
  const PAPER = "#efe9de";
  const WALL = "#e2d8c6";
  const CLAY = "#c4552e";
  const SAGE = "#8fa088";
  const CREAM = "#f7f1e5";
  const sans = font("Inter", { color: INK });
  const serif = font("Fraunces", { color: INK, lineHeight: 0.92 });
  const els: DesignElement[] = [
    sans("GALLERY VERSO", M, 92, 700, 26, { fontWeight: 700, letterSpacing: 240 }),
    sans("A SOLO EXHIBITION", 928, 92, 704, 26, { fontWeight: 700, letterSpacing: 240, align: "right" }),
    hr(M, 146, W - M * 2, INK, 2),
    // wall + composition
    R(M, 200, W - M * 2, 1030, WALL),
    C(676, 700, 320, CLAY),
    S("arch", 840, 450, 460, 700, SAGE),
    S("ellipse", 1005, 345, 320, 320, null, { stroke: { color: INK, width: 9, style: "solid" } }),
    C(540, 1040, 62, CREAM),
    S("half-circle", 1090, 950, 400, 200, INK, { rotation: 180 }),
    R(M, 1150, W - M * 2, 80, INK),
    vr(864, 200, 950, INK, 2, { opacity: 0.55 }),
    // title
    serif("Quiet", M - 8, 1262, W - M * 2, 380, { fontWeight: 300, letterSpacing: -20 }),
    serif("Objects", M - 8, 1592, W - M * 2, 380, { fontWeight: 300, italic: true, letterSpacing: -20, color: CLAY }),
    sans("New sculpture and works on paper by Mira Solenne, in clay, linen and found glass.", 1208, 1330, 424, 30, { lineHeight: 1.5, color: "#3a3631" }),
    // meta row
    hr(M, 2046, W - M * 2, INK, 2),
  ];
  const meta = [
    ["EXHIBITION", "10 September -", "28 November 2027"],
    ["OPENING", "Thursday 9 September", "6 - 9 pm, all welcome"],
    ["VISIT", "214 Wythe Avenue", "Brooklyn, New York"],
  ];
  meta.forEach((m, i) => {
    const x = M + i * 528;
    els.push(
      sans(m[0], x, 2076, 480, 22, { fontWeight: 700, letterSpacing: 240, color: CLAY }),
      sans(`${m[1]}\n${m[2]}`, x, 2114, 480, 29, { lineHeight: 1.4 }),
    );
  });
  return template(
    { slug: "quiet-objects", name: "Quiet Objects Exhibition Poster", category: "poster", size: "poster", tags: ["exhibition", "gallery", "art", "minimalist", "poster", "museum", "modern", "sculpture"], accent: CLAY },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Movie one-sheet - The Last Beacon                                 */
/* ------------------------------------------------------------------ */

function lastBeacon(): Template {
  const BG = "#04070d";
  const GOLD = "#f6d58b";
  const ICE = "#d6e2f5";
  const cin = font("Cinzel", { color: ICE });
  const osw = font("Oswald", { color: ICE });
  const scene = lighthouseScene(W, 1700, { x: 1130, baseY: 1450, topY: 760, rock: "#03050a" });
  const els: DesignElement[] = [
    ph("aurora-night", 0, 0, W, 1700, { fx: 0.42, tune: { contrast: 8, brightness: -8 } }),
    R(0, 0, W, 480, fade(180, "rgba(4,7,13,0.92)", "rgba(4,7,13,0)")),
    R(0, 1020, W, 700, fade(180, "rgba(4,7,13,0)", BG)),
    G(scene, 0, 0, W, 1700),
    osw("MARGARET HALVORSEN     DANIEL OKAFOR     ELI TANAKA", M, 108, W - M * 2, 38, { align: "center", letterSpacing: 300, fontWeight: 300, color: ICE }),
    hr(M + 300, 178, W - M * 2 - 600, "#5d7396", 2),
    osw("AND CATHERINE REYES", M, 206, W - M * 2, 28, { align: "center", letterSpacing: 420, fontWeight: 300, color: "#9fb2cf" }),
    cin("SOME LIGHTS ARE MEANT TO BE FOLLOWED", M, 1560, W - M * 2, 38, { align: "center", letterSpacing: 360, color: "#a8b9d6" }),
    cin("THE LAST", M, 1636, W - M * 2, 92, { align: "center", letterSpacing: 900, fontWeight: 400, color: ICE }),
    T("BEACON", M, 1728, W - M * 2, 318, {
      fontFamily: "Cinzel",
      fontWeight: 700,
      align: "center",
      letterSpacing: 40,
      lineHeight: 1,
      color: GOLD,
      gradient: { type: "linear", angle: 180, stops: [{ offset: 0, color: "#fff4d0" }, { offset: 0.55, color: "#f4cf7c" }, { offset: 1, color: "#b9803a" }] },
    }),
    cin("IN THEATERS DECEMBER 12", M, 2068, W - M * 2, 40, { align: "center", letterSpacing: 520, color: GOLD }),
    osw(
      "A NORTHLIGHT PICTURES PRODUCTION   IN ASSOCIATION WITH SALT & STONE FILMS   A FILM BY NOAH BRENNAN\n" +
        "MARGARET HALVORSEN  DANIEL OKAFOR  ELI TANAKA  CATHERINE REYES  THE LAST BEACON  CASTING BY RUTH ALDANA\n" +
        "MUSIC BY HENRIK SOLBERG  EDITED BY PRIYA NATARAJAN  PHOTOGRAPHED BY LEO MARCHETTI  WRITTEN BY TESS WYNN",
      M + 20,
      2142,
      W - M * 2 - 40,
      22,
      { align: "center", letterSpacing: 100, lineHeight: 1.42, fontWeight: 300, color: "#8497b6" },
    ),
  ];
  return template(
    { slug: "last-beacon", name: "The Last Beacon Movie Poster", category: "poster", size: "poster", tags: ["movie", "film", "poster", "cinematic", "one-sheet", "drama", "dark", "lighthouse"], accent: GOLD },
    [pg(BG, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 5. Motivational type poster - Start Before You Feel Ready            */
/* ------------------------------------------------------------------ */

function startBefore(): Template {
  const YELLOW = "#ffd60a";
  const INK = "#111111";
  const BLUE = "#2340ff";
  const PINK = "#ff4d8d";
  const X = 104;
  const GAP = 30;
  const SIZE = 420;
  const CAP = 0.859 * SIZE;
  const cond = font("Anton", { color: INK, lineHeight: 0.9 });
  const hand = font("Caveat", { color: INK, fontWeight: 600 });
  // Anton at line-height .9: cap top sits 0.0145em below the box top, baseline 0.8735em, cap height 0.859em
  const line = (text: string, capTop: number, o = {}) => cond(text, X, capTop - 0.0145 * SIZE, W - X - 60, SIZE, o);
  const tops = [0, 1, 2, 3].map((i) => 196 + i * (CAP + GAP));
  const bandTop = tops[3] + CAP + 30;
  const bandH = 2248 - bandTop;
  const readyTop = bandTop + (bandH - CAP) / 2;
  const noteY = tops[3] + (CAP - 3 * 96.6) / 2;
  const els: DesignElement[] = [
    frame(48, 48, W - 96, H - 96, INK, 8),
    hand("note to self, no. 14", X, 92, 700, 60),
    hand("(yes, today)", 1130, 92, 480, 60, { align: "right" }),
    line("START", tops[0]),
    line("BEFORE", tops[1]),
    line("YOU", tops[2]),
    line("FEEL", tops[3]),
    R(56, bandTop, W - 112, bandH, BLUE),
    line("READY.", readyTop, { color: YELLOW }),
    // sticker beside YOU
    C(1296, tops[2] + CAP / 2, 172, BLUE),
    T("NO MORE\nWAITING", 1296 - 150, tops[2] + CAP / 2 - 88, 300, 88, { fontFamily: "Anton", color: YELLOW, align: "center", lineHeight: 1.05, rotation: -12 }),
    S("star-4", 1130, tops[2] + 10, 64, 64, PINK),
    S("star-4", 1520, tops[2] + CAP - 90, 54, 54, PINK),
    S("star-4", 1250, tops[0] + 120, 110, 110, PINK),
    S("star-4", 1500, tops[0] + 40, 56, 56, YELLOW, { stroke: { color: INK, width: 5, style: "solid" } }),
    // handwritten note beside FEEL
    hand("progress beats\nperfect, every\nsingle time.", 904, noteY, 700, 92, { lineHeight: 1.05 }),
    gxw("doodles-underline-marker", 896, noteY + 96.6 + 78.6 - 8, 252, { colors: { "#ff5a5f": PINK } }),
  ];
  return template(
    { slug: "start-before", name: "Start Before You Feel Ready Type Poster", category: "poster", size: "poster", tags: ["motivational", "quote", "typography", "poster", "bold", "inspiration", "yellow", "office"], accent: YELLOW },
    [pg(YELLOW, els)],
  );
}

export const POSTER_TEMPLATES: Template[] = [nightMarket(), neonHorizon(), quietObjects(), lastBeacon(), startBefore()];

