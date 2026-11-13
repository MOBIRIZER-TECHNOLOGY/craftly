/** Three more cards: a business card (336 x 192) and two greeting cards (576 x 384), each with a front and a second side. */
import type { DesignElement, Template } from "@/core/types";
import { C, RR, S, gradientBg, pg, template } from "./dsl";
import { font, frame, gxb, gxw, hr } from "./print-kit";

/* ------------------------------------------------------------------ */
/* 5. Motion Works physiotherapy - business card with appointment box   */
/* ------------------------------------------------------------------ */

function physioCard(): Template {
  const CLAY = "#ad3a24";
  const CLAY_L = "#bd4a33";
  const PAPER = "#f7f2ea";
  const INK = "#1f1b18";
  const sans = font("Outfit", { color: INK });
  const front: DesignElement[] = [
    // a letter far larger than the card, cut by its edges on purpose
    sans("M", 132, -34, 220, 250, { fontWeight: 800, color: CLAY_L, lineHeight: 1, align: "right", name: "bleed" }),
    C(31, 33, 7, PAPER),
    sans("Motion Works", 46, 24, 130, 15, { fontWeight: 700, color: PAPER, lineHeight: 1.2 }),
    sans("PHYSIOTHERAPY", 24, 142, 160, 9, { fontWeight: 600, letterSpacing: 300, color: PAPER }),
    sans("AND SPORTS MASSAGE", 24, 157, 160, 9, { fontWeight: 600, letterSpacing: 300, color: PAPER }),
  ];
  const back: DesignElement[] = [
    sans("Mika Tanabe", 24, 22, 180, 21, { fontWeight: 700, lineHeight: 1.15 }),
    sans("CHARTERED PHYSIOTHERAPIST", 24, 51, 180, 7.5, { fontWeight: 700, letterSpacing: 260, color: CLAY }),
    C(302, 34, 10, CLAY),
    RR(192, 92, 120, 78, 8, null, { stroke: { color: CLAY, width: 1, style: "solid" } }),
    sans("NEXT APPOINTMENT", 200, 100, 104, 7, { fontWeight: 700, letterSpacing: 220, color: CLAY }),
    hr(200, 134, 104, INK, 0.8),
    hr(200, 156, 104, INK, 0.8),
  ];
  ["555-0158", "mika@example.com", "motionworks.example.com", "2 Fern Road, Port Merrow"].forEach((r, i) => back.push(sans(r, 24, 100 + i * 17, 164, 9.5, { fontWeight: 500 })));
  return template(
    { slug: "physio-card", name: "Motion Works Physiotherapy Business Card", category: "card", size: "businessCard", tags: ["business card", "physiotherapy", "health", "clinic", "appointment", "minimal", "red", "front and back", "bold"], accent: CLAY },
    [pg(CLAY, front), pg(PAPER, back)],
  );
}

/* ------------------------------------------------------------------ */
/* 6. Thank-you greeting card                                           */
/* ------------------------------------------------------------------ */

function thankYouCard(): Template {
  const BUTTER = "#fff1c9";
  const CORAL = "#cf4326";
  const GREEN = "#2f6b4f";
  const INK = "#33261f";
  const script = font("Pacifico", { color: CORAL });
  const sans = font("Nunito", { color: INK });
  const front: DesignElement[] = [
    C(288, 468, 330, "#ffe39a"),
    gxb("nature-tulips", 44, 384, 118),
    gxb("nature-daisy", 418, 384, 120),
    gxb("nature-grass", 222, 384, 132),
    S("star-4", 96, 62, 22, 22, CORAL),
    S("star-4", 462, 92, 16, 16, GREEN),
    script("Thank you", 20, 62, 536, 92, { align: "center", lineHeight: 1.3 }),
    sans("SO VERY MUCH", 20, 232, 536, 14, { align: "center", fontWeight: 800, letterSpacing: 420, color: GREEN }),
  ];
  const inside: DesignElement[] = [
    script("Dear Wren,", 48, 40, 320, 30, { lineHeight: 1.4 }),
    sans("Thank you for the beautiful bowl, and for driving all that way to bring it. It already lives on the kitchen table, full of lemons.", 48, 102, 400, 17, { fontWeight: 600, lineHeight: 1.6 }),
    sans("With love,", 48, 226, 300, 17, { fontWeight: 600 }),
    script("Hattie", 48, 252, 300, 30, { color: GREEN, lineHeight: 1.4 }),
    gxb("nature-daisy", 446, 356, 84),
  ];
  return template(
    { slug: "thank-you-card", name: "Thank You Flowers Greeting Card", category: "card", size: "postcard", tags: ["greeting card", "thank you", "thanks", "flowers", "card", "note", "warm", "yellow", "front and inside"], accent: CORAL },
    [pg(BUTTER, front), pg("#fffaf0", inside)],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Winter greeting card                                              */
/* ------------------------------------------------------------------ */

function winterCard(): Template {
  const NIGHT = "#10233f";
  const SNOW = "#f4f7fb";
  const GOLD = "#f2c14e";
  const PINE = "#1f4d3d";
  const ICE = "#b7c9e2";
  const serif = font("Libre Baskerville", { color: SNOW });
  const sans = font("Lato", { color: ICE });
  const flakes: Array<[number, number, number]> = [
    [60, 50, 10],
    [150, 96, 6],
    [236, 40, 8],
    [330, 66, 6],
    [430, 44, 10],
    [520, 100, 7],
    [92, 190, 7],
    [496, 206, 8],
  ];
  const front: DesignElement[] = [
    C(478, 86, 30, GOLD),
    ...flakes.map(([x, y, s]) => S("star-4", x, y, s * 2, s * 2, SNOW, { opacity: 0.85 })),
    S("ellipse", 200, 304, 520, 200, "#dfe7f1"),
    gxw("nature-pine-trees", 396, 196, 150),
    S("ellipse", -120, 292, 520, 220, SNOW),
    sans("WARM WISHES FOR A", 40, 110, 496, 11, { align: "center", fontWeight: 700, letterSpacing: 400, color: GOLD }),
    serif("Quiet Winter", 30, 132, 516, 56, { align: "center", italic: true, lineHeight: 1.2 }),
    sans("AND A BRIGHT NEW YEAR", 40, 214, 496, 11, { align: "center", fontWeight: 700, letterSpacing: 400 }),
  ];
  const inside: DesignElement[] = [
    frame(14, 14, 548, 356, GOLD, 1.2),
    S("star-4", 276, 44, 24, 24, GOLD),
    serif("May your kettle be warm, your boots be dry and your evenings be long.", 78, 92, 420, 21, { align: "center", italic: true, color: NIGHT, lineHeight: 1.55 }),
    hr(264, 206, 48, GOLD, 1.5),
    sans("WITH LOVE FROM", 60, 228, 456, 10.5, { align: "center", fontWeight: 700, letterSpacing: 360, color: PINE }),
    serif("The Brandt Family", 60, 250, 456, 24, { align: "center", fontWeight: 700, color: NIGHT, lineHeight: 1.3 }),
    sans("12 Fern Road, December 2027", 60, 296, 456, 12.5, { align: "center", color: "#4b5d78" }),
  ];
  return template(
    { slug: "winter-greeting-card", name: "Quiet Winter Greeting Card", category: "card", size: "postcard", tags: ["greeting card", "winter", "holiday", "christmas", "new year", "season", "snow", "night", "card", "front and inside"], accent: NIGHT },
    [pg(gradientBg(180, NIGHT, "#1c3a63"), front), pg(SNOW, inside)],
  );
}

export const CARD_TEMPLATES_2: Template[] = [physioCard(), thankYouCard(), winterCard()];
