/** Logo templates (500 x 500): wordmark, monogram, badge and abstract mark, each for a made-up brand. */
import type { Template } from "@/core/types";
import { C, L, O, S, T, pg, template } from "./dsl";
import { gfx } from "./social-kit";

/* ------------------------------------------------------------------ */
/* 1. Wordmark: Hearth & Honey bakery                                  */
/* ------------------------------------------------------------------ */

function hearthHoney(): Template {
  const BROWN = "#4a2a16";
  const AMBER = "#c27d12";
  const SERIF = "Fraunces";
  const SANS = "Manrope";
  const page = pg("#fbf3e4", [
    gfx("nature-wheat", 218, 66, 64, { name: "Wheat", colors: { "#d4a03c": AMBER } }),
    T("Hearth", 30, 148, 440, 104, { fontFamily: SERIF, fontWeight: 700, color: BROWN, align: "center", lineHeight: 1, letterSpacing: -20, name: "Wordmark" }),
    T("& Honey", 30, 256, 440, 62, { fontFamily: SERIF, fontWeight: 500, italic: true, color: AMBER, align: "center", lineHeight: 1, name: "Wordmark accent" }),
    L(150, 366, 222, 366, AMBER, 2, { name: "Rule" }),
    S("hexagon", 238, 354, 24, 24, AMBER, { name: "Hexagon" }),
    L(278, 366, 350, 366, AMBER, 2, { name: "Rule" }),
    T("Small-batch bakery", 40, 394, 420, 20, { fontFamily: SANS, fontWeight: 700, letterSpacing: 300, textCase: "upper", color: BROWN, align: "center", lineHeight: 1.2, name: "Tagline" }),
  ]);
  return template(
    { slug: "hearth-honey-wordmark", category: "logo", size: "logo", accent: "#f3dcae", tags: ["logo", "wordmark", "bakery", "serif", "honey", "cafe", "food", "warm", "typographic", "small business"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Monogram: Atelier Marlowe                                        */
/* ------------------------------------------------------------------ */

function marloweMonogram(): Template {
  const GOLD = "#d8b25a";
  const FONT = "Cinzel";
  const page = pg("#0f1c36", [
    O("ellipse", 104, 56, 292, 292, GOLD, 3, { name: "Outer ring" }),
    O("ellipse", 118, 70, 264, 264, GOLD, 1.5, { name: "Inner ring" }),
    T("AM", 104, 134, 292, 128, { fontFamily: FONT, fontWeight: 700, color: GOLD, align: "center", lineHeight: 1, letterSpacing: 20, name: "Monogram" }),
    S("diamond", 84, 194, 16, 16, GOLD, { name: "Ornament" }),
    S("diamond", 400, 194, 16, 16, GOLD, { name: "Ornament" }),
    L(206, 292, 294, 292, GOLD, 1.5, { name: "Rule" }),
    T("Atelier Marlowe", 30, 376, 440, 28, { fontFamily: FONT, fontWeight: 400, letterSpacing: 200, textCase: "upper", color: "#efe3c6", align: "center", lineHeight: 1.2, name: "Brand name" }),
    T("Est. 2009  ·  Lisbon", 30, 428, 440, 20, { fontFamily: FONT, fontWeight: 400, letterSpacing: 360, textCase: "upper", color: GOLD, align: "center", lineHeight: 1.2, name: "Descriptor" }),
  ]);
  return template(
    { slug: "marlowe-monogram", category: "logo", size: "logo", accent: "#0f1c36", tags: ["logo", "monogram", "initials", "luxury", "gold", "navy", "atelier", "fashion", "serif", "classic"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Badge: Harbor & Pine coffee roasters                             */
/* ------------------------------------------------------------------ */

function harborPineBadge(): Template {
  const FOREST = "#1f3d2f";
  const CREAM = "#f3ead7";
  const DISPLAY = "Bebas Neue";
  const SERIF = "Libre Baskerville";
  const page = pg(CREAM, [
    C(250, 250, 212, FOREST, { name: "Badge" }),
    O("ellipse", 250 - 194, 250 - 194, 388, 388, CREAM, 3, { name: "Outer ring" }),
    C(250, 250, 114, CREAM, { name: "Centre disc" }),
    O("ellipse", 250 - 122, 250 - 122, 244, 244, CREAM, 2, { name: "Inner ring" }),
    T("HARBOR & PINE", 50, 54, 400, 58, { fontFamily: DISPLAY, color: CREAM, align: "center", letterSpacing: 60, lineHeight: 1, curve: 60, name: "Top arc" }),
    T("COFFEE ROASTERS", 50, 352, 400, 40, { fontFamily: DISPLAY, color: CREAM, align: "center", letterSpacing: 100, lineHeight: 1, curve: -41, name: "Bottom arc" }),
    gfx("nature-pine-trees", 250 - 80, 250 - 96, 160, { name: "Pine trees" }),
    T("EST. 2016", 150, 308, 200, 22, { fontFamily: SERIF, fontWeight: 700, letterSpacing: 160, color: FOREST, align: "center", lineHeight: 1.2, name: "Established" }),
    S("star", 46, 232, 26, 26, CREAM, { name: "Star" }),
    S("star", 428, 232, 26, 26, CREAM, { name: "Star" }),
  ]);
  return template(
    { slug: "harbor-pine-badge", category: "logo", size: "logo", accent: "#1f3d2f", tags: ["logo", "badge", "emblem", "coffee", "roaster", "round", "circular text", "forest", "vintage", "craft"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Abstract mark: Quadra                                            */
/* ------------------------------------------------------------------ */

function quadraMark(): Template {
  const INK = "#17132e";
  const FONT = "Outfit";
  const T0 = 70;
  const page = pg("#f7f6fb", [
    S("quarter-circle", 154, T0, 92, 92, "#6c4bff", { name: "Tile violet" }),
    C(300, T0 + 46, 46, "#ffc83d", { name: "Tile yellow" }),
    C(200, T0 + 146, 46, "#ff5d73", { name: "Tile coral" }),
    S("quarter-circle", 254, T0 + 100, 92, 92, "#16c7b4", { flipH: true, flipV: true, name: "Tile teal" }),
    T("quadra", 50, 288, 400, 92, { fontFamily: FONT, fontWeight: 700, color: INK, align: "center", lineHeight: 1, letterSpacing: -20, name: "Wordmark" }),
    T("Design systems studio", 50, 396, 400, 22, { fontFamily: FONT, fontWeight: 500, letterSpacing: 200, textCase: "upper", color: "#6b6788", align: "center", lineHeight: 1.2, name: "Tagline" }),
  ]);
  return template(
    { slug: "quadra-abstract-mark", category: "logo", size: "logo", accent: "#e9e6f7", tags: ["logo", "abstract", "geometric", "bauhaus", "studio", "tech", "modern", "colorful", "icon", "design"] },
    [page],
  );
}

export const LOGO_TEMPLATES: Template[] = [hearthHoney(), marloweMonogram(), harborPineBadge(), quadraMark()];
