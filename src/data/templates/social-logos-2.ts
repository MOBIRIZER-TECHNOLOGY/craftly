/** Four more logos (500 x 500): a boxed wordmark, an app tile, a script signature and a scalloped sticker. */
import type { Template } from "@/core/types";
import { C, R, RR, S, T, gradientBg, pg, template } from "./dsl";
import { group } from "./print-kit";
import { gfx, hardShadow } from "./social-kit";

/* ------------------------------------------------------------------ */
/* 5. Boxed wordmark: Kiln Works ceramics                              */
/* ------------------------------------------------------------------ */

function kilnWorks(): Template {
  const PAPER = "#f2ede4";
  const INK = "#1c1a17";
  const CLAY = "#b8492a";
  // Syne 700 sets KILN 2.716 em wide and WORKS 4.494 em wide: 89 px and 54 px make both lines 242 px
  const SYNE = "Syne";
  const page = pg(PAPER, [
    S("rect", 95, 61, 310, 310, null, { stroke: { color: INK, width: 10, style: "solid", join: "miter" }, name: "Frame" }),
    T("KILN", 128, 98, 264, 89, { fontFamily: SYNE, fontWeight: 700, color: INK, lineHeight: 1, name: "Wordmark, first line" }),
    T("WORKS", 128, 182, 264, 54, { fontFamily: SYNE, fontWeight: 700, color: INK, lineHeight: 1, name: "Wordmark, second line" }),
    R(128, 254, 243, 5, INK, { name: "Rule" }),
    C(142, 302, 14, CLAY, { name: "Dot" }),
    T("Hand-thrown", 168, 290, 200, 20, { fontFamily: "Manrope", fontWeight: 700, color: INK, lineHeight: 1.2, name: "Descriptor" }),
    T("Ceramics studio  ·  Est. 2014", 40, 408, 420, 16, { fontFamily: "Manrope", fontWeight: 700, letterSpacing: 300, textCase: "upper", color: INK, align: "center", lineHeight: 1.2, name: "Tagline" }),
  ]);
  return template(
    { slug: "kiln-works-boxed", category: "logo", size: "logo", accent: CLAY, tags: ["logo", "wordmark", "boxed", "frame", "ceramics", "studio", "craft", "bold", "minimal", "black"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 6. App tile: Tallybird                                              */
/* ------------------------------------------------------------------ */

function tallybird(): Template {
  const INK = "#141a3a";
  const FONT = "Plus Jakarta Sans";
  const page = pg("#f4f7ff", [
    RR(170, 84, 160, 160, 40, gradientBg(135, "#3a6bff", "#7b4dff"), { name: "App tile", shadow: { color: "rgba(58,80,220,0.28)", blur: 28, x: 0, y: 14 } }),
    group("Bars", [RR(205, 170, 24, 40, 8, "#ffffff"), RR(238, 144, 24, 66, 8, "#ffffff"), RR(271, 118, 24, 92, 8, "#ffd84d")]),
    T("tallybird", 30, 282, 440, 76, { fontFamily: FONT, fontWeight: 800, color: INK, align: "center", lineHeight: 1, letterSpacing: -30, name: "Wordmark" }),
    T("Budgets that add up", 40, 384, 420, 20, { fontFamily: FONT, fontWeight: 600, letterSpacing: 60, color: "#4b547a", align: "center", lineHeight: 1.2, name: "Tagline" }),
  ]);
  return template(
    { slug: "tallybird-app-tile", category: "logo", size: "logo", accent: "#5a5cff", tags: ["logo", "app", "icon", "tile", "fintech", "startup", "tech", "gradient", "modern", "blue"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Script signature: Wild Thyme                                     */
/* ------------------------------------------------------------------ */

function wildThyme(): Template {
  const BLUSH = "#f6e4de";
  const INK = "#3b2a2a";
  const GREEN = "#47623f";
  const page = pg(BLUSH, [
    gfx("nature-olive-branch", 196, 110, 108, { name: "Sprig" }),
    T("Wild Thyme", 20, 192, 460, 92, { fontFamily: "Satisfy", color: INK, align: "center", lineHeight: 1.15, name: "Signature" }),
    gfx("doodles-underline-marker", 150, 304, 200, { name: "Underline", colors: { "#ff5a5f": GREEN } }),
    T("Flowers and found objects", 30, 350, 440, 16, { fontFamily: "Josefin Sans", fontWeight: 600, letterSpacing: 320, textCase: "upper", color: GREEN, align: "center", lineHeight: 1.3, name: "Tagline" }),
    T("Wrenfield", 30, 388, 440, 15, { fontFamily: "Josefin Sans", fontWeight: 400, letterSpacing: 480, textCase: "upper", color: INK, align: "center", lineHeight: 1.3, name: "Place" }),
  ]);
  return template(
    { slug: "wild-thyme-signature", category: "logo", size: "logo", accent: BLUSH, tags: ["logo", "script", "signature", "florist", "handwritten", "boutique", "feminine", "blush", "botanical", "small business"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 8. Scalloped sticker: Summit Scoop ice cream                        */
/* ------------------------------------------------------------------ */

function summitScoop(): Template {
  const CREAM = "#fff4d6";
  const BERRY = "#c2305e";
  const DEEP = "#5b1730";
  const BUTTER = "#ffe9a8";
  const page = pg(CREAM, [
    S("scallop", 60, 30, 380, 380, BERRY, { name: "Sticker" }),
    S("ellipse", 94, 64, 312, 312, null, { stroke: { color: BUTTER, width: 2.5, style: "dashed" }, name: "Stitching" }),
    gfx("food-ice-cream", 206, 84, 88, { name: "Ice cream" }),
    T("Summit", 90, 208, 320, 76, { fontFamily: "Lobster", color: "#fff8ea", align: "center", lineHeight: 1.1, effect: hardShadow(DEEP, 4, 60), name: "Brand name" }),
    T("SCOOP", 90, 294, 320, 42, { fontFamily: "Bebas Neue", color: BUTTER, align: "center", letterSpacing: 420, lineHeight: 1, name: "Brand name, second line" }),
    T("Ice cream  ·  Since 2019", 40, 434, 420, 26, { fontFamily: "Bebas Neue", letterSpacing: 300, textCase: "upper", color: DEEP, align: "center", lineHeight: 1.1, name: "Descriptor" }),
  ]);
  return template(
    { slug: "summit-scoop-sticker", category: "logo", size: "logo", accent: BERRY, tags: ["logo", "sticker", "scallop", "ice cream", "dessert", "retro", "playful", "food", "pink", "shop"] },
    [page],
  );
}

export const LOGO_TEMPLATES_2: Template[] = [kilnWorks(), tallybird(), wildThyme(), summitScoop()];
