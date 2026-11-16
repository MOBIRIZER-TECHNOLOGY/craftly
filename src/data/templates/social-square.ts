/** Instagram square (1080 x 1080) templates: sale, giveaway, grain quote, scrapbook collage. */
import type { DesignElement, Template } from "@/core/types";
import { C, F, L, O, P, R, RR, S, T, gradientBg, pg, patternBg, photoBg, template } from "./dsl";
import { RT, cardShadow, centered, gfx, hardShadow, icon, label, para, run, sparkle, tilt } from "./social-kit";

/* ------------------------------------------------------------------ */
/* 1. Midnight sale burst                                              */
/* ------------------------------------------------------------------ */

function midnightSale(): Template {
  const NAVY = "#0b0b3b";
  const YELLOW = "#ffe14d";
  const PINK = "#ff3d8b";
  const PINK_D = "#e0166f";
  const CYAN = "#5ef0ff";
  const DISPLAY = "Archivo Black";
  const SANS = "Montserrat";

  const page = pg(patternBg("grid", "#1b1b64", NAVY, 1.3), [
    S("ellipse", -180, 110, 1440, 960, { type: "radial", stops: [{ offset: 0, color: "rgba(255,61,139,0.42)" }, { offset: 1, color: "rgba(255,61,139,0)" }] }, { name: "Glow" }),
    RT([para(run("MIDNIGHT ", { color: "#ffffff" }), run("SALE", { color: CYAN }))], 40, 64, 1000, 94, { fontFamily: DISPLAY, align: "center", lineHeight: 1.05, name: "Headline" }),
    S("burst", 150 + 22, 190 + 22, 780, 780, PINK, { params: { points: 20, inner: 0.88 }, name: "Burst shadow" }),
    S("burst", 150, 190, 780, 780, YELLOW, { params: { points: 20, inner: 0.88 }, name: "Burst" }),
    centered("UP TO", 540, 388, 400, 46, { fontFamily: SANS, fontWeight: 800, letterSpacing: 240, color: NAVY, name: "Up to" }),
    T("50%", 90, 412, 900, 250, { fontFamily: DISPLAY, color: NAVY, align: "center", lineHeight: 0.92, name: "Discount" }),
    T("OFF", 90, 640, 900, 120, { fontFamily: DISPLAY, color: NAVY, align: "center", lineHeight: 1, name: "Off" }),
    RR(80, 790, 372, 82, 41, PINK_D, { rotation: -9, name: "Sticker", shadow: cardShadow("rgba(0,0,0,0.35)", 20, 10) }),
    centered("ONE NIGHT ONLY", 80 + 186, 790 + 41, 360, 34, { fontFamily: SANS, fontWeight: 800, letterSpacing: 80, color: "#ffffff", rotation: -9, name: "Sticker label" }),
    RR(-60, 944, 1200, 88, 0, YELLOW, { rotation: -2.5, name: "Ticker band" }),
    centered("FREE SHIPPING  •  ENDS SAT 6 AM  •  NO CODE", 540, 988, 1000, 36, { fontFamily: SANS, fontWeight: 800, letterSpacing: 60, color: NAVY, rotation: -2.5, name: "Ticker" }),
    sparkle(930, 214, 96, CYAN, { name: "Sparkle" }),
    sparkle(130, 330, 56, "#ffffff", { name: "Sparkle" }),
    sparkle(972, 760, 48, YELLOW, { name: "Sparkle" }),
    sparkle(86, 236, 40, PINK, { name: "Sparkle" }),
  ]);

  return template(
    { slug: "midnight-sale-burst", category: "social", size: "square", accent: "#17175f", tags: ["sale", "discount", "promo", "50% off", "burst", "navy", "retro", "shop", "square", "flash sale"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Pop giveaway                                                     */
/* ------------------------------------------------------------------ */

function popGiveaway(): Template {
  const INK = "#1d0b4b";
  const YELLOW = "#ffd84a";
  const MAGENTA_D = "#c9167a";
  const DISPLAY = "Fredoka";
  const SANS = "Nunito";

  const steps: Array<[string, string]> = [
    ["Follow us", "@brightbean.co"],
    ["Like and save", "this post"],
    ["Tag two friends", "who need a break"],
  ];

  const els: DesignElement[] = [
    C(990, 90, 250, "#ff7ac0", { opacity: 0.35, name: "Disc" }),
    C(40, 1040, 260, "#3a15c9", { opacity: 0.45, name: "Disc" }),
    T("GIVEAWAY", 72, 72, 936, 164, { fontFamily: DISPLAY, fontWeight: 700, color: "#ffffff", lineHeight: 1, letterSpacing: 80, effect: hardShadow(INK, 6), name: "Headline" }),
    T("Win a cozy weekend kit for you and a friend", 72, 246, 620, 44, { fontFamily: SANS, fontWeight: 900, color: "#ffffff", lineHeight: 1.18, name: "Prize" }),
    C(828, 580, 220, YELLOW, { name: "Prize backdrop" }),
    gfx("decor-confetti", 590, 300, 440, { name: "Confetti" }),
    gfx("celebration-gifts", 628, 400, 380, { name: "Gifts" }),
    S("scallop", 862, 286, 170, 170, "#ffffff", { rotation: 12, name: "Value sticker", shadow: cardShadow("rgba(30,10,90,0.35)", 24, 12) }),
    T("$250\nvalue", 862, 330, 170, 44, { fontFamily: DISPLAY, fontWeight: 700, color: MAGENTA_D, align: "center", lineHeight: 1.05, rotation: 12, name: "Value" }),
    RR(72, 392, 536, 500, 44, "#ffffff", { name: "Steps card", shadow: cardShadow("rgba(30,10,90,0.3)", 40, 20) }),
    label("How to enter", 112, 424, 440, 30, MAGENTA_D, { fontFamily: SANS, fontWeight: 900, letterSpacing: 200, name: "Steps heading" }),
  ];
  steps.forEach(([a, b], i) => {
    const y = 490 + i * 132;
    els.push(C(144, y + 52, 38, i === 0 ? "#5b2bff" : i === 1 ? "#8a2bd9" : "#c9167a", { name: "Step badge" }));
    els.push(centered(String(i + 1), 144, y + 52, 60, 40, { fontFamily: DISPLAY, fontWeight: 700, color: "#ffffff", name: `Step ${i + 1} number` }));
    els.push(T(a, 208, y + 10, 380, 40, { fontFamily: SANS, fontWeight: 900, color: INK, lineHeight: 1.1, name: `Step ${i + 1}` }));
    els.push(T(b, 208, y + 56, 380, 34, { fontFamily: SANS, fontWeight: 700, color: "#4b3a86", lineHeight: 1.1, name: `Step ${i + 1} detail` }));
  });
  els.push(
    RR(72, 934, 936, 88, 44, YELLOW, { name: "Banner" }),
    centered("Winner announced Friday at 6 PM", 540, 978, 900, 40, { fontFamily: SANS, fontWeight: 900, color: INK, name: "Banner text" }),
    sparkle(960, 868, 64, "#ffffff", { name: "Sparkle" }),
    sparkle(620, 330, 44, YELLOW, { name: "Sparkle" }),
  );

  return template(
    { slug: "pop-giveaway", category: "social", size: "square", accent: "#9a33e0", tags: ["giveaway", "contest", "win", "prize", "follow", "engagement", "gift", "playful", "square", "purple"] },
    [pg(gradientBg(135, "#5b2bff", "#ff3d9a"), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Quiet quote on grain                                             */
/* ------------------------------------------------------------------ */

function grainQuote(): Template {
  const INK = "#26231f";
  const SERIF = "Cormorant Garamond";
  const SANS = "Inter";
  const page = pg(patternBg("noise", "#7a7364", "#ebe5d8", 1), [
    O("rect", 48, 48, 984, 984, INK, 2, { opacity: 0.3, name: "Frame" }),
    T("Notes on craft  •  No. 07", 140, 104, 800, 26, { fontFamily: SANS, fontWeight: 600, letterSpacing: 280, textCase: "upper", color: "#4a453d", align: "center", name: "Eyebrow" }),
    L(540, 170, 540, 262, INK, 2, { opacity: 0.55, name: "Rule" }),
    T("Make it simple,\nthen make it quiet.", 90, 318, 900, 120, { fontFamily: SERIF, fontWeight: 600, italic: true, color: INK, align: "center", lineHeight: 1.1, name: "Quote" }),
    S("diamond", 532, 692, 16, 16, INK, { name: "Ornament" }),
    T("Noor Haddad", 240, 750, 600, 32, { fontFamily: SANS, fontWeight: 600, letterSpacing: 300, textCase: "upper", color: INK, align: "center", name: "Author" }),
    T("Ceramicist, Beirut", 240, 800, 600, 42, { fontFamily: SERIF, fontWeight: 600, italic: true, color: "#4a453d", align: "center", name: "Author role" }),
    L(450, 934, 630, 934, INK, 2, { opacity: 0.55, name: "Rule" }),
    T("@notesoncraft", 240, 958, 600, 28, { fontFamily: SANS, fontWeight: 500, letterSpacing: 120, color: "#4a453d", align: "center", name: "Handle" }),
  ]);
  return template(
    { slug: "grain-minimal-quote", category: "social", size: "square", accent: "#d9d2c3", tags: ["quote", "minimal", "grain", "texture", "serif", "neutral", "quiet", "square", "aesthetic", "stone"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Scrapbook behind-the-scenes collage                              */
/* ------------------------------------------------------------------ */

function scrapbookCollage(): Template {
  const INK = "#241c15";
  const TOMATO = "#d63f22";
  const TEAL = "#14696b";
  const MUSTARD = "#f2b632";
  const CREAM = "#fffdf8";
  const MARKER = "Permanent Marker";
  const HAND = "Caveat";

  /** Polaroid card (card + photo + caption + tape) turned as one piece about its centre. */
  const polaroid = (cx: number, cy: number, w: number, h: number, deg: number, photo: (x: number, y: number, s: number) => DesignElement, caption: string, tape: Record<string, string>): DesignElement[] => {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const inset = 20;
    const s = w - inset * 2;
    return tilt(
      [
        R(x, y, w, h, CREAM, { name: "Polaroid", shadow: { color: "rgba(40,25,10,0.3)", blur: 26, x: 0, y: 12 } }),
        photo(x + inset, y + inset, s),
        T(caption, x + 8, y + inset + s + 20, w - 16, 46, { fontFamily: HAND, fontWeight: 700, color: INK, align: "center", lineHeight: 1.1, name: "Caption" }),
        gfx("decor-washi-stripes", cx - 80, y - 26, 160, { name: "Tape", colors: tape, rotation: 0 }),
      ],
      cx,
      cy,
      deg,
    );
  };

  const page = pg(photoBg("paper-cream"), [
    gfx("doodles-brush-swoosh", 56, 204, 420, { name: "Highlight", colors: { "#ffc83d": MUSTARD, "#ffe9a8": "#f9d77a" } }),
    T("Behind the", 72, 66, 700, 104, { fontFamily: MARKER, color: INK, lineHeight: 1.0, name: "Headline" }),
    T("scenes", 72, 168, 700, 104, { fontFamily: MARKER, color: TOMATO, lineHeight: 1.0, name: "Headline accent" }),
    T("studio diary, week 12", 640, 104, 400, 50, { fontFamily: HAND, fontWeight: 700, color: TEAL, rotation: -4, lineHeight: 1.1, name: "Diary label" }),
    ...polaroid(206, 596, 320, 404, -5, (x, y, s) => F(x, y, s, s, "rect", { name: "Photo 1", stroke: { color: "#f2b632", width: 8, style: "solid" } }), "6 am, coffee first", { "#ffc4d6": "#f7d58a", "#ff9ab8": "#f2b632" }),
    ...polaroid(548, 572, 320, 404, 3, (x, y, s) => P("bokeh-gold", x, y, s, s, { name: "Photo 2", alt: "Warm golden lights out of focus" }), "Batch 14 (burnt)", { "#ffc4d6": "#b8e0dc", "#ff9ab8": "#7cc4bd" }),
    ...polaroid(866, 612, 320, 404, -3, (x, y, s) => F(x, y, s, s, "rect", { name: "Photo 3", stroke: { color: "#1f8a8a", width: 8, style: "solid" } }), "the whole crew", { "#ffc4d6": "#f3b3a6", "#ff9ab8": "#e8806b" }),
    T("Week 12: 600 cookies, 3 burnt trays,\n1 very happy team.", 72, 852, 930, 56, { fontFamily: HAND, fontWeight: 700, color: INK, lineHeight: 1.06, name: "Caption" }),
    icon("heart", 584, 914, 46, TOMATO, { stroke: 2.4, name: "Heart" }),
    T("@crumbandcompany", 640, 916, 344, 44, { fontFamily: HAND, fontWeight: 700, color: TEAL, align: "right", lineHeight: 1.1, name: "Handle" }),
  ]);

  return template(
    { slug: "scrapbook-behind-the-scenes", category: "social", size: "square", accent: "#e9dcc3", tags: ["behind the scenes", "collage", "polaroid", "photo frames", "scrapbook", "handwritten", "bakery", "square", "team", "diary"] },
    [page],
  );
}

export const SQUARE_TEMPLATES: Template[] = [midnightSale(), popGiveaway(), grainQuote(), scrapbookCollage()];

