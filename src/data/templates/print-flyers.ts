/** Four flyers (816 x 1056): open house, workshop, bake sale, now hiring. */
import type { DesignElement, Template } from "@/core/types";
import { C, F, G, R, RR, S, T, pg, template } from "./dsl";
import { hazardStripes } from "./print-art";
import { diamond, fade, font, gxw, hr, leader, ph, ring, vr } from "./print-kit";

const W = 816;
const H = 1056;

/* ------------------------------------------------------------------ */
/* 1. Emerald Open House                                                */
/* ------------------------------------------------------------------ */

function emeraldOpenHouse(): Template {
  const EM = "#0b4435";
  const EM2 = "#0f5442";
  const GOLD = "#dcae57";
  const CREAM = "#f6f0e2";
  const MIST = "#b9d2c7";
  const serif = font("Playfair Display", { color: CREAM });
  const sans = font("DM Sans", { color: CREAM });
  const els: DesignElement[] = [
    ph("forest-mist", 0, 0, W, 560, { fx: 0.5, fy: 0.3 }),
    R(0, 0, W, 150, fade(180, "rgba(4,28,22,0.6)", "rgba(4,28,22,0)")),
    R(0, 320, W, 242, fade(180, "rgba(11,68,53,0)", EM)),
    sans("CEDAR RIDGE REALTY", 48, 46, 420, 15, { letterSpacing: 300, fontWeight: 700 }),
    RR(612, 34, 156, 38, 19, GOLD),
    sans("JUST LISTED", 612, 44, 156, 14, { align: "center", color: EM, fontWeight: 700, letterSpacing: 260 }),
    // title block
    sans("YOU'RE INVITED TO AN", 48, 470, 720, 16, { align: "center", color: GOLD, letterSpacing: 400, fontWeight: 700 }),
    serif("Open House", 48, 502, 720, 120, { align: "center", fontWeight: 700, lineHeight: 1 }),
    hr(150, 654, 230, GOLD, 2),
    diamond(408, 655, 8, GOLD),
    hr(436, 654, 230, GOLD, 2),
    serif("Sunday, June 6   |   1:00 - 4:00 PM", 48, 680, 720, 34, { align: "center", italic: true }),
    sans("1428 Alder Creek Lane, Bellevue, Washington", 48, 730, 720, 23, { align: "center", color: MIST }),
    // stats band
    RR(48, 784, 720, 98, 14, EM2),
  ];
  const stats = [
    ["4", "BEDROOMS"],
    ["3", "BATHROOMS"],
    ["2,640", "SQUARE FEET"],
    ["2", "CAR GARAGE"],
  ];
  stats.forEach(([v, l], i) => {
    const x = 48 + i * 180;
    els.push(
      serif(v, x, 794, 180, 44, { align: "center", fontWeight: 700, color: GOLD, lineHeight: 1.1 }),
      sans(l, x, 846, 180, 14, { align: "center", letterSpacing: 220, fontWeight: 600, color: MIST }),
    );
    if (i > 0) els.push(vr(x, 800, 66, GOLD, 1.5, { opacity: 0.45 }));
  });
  els.push(
    F(48, 912, 96, 96, "ellipse"),
    ring(96, 960, 49.5, GOLD, 3),
    serif("Marisol Vega", 164, 914, 300, 27, { fontWeight: 700 }),
    sans("Broker, Cedar Ridge Realty", 164, 948, 320, 18, { color: MIST }),
    sans("(425) 555-0142", 164, 974, 300, 22, { fontWeight: 700, color: GOLD }),
    sans("OFFERED AT", 468, 916, 300, 14, { align: "right", letterSpacing: 300, color: GOLD, fontWeight: 700 }),
    serif("$785,000", 468, 936, 300, 54, { align: "right", fontWeight: 700 }),
  );
  return template(
    { slug: "emerald-open-house", category: "flyer", size: "flyer", tags: ["open house", "real estate", "flyer", "property", "listing", "home", "emerald", "realtor"], accent: EM },
    [pg(EM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Hand-built ceramics workshop                                      */
/* ------------------------------------------------------------------ */

function ceramicsWorkshop(): Template {
  const CREAM = "#fbf1e6";
  const CLAY = "#c4553a";
  const BLUSH = "#f1c9b8";
  const SAGE = "#8aa28a";
  const INK = "#35211a";
  const SAND = "#e6d2bc";
  const serif = font("Fraunces", { color: INK });
  const sans = font("Work Sans", { color: INK });
  const els: DesignElement[] = [
    C(690, 98, 40, CLAY),
    S("arch", 56, 128, 200, 202, BLUSH),
    ph("terrazzo", 282, 58, 250, 272, { mask: "arch", zoom: 1.6 }),
    S("arch", 558, 160, 200, 170, SAGE),
    R(48, 330, 720, 5, INK),
    // title
    sans("SATURDAY WORKSHOP", 48, 376, 520, 16, { letterSpacing: 360, fontWeight: 700, color: CLAY }),
    serif("Hand-Built", 44, 404, 600, 100, { fontWeight: 700, lineHeight: 1 }),
    serif("Ceramics", 44, 502, 560, 100, { fontWeight: 600, italic: true, lineHeight: 1, color: CLAY }),
    // price sticker
    C(698, 568, 72, CLAY),
    S("scallop", 616, 486, 164, 164, null, { stroke: { color: CREAM, width: 3, style: "dashed" }, opacity: 0.9 }),
    T("$85", 620, 536, 156, 54, { fontFamily: "Fraunces", fontWeight: 700, color: CREAM, align: "center", lineHeight: 1, rotation: -8 }),
    T("PER PERSON", 620, 594, 156, 13, { fontFamily: "Work Sans", fontWeight: 700, color: CREAM, align: "center", letterSpacing: 200, rotation: -8 }),
    sans("A relaxed, beginner-friendly morning of pinch pots, coil vases and glazing. No experience needed.", 48, 664, 660, 24, { lineHeight: 1.5 }),
  ];
  const rows = [
    ["DATE", "Saturday, October 9"],
    ["TIME", "10:00 AM - 1:00 PM"],
    ["PLACE", "Fieldstone Clay Studio, 214 Mercer Street"],
    ["INCLUDES", "Clay, tools, glazes and two fired pieces"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 742 + i * 50;
    els.push(hr(48, y, 720, SAND, 2), sans(k, 48, y + 18, 150, 14, { letterSpacing: 300, fontWeight: 700, color: CLAY }), sans(v, 190, y + 12, 578, 24, { fontWeight: 500 }));
  });
  els.push(
    RR(48, 948, 720, 60, 30, CLAY),
    sans("Reserve your seat: fieldstoneclay.com/workshops", 48, 965, 720, 22, { align: "center", color: CREAM, fontWeight: 700 }),
  );
  return template(
    { slug: "ceramics-workshop", category: "flyer", size: "flyer", tags: ["workshop", "class", "ceramics", "pottery", "flyer", "craft", "studio", "terracotta"], accent: CLAY },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Sweet Saturdays bake sale                                         */
/* ------------------------------------------------------------------ */

function bakeSale(): Template {
  const PEACH = "#fff3ea";
  const BERRY = "#d6336c";
  const BERRY_D = "#8f1345";
  const BUTTER = "#ffe08a";
  const CHOC = "#4e2a21";
  const MINT = "#cdeee0";
  const head = font("Fredoka", { color: CHOC });
  const body = font("Nunito", { color: CHOC });
  const els: DesignElement[] = [R(0, 0, W, 346, BERRY)];
  for (let i = 0; i < 12; i++) els.push(C(34 + i * 68, 346, 34, BERRY));
  els.push(
    body("MAPLEWOOD COMMUNITY CENTER PRESENTS", 48, 56, 720, 15, { align: "center", color: "#ffd3e2", letterSpacing: 300, fontWeight: 800 }),
    head("Bake Sale", 48, 94, 720, 120, { align: "center", color: "#fff8f1", fontWeight: 700, lineHeight: 1.05, effect: { kind: "shadow", color: BERRY_D, offset: 45, direction: 60, blur: 0, transparency: 0 } }),
    head("Sweet Saturdays at the Lawn", 48, 238, 720, 36, { align: "center", color: BUTTER, fontWeight: 500 }),
    S("star-4", 108, 150, 36, 36, BUTTER),
    S("star-4", 700, 118, 28, 28, BUTTER),
    S("star-4", 668, 236, 22, 22, "#ffd3e2"),
    // date and place
    head("Saturday, October 16", 48, 398, 470, 44, { fontWeight: 600, color: BERRY }),
    body("9 AM to 1 PM", 48, 454, 470, 28, { fontWeight: 800 }),
    body("Maplewood Community Center lawn\n88 Linden Avenue, Portland", 48, 494, 470, 24, { lineHeight: 1.45, fontWeight: 600 }),
    // illustration cluster
    C(646, 484, 126, "#ffd9e4"),
    gxw("food-cupcake", 546, 394, 140),
    gxw("food-cake-slice", 640, 450, 126),
    gxw("food-croissant", 582, 520, 124),
    // price list
    head("Today's treats", 48, 618, 400, 38, { fontWeight: 600, color: BERRY }),
    hr(48, 668, 720, CHOC, 3),
  );
  const items: Array<[string, string, number]> = [
    ["Cupcakes", "$3", 108],
    ["Cinnamon rolls", "$4", 173],
    ["Fudge brownies", "$2.50", 181],
    ["Sourdough loaf", "$9", 177],
    ["Lemon tarts", "$3.50", 138],
    ["Cookies, by the dozen", "$8", 247],
  ];
  items.forEach(([n, p, nw], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 48 + col * 380;
    const y = 690 + row * 52;
    els.push(
      body(n, x, y, 262, 24, { fontWeight: 800 }),
      leader(x + nw + 12, x + 272, y + 26, BERRY, 2.2),
      head(p, x + 276, y - 1, 64, 25, { fontWeight: 600, color: BERRY, align: "right" }),
    );
  });
  els.push(
    RR(48, 868, 720, 100, 24, MINT),
    body("All proceeds support the Maplewood Library Fund. Come hungry, bring a friend and a tote bag!", 78, 886, 660, 24, { fontWeight: 700, lineHeight: 1.4, align: "center" }),
    body("Cash, cards and Venmo welcome  |  Questions? Call Dana at (503) 555-0187", 48, 992, 720, 20, { align: "center", fontWeight: 700, color: BERRY }),
  );
  return template(
    { slug: "sweet-saturdays-bake-sale", category: "flyer", size: "flyer", tags: ["bake sale", "fundraiser", "community", "flyer", "cupcakes", "pastry", "charity", "pink"], accent: BERRY },
    [pg(PEACH, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Now hiring                                                        */
/* ------------------------------------------------------------------ */

function nowHiring(): Template {
  const YELLOW = "#ffd400";
  const INK = "#111111";
  const WHITE = "#ffffff";
  const cond = font("Anton", { color: INK });
  const sans = font("Work Sans", { color: INK });
  const stripes = hazardStripes(W, 46, INK, YELLOW, 30);
  const els: DesignElement[] = [
    G(stripes, 0, 0, W, 46),
    sans("BRIGHTSIDE CAFE   /   EASTSIDE", 48, 82, 720, 16, { letterSpacing: 320, fontWeight: 700 }),
    cond("WE'RE", 44, 112, 500, 120, { lineHeight: 1 }),
    R(48, 246, 720, 142, INK),
    cond("HIRING!", 74, 256, 420, 120, { color: YELLOW, lineHeight: 1 }),
    sans("ALL ROLES\nALL SHIFTS\nSTART THIS MONTH", 506, 272, 250, 20, { color: WHITE, fontWeight: 800, letterSpacing: 90, lineHeight: 1.5 }),
    C(690, 140, 62, INK),
    T("PAID\nTRAINING", 628, 108, 124, 28, { fontFamily: "Anton", color: YELLOW, align: "center", lineHeight: 1.05, rotation: -10, letterSpacing: 40 }),
    sans("Join the friendliest crew on Eastside Avenue. We're growing and looking for warm, reliable people who love good coffee and good company.", 48, 424, 720, 24, { lineHeight: 1.5, fontWeight: 500 }),
  ];
  const jobs = [
    ["BARISTA", "Full and part time, morning and weekend shifts", "$18-22/HR + TIPS"],
    ["LINE COOK", "Full time, breakfast and lunch service", "$20-24/HR"],
    ["SHIFT LEAD", "Full time, 1+ year of café experience", "$22-26/HR"],
  ];
  jobs.forEach(([t, d, p], i) => {
    const y = 574 + i * 98;
    els.push(
      RR(48, y, 720, 86, 14, WHITE),
      cond(t, 72, y + 12, 330, 36, { lineHeight: 1.1 }),
      sans(d, 72, y + 52, 440, 18, { fontWeight: 500, lineHeight: 1.3 }),
      cond(p, 468, y + 24, 276, 32, { align: "right", lineHeight: 1.1 }),
    );
  });
  els.push(
    sans("FREE SHIFT MEALS  +  FLEXIBLE SCHEDULES  +  PAID TRAINING", 48, 874, 720, 17, { fontWeight: 800, letterSpacing: 120, align: "center" }),
    RR(48, 920, 720, 78, 14, INK),
    sans("APPLY TODAY", 74, 934, 300, 15, { color: YELLOW, fontWeight: 800, letterSpacing: 320 }),
    sans("jobs@brightsidecafe.com", 74, 960, 440, 26, { color: WHITE, fontWeight: 800 }),
    sans("(206) 555-0163\n412 Eastside Avenue", 500, 934, 244, 20, { color: WHITE, align: "right", fontWeight: 600, lineHeight: 1.4 }),
    G(stripes, 0, H - 46, W, 46),
  );
  return template(
    { slug: "now-hiring-brightside", category: "flyer", size: "flyer", tags: ["hiring", "jobs", "recruitment", "flyer", "careers", "cafe", "yellow", "bold"], accent: YELLOW },
    [pg(YELLOW, els)],
  );
}

export const FLYER_TEMPLATES: Template[] = [emeraldOpenHouse(), ceramicsWorkshop(), bakeSale(), nowHiring()];

