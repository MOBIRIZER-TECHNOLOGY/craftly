/** YouTube thumbnails (1280 x 720): face-less, huge type, arrows and high-contrast colour. */
import type { Template } from "@/core/types";
import { C, L, O, P, R, RR, S, T, patternBg, pg, template } from "./dsl";
import { RT, barFx, centered, gfx, hardShadow, outlineFx, para, run, sparkle, tilt } from "./social-kit";

/* ------------------------------------------------------------------ */
/* 1. Sugar-free challenge                                             */
/* ------------------------------------------------------------------ */

function sugarFree(): Template {
  const BLACK = "#0a0a0a";
  const RED = "#e5192e";
  const YELLOW = "#ffe23a";
  const FONT = "Anton";
  const page = pg(patternBg("dots", "#f4cb10", YELLOW, 1.8), [
    C(940, 372, 292, "#ffffff", { name: "Disc", stroke: { color: BLACK, width: 10, style: "solid" } }),
    gfx("food-cupcake", 940 - 200, 372 - 215, 400, { name: "Cupcake" }),
    O("ellipse", 940 - 262, 372 - 262, 524, 524, RED, 46, { name: "No symbol ring" }),
    L(940 - 185, 372 - 185, 940 + 185, 372 + 185, RED, 46, { name: "No symbol slash" }),
    T("I QUIT\nSUGAR", 64, 68, 620, 170, { fontFamily: FONT, color: BLACK, lineHeight: 1.04, name: "Headline" }),
    RR(64, 462, 520, 156, 22, BLACK, { name: "Bar" }),
    centered("30 DAYS", 324, 542, 480, 134, { fontFamily: FONT, color: YELLOW, lineHeight: 1, name: "Duration" }),
    gfx("arrows-block-right", 586, 486, 150, { name: "Arrow", colors: { "#d63c43": "#c4122a", "#ff5a5f": RED } }),
    ...tilt(
      [
        S("burst", 1044, 40, 200, 200, RED, { name: "Sticker" }),
        T("DAY\n30", 1044, 92, 200, 54, { fontFamily: FONT, color: "#ffffff", align: "center", lineHeight: 0.95, name: "Sticker label" }),
      ],
      1144,
      140,
      10,
    ),
  ]);
  return template(
    { slug: "sugar-free-yellow", category: "social", size: "youtube", accent: "#ffe23a", tags: ["youtube", "thumbnail", "challenge", "30 days", "yellow", "arrow", "no sugar", "health", "bold", "vlog"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Before / after makeover                                          */
/* ------------------------------------------------------------------ */

function glowUp(): Template {
  const FONT = "Archivo Black";
  const YELLOW = "#ffe23a";
  const page = pg("#111111", [
    P("concrete-gray", 0, 0, 640, 720, { name: "Before backdrop" }),
    R(0, 0, 640, 720, "#161616", { opacity: 0.4, name: "Before shade" }),
    P("mesh-sunrise", 640, 0, 640, 720, { name: "After backdrop" }),
    S("rect", 640, 0, 640, 720, { type: "radial", stops: [{ offset: 0, color: "rgba(255,255,255,0.25)" }, { offset: 1, color: "rgba(255,255,255,0)" }] }, { name: "After glow" }),
    gfx("objects-lamp", 84, 440, 230, { name: "Old lamp", opacity: 0.9, colors: { "#ffd23f": "#8d8d8d", "#2d3047": "#3b3b3b", "#22c1b2": "#6e6e6e", "#ffffff": "#b9b9b9", "#fff3dc": "#cfcfcf" } }),
    gfx("objects-plant-pot", 880, 440, 250, { name: "Plant" }),
    gfx("objects-lamp", 1110, 500, 150, { name: "New lamp" }),
    R(624, 0, 32, 720, "#ffffff", { name: "Divider" }),
    RR(64, 64, 250, 84, 16, "#161616", { name: "Before tag" }),
    centered("BEFORE", 189, 106, 240, 46, { fontFamily: FONT, color: "#ffffff", name: "Before label" }),
    RR(966, 64, 250, 84, 16, YELLOW, { name: "After tag" }),
    centered("AFTER", 1091, 106, 240, 46, { fontFamily: FONT, color: "#0a0a0a", name: "After label" }),
    RT([para(run("$200 ROOM", { color: "#ffffff" })), para(run("GLOW-UP", { color: YELLOW }))], 40, 192, 1200, 156, { fontFamily: FONT, align: "center", lineHeight: 1.0, effect: outlineFx("#000000", 80), name: "Headline" }),
    gfx("arrows-block-right", 520, 520, 240, { name: "Arrow", colors: { "#d63c43": "#e0a800", "#ff5a5f": YELLOW, "#ffb3b6": "#fff3a0" } }),
  ]);
  return template(
    { slug: "room-glow-up", category: "social", size: "youtube", accent: "#ff9a8a", tags: ["youtube", "thumbnail", "before after", "makeover", "diy", "home", "budget", "split", "arrow", "room"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Learn to code                                                    */
/* ------------------------------------------------------------------ */

function learnToCode(): Template {
  const FONT = "Bungee";
  const NEON = "#39ff88";
  const PINK = "#ff2d8f";
  const page = pg(patternBg("grid", "#1b1b3a", "#0a0a14", 1.4), [
    S("ellipse", 560, 20, 760, 680, { type: "radial", stops: [{ offset: 0, color: "rgba(57,255,136,0.32)" }, { offset: 1, color: "rgba(57,255,136,0)" }] }, { name: "Glow" }),
    gfx("tech-code-brackets", 680, 120, 520, { name: "Code window", rotation: 4 }),
    T("LEARN TO", 64, 64, 700, 112, { fontFamily: FONT, color: "#ffffff", lineHeight: 1.05, name: "Headline top" }),
    T("CODE", 64, 172, 700, 170, { fontFamily: FONT, color: NEON, lineHeight: 1.05, effect: hardShadow("#0a5a2c", 8), name: "Headline" }),
    T("IN 7 DAYS", 84, 384, 640, 110, { fontFamily: FONT, color: "#ffffff", lineHeight: 1.05, effect: barFx(PINK, 30, 40), name: "Duration" }),
    gfx("arrows-curved-hand", 520, 470, 220, { name: "Arrow", rotation: -20, colors: { "#cbd5e1": NEON, "#1f2937": NEON } }),
    ...tilt(
      [
        RR(70, 560, 460, 76, 38, "#ffe23a", { name: "Pill" }),
        centered("BEGINNER FRIENDLY", 300, 598, 440, 34, { fontFamily: FONT, color: "#0a0a14", name: "Pill label" }),
      ],
      300,
      598,
      -4,
    ),
    sparkle(1160, 100, 70, "#ffffff", { name: "Sparkle" }),
    sparkle(880, 600, 44, NEON, { name: "Sparkle" }),
  ]);
  return template(
    { slug: "learn-code-neon", category: "social", size: "youtube", accent: "#0a0a14", tags: ["youtube", "thumbnail", "coding", "tutorial", "tech", "neon", "programming", "beginner", "dark", "course"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Paradise travel vlog                                             */
/* ------------------------------------------------------------------ */

function paradiseVlog(): Template {
  const FONT = "Oswald";
  const YELLOW = "#ffe23a";
  const RED = "#ff2b3d";
  const page = pg("#0b4a63", [
    P("tropical-beach", 0, 0, 1280, 720, { name: "Beach photo", alt: "Palm fronds over a turquoise tropical beach" }),
    S("rect", 0, 0, 1280, 720, { type: "linear", angle: 90, stops: [{ offset: 0, color: "rgba(0,20,40,0.62)" }, { offset: 0.62, color: "rgba(0,20,40,0)" }] }, { name: "Left scrim" }),
    T("I FOUND", 64, 70, 760, 140, { fontFamily: FONT, fontWeight: 700, color: "#ffffff", lineHeight: 1.0, effect: outlineFx("#000000", 70), name: "Headline top" }),
    T("PARADISE", 64, 204, 860, 170, { fontFamily: FONT, fontWeight: 700, color: YELLOW, lineHeight: 1.0, effect: outlineFx("#000000", 60), name: "Headline" }),
    ...tilt(
      [
        C(1070, 240, 140, RED, { name: "Price sticker", stroke: { color: "#ffffff", width: 10, style: "solid" } }),
        T("$40", 930, 150, 280, 120, { fontFamily: FONT, fontWeight: 700, color: "#ffffff", align: "center", lineHeight: 1.0, name: "Price" }),
        T("A NIGHT", 930, 262, 280, 44, { fontFamily: FONT, fontWeight: 700, color: "#ffffff", align: "center", letterSpacing: 60, lineHeight: 1.0, name: "Price note" }),
      ],
      1070,
      240,
      8,
    ),
    gfx("arrows-block-curved", 660, 400, 250, { name: "Arrow", rotation: -10, colors: { "#7c3aed": YELLOW, "#b79bf7": "#fff3a0" } }),
    RR(64, 560, 560, 96, 20, "#000000", { opacity: 0.78, name: "Strip" }),
    T("FULL ISLAND GUIDE", 92, 586, 520, 46, { fontFamily: FONT, fontWeight: 700, letterSpacing: 60, color: "#ffffff", lineHeight: 1.1, name: "Strip label" }),
  ]);
  return template(
    { slug: "paradise-travel-vlog", category: "social", size: "youtube", accent: "#1aa7b8", tags: ["youtube", "thumbnail", "travel", "vlog", "beach", "price", "island", "arrow", "outline text", "adventure"] },
    [page],
  );
}

export const YOUTUBE_TEMPLATES: Template[] = [sugarFree(), glowUp(), learnToCode(), paradiseVlog()];

