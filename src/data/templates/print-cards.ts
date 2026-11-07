/** Cards: three business cards (336 x 192, front + back) and one postcard (576 x 384, front + back). */
import type { DesignElement, Template } from "@/core/types";
import { C, R, RR, S, pg, template } from "./dsl";
import { diamond, fade, font, frame, gxw, hr, ph, vr } from "./print-kit";

/* ------------------------------------------------------------------ */
/* 1. Hale + Orr Architects                                             */
/* ------------------------------------------------------------------ */

function architectCard(): Template {
  const CHAR = "#161616";
  const GOLD = "#c4a15a";
  const GOLD_D = "#9a7a36";
  const PAPER = "#f4efe5";
  const INK = "#2a2a28";
  const serif = font("Cormorant Garamond", { color: GOLD });
  const sans = font("Montserrat", { color: INK });
  const front: DesignElement[] = [
    frame(14, 14, 308, 164, GOLD, 1),
    diamond(168, 46, 4, GOLD),
    serif("HALE + ORR", 24, 66, 288, 32, { align: "center", fontWeight: 600, letterSpacing: 200, lineHeight: 1.1 }),
    hr(118, 112, 100, GOLD, 1),
    sans("ARCHITECTS", 24, 126, 288, 8.5, { align: "center", color: "#d8d2c4", fontWeight: 600, letterSpacing: 700 }),
    sans("CHICAGO  *  EST. 2009", 24, 150, 288, 7, { align: "center", color: "#8f8a7c", fontWeight: 500, letterSpacing: 360 }),
  ];
  const back: DesignElement[] = [
    R(0, 0, 8, 192, GOLD),
    serif("Marcus Hale", 34, 28, 220, 28, { color: CHAR, fontWeight: 600, lineHeight: 1.1 }),
    sans("PRINCIPAL ARCHITECT, AIA", 36, 62, 220, 7.5, { color: GOLD_D, fontWeight: 700, letterSpacing: 300 }),
    hr(36, 82, 36, GOLD, 1.5),
    serif("H+O", 244, 26, 70, 22, { align: "right", fontWeight: 600, letterSpacing: 160, color: GOLD_D }),
  ];
  const rows: Array<[string, string]> = [
    ["T", "+1 (312) 555-0138"],
    ["E", "marcus@haleorr.studio"],
    ["W", "haleorr.studio"],
    ["A", "240 W Erie Street, Chicago, IL 60654"],
  ];
  rows.forEach(([k, v], i) => back.push(sans(k, 36, 102 + i * 18, 14, 7.5, { color: GOLD_D, fontWeight: 700 }), sans(v, 52, 101 + i * 18, 270, 9.5, { fontWeight: 500 })));
  return template(
    { slug: "architect-card", name: "Hale and Orr Architect Business Card", category: "card", size: "businessCard", tags: ["business card", "architect", "minimal", "gold", "dark", "elegant", "front and back", "professional"], accent: GOLD },
    [pg(CHAR, front), pg(PAPER, back)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Verdant floral studio                                             */
/* ------------------------------------------------------------------ */

function floralCard(): Template {
  const CREAM = "#f6efe3";
  const GREEN = "#2f4a38";
  const SAGE = "#7d9a82";
  const GOLD = "#d9c28a";
  const serif = font("Fraunces", { color: GREEN });
  const sans = font("Lato", { color: GREEN });
  const front: DesignElement[] = [
    C(286, 96, 116, "#e6dcc8"),
    gxw("nature-monstera", 196, 14, 170),
    serif("Verdant", 28, 54, 220, 46, { italic: true, fontWeight: 600, lineHeight: 1.1 }),
    sans("FLORAL STUDIO", 32, 112, 200, 8.5, { fontWeight: 700, letterSpacing: 520 }),
    hr(32, 132, 30, SAGE, 1.5),
    sans("Seasonal arrangements, weddings and events", 32, 142, 170, 9, { italic: true, color: "#4d6655", lineHeight: 1.4 }),
  ];
  const back: DesignElement[] = [
    gxw("nature-daisy", 236, 56, 130),
    serif("Lena Ortiz", 26, 28, 220, 26, { color: CREAM, fontWeight: 600, lineHeight: 1.1 }),
    sans("OWNER AND FLORAL DESIGNER", 28, 60, 220, 7.5, { color: GOLD, fontWeight: 700, letterSpacing: 300 }),
    hr(28, 80, 30, GOLD, 1.5),
  ];
  const rows = ["(503) 555-0127", "hello@verdantflorals.com", "@verdantflorals", "1180 SE Division Street\nPortland, OR 97202"];
  let y = 98;
  rows.forEach((r) => {
    back.push(sans(r, 28, y, 200, 9.5, { color: CREAM, lineHeight: 1.45 }));
    y += r.includes("\n") ? 32 : 18;
  });
  return template(
    { slug: "floral-card", name: "Verdant Floral Studio Business Card", category: "card", size: "businessCard", tags: ["business card", "florist", "botanical", "green", "nature", "wedding", "front and back", "organic"], accent: GREEN },
    [pg(CREAM, front), pg(GREEN, back)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Tidal creative studio                                             */
/* ------------------------------------------------------------------ */

function tidalCard(): Template {
  const NAVY = "#0e2a47";
  const ORANGE = "#ff7a45";
  const TEAL = "#2ec4b6";
  const SAND = "#f7f3ec";
  const grot = font("Space Grotesk", { color: "#ffffff" });
  const mono = font("Space Mono", { color: "#c7d3e3" });
  const front: DesignElement[] = [
    C(292, 170, 104, ORANGE),
    S("quarter-circle", 0, 0, 92, 92, TEAL, { flipV: true }),
    S("half-circle", 224, 8, 96, 48, "#ffd166"),
    grot("tidal", 26, 84, 230, 52, { fontWeight: 700, letterSpacing: -20, lineHeight: 1.05 }),
    mono("creative studio", 28, 140, 200, 9.5, { letterSpacing: 120 }),
  ];
  const back: DesignElement[] = [
    R(0, 0, 10, 64, TEAL),
    R(0, 64, 10, 64, ORANGE),
    R(0, 128, 10, 64, NAVY),
    grot("Jordan Reyes", 34, 26, 250, 22, { color: NAVY, fontWeight: 700, lineHeight: 1.1 }),
    mono("Creative Director", 36, 54, 250, 9.5, { color: "#3d5a7a", fontWeight: 700 }),
    grot("tidal", 220, 26, 94, 24, { color: NAVY, fontWeight: 700, align: "right", letterSpacing: -10, lineHeight: 1.1 }),
    C(310, 60, 5, ORANGE),
  ];
  const rows = ["+1 (415) 555-0194", "jordan@tidal.studio", "tidal.studio", "Pier 9, Suite 4, San Francisco"];
  rows.forEach((r, i) => back.push(mono(r, 36, 98 + i * 19, 280, 9.5, { color: NAVY })));
  return template(
    { slug: "tidal-card", name: "Tidal Creative Studio Business Card", category: "card", size: "businessCard", tags: ["business card", "creative", "agency", "geometric", "bold", "blue", "orange", "front and back"], accent: ORANGE },
    [pg(NAVY, front), pg(SAND, back)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Postcard: Greetings from Marlow Bay                               */
/* ------------------------------------------------------------------ */

function bayPostcard(): Template {
  const CREAM = "#fff4de";
  const CORAL = "#ff6b4a";
  const INK = "#23304a";
  const hand = font("Caveat", { color: INK });
  const block = font("Bungee", { color: CREAM });
  const front: DesignElement[] = [
    ph("tropical-beach", 0, 0, 576, 384, { fx: 0.5, fy: 0.6 }),
    R(0, 0, 576, 190, fade(180, "rgba(10,40,70,0.55)", "rgba(10,40,70,0)")),
    R(0, 250, 576, 134, fade(180, "rgba(10,40,70,0)", "rgba(10,40,70,0.62)")),
    hand("Greetings from", 36, 34, 504, 46, { align: "center", color: CREAM, fontWeight: 700, lineHeight: 1.1, effect: { kind: "shadow", color: "#0a2846", offset: 40, blur: 20, direction: 70, transparency: 40 } }),
    block("MARLOW BAY", 24, 80, 528, 70, {
      align: "center",
      lineHeight: 1.05,
      letterSpacing: 20,
      effect: { kind: "shadow", color: CORAL, offset: 60, direction: 55, blur: 0, transparency: 0 },
    }),
    S("star-4", 40, 160, 26, 26, CREAM),
    S("star-4", 486, 30, 20, 20, CREAM),
    block("EST. 1923  *  SUN, SAND AND SEAGLASS", 36, 338, 504, 11, { align: "center", letterSpacing: 160, effect: { kind: "shadow", color: "#0a2846", offset: 40, blur: 20, direction: 70, transparency: 30 } }),
  ];
  const back: DesignElement[] = [
    vr(300, 34, 316, "#c9b99a", 1.5),
    hand("Dear Grandma,", 36, 34, 240, 30, { fontWeight: 700 }),
    hand("The water here is so clear you can count your toes. We ate grilled fish on the pier and Mia found three perfect shells. Wish you were here!", 36, 74, 240, 22, { lineHeight: 1.35 }),
    hand("Love always, Ellie", 36, 270, 240, 26, { fontWeight: 700, color: CORAL }),
    RR(448, 34, 92, 108, 4, null, { stroke: { color: "#b6a684", width: 1.5, style: "dashed" } }),
    block("PLACE\nSTAMP\nHERE", 448, 66, 92, 11, { align: "center", color: "#b6a684", lineHeight: 1.5, letterSpacing: 60 }),
  ];
  for (let i = 0; i < 4; i++) back.push(hr(332, 194 + i * 27, 208, "#9a8d72", 1.2));
  back.push(
    hand("Mrs. Rosalind Pierce\n14 Larkspur Lane\nSpringfield, OH 45503", 334, 168, 206, 21, { lineHeight: 1.2857 }),
    block("MARLOW BAY", 332, 346, 208, 8, { align: "right", color: CORAL, letterSpacing: 200 }),
  );
  return template(
    { slug: "bay-postcard", name: "Greetings from Marlow Bay Postcard", category: "card", size: "postcard", tags: ["postcard", "travel", "beach", "greetings", "holiday", "vacation", "summer", "front and back"], accent: CORAL },
    [pg(CREAM, front), pg("#f8efdc", back)],
  );
}

export const CARD_TEMPLATES: Template[] = [architectCard(), floralCard(), tidalCard(), bayPostcard()];

