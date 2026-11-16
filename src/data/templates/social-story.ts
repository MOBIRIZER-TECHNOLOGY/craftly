/** Instagram story (1080 x 1920) templates: night market event, plank challenge, countdown, travel postcard. */
import type { DesignElement, Template } from "@/core/types";
import { C, O, P, RR, S, T, gradientBg, patternBg, pg, template } from "./dsl";
import { RT, cardShadow, centered, gfx, icon, para, run, softShadow, sparkle, tilt } from "./social-kit";

/* ------------------------------------------------------------------ */
/* 1. Rooftop night market (event)                                     */
/* ------------------------------------------------------------------ */

function nightMarket(): Template {
  const LIME = "#d4ff3a";
  const NAVY = "#140a30";
  const MONO = "Space Mono";
  const DISPLAY = "Bricolage Grotesque";
  const FADE = "#1c0e42";

  const detail = (y: number, ic: "clock" | "pin" | "music", text: string): DesignElement[] => [
    icon(ic, 72, y - 4, 56, LIME, { stroke: 2, name: `${ic} icon` }),
    T(text, 156, y, 860, 38, { fontFamily: MONO, fontWeight: 700, color: "#ffffff", lineHeight: 1.2, name: text }),
  ];

  const page = pg(gradientBg(180, NAVY, "#1f0f48"), [
    C(890, 330, 210, "#ffe9b0", { opacity: 0.08, name: "Moon glow" }),
    P("city-night", 0, 1380, 1080, 540, { name: "Skyline photo", alt: "City skyline at night under a purple sky" }),
    S("rect", 0, 1380, 1080, 260, { type: "linear", angle: 180, stops: [{ offset: 0, color: FADE }, { offset: 1, color: "rgba(28,14,66,0)" }] }, { name: "Skyline fade" }),
    T("Summer series  •  night 03", 72, 256, 760, 30, { fontFamily: MONO, fontWeight: 700, letterSpacing: 140, textCase: "upper", color: LIME, name: "Eyebrow" }),
    RT([para(run("ROOFTOP")), para(run("NIGHT", { color: LIME })), para(run("MARKET"))], 72, 316, 936, 190, { fontFamily: DISPLAY, fontWeight: 800, color: "#ffffff", lineHeight: 0.93, name: "Headline" }),
    S("scallop", 790, 470, 214, 214, LIME, { rotation: 10, name: "Date sticker", shadow: cardShadow("rgba(0,0,0,0.4)", 30, 14) }),
    T("14", 790, 490, 214, 116, { fontFamily: DISPLAY, fontWeight: 800, color: NAVY, align: "center", lineHeight: 1, rotation: 10, name: "Date day" }),
    T("SAT JUN", 790, 598, 214, 32, { fontFamily: MONO, fontWeight: 700, color: NAVY, align: "center", letterSpacing: 40, lineHeight: 1.1, rotation: 10, name: "Date month" }),
    ...detail(932, "clock", "6 PM until late"),
    ...detail(1044, "pin", "Pier 9 Rooftop, Brooklyn"),
    ...detail(1156, "music", "40 makers + live jazz + street food"),
    RR(72, 1272, 470, 112, 56, LIME, { name: "Button" }),
    centered("RSVP free", 72 + 200, 1272 + 56, 360, 46, { fontFamily: DISPLAY, fontWeight: 800, color: NAVY, name: "Button label" }),
    icon("arrowRight", 72 + 380, 1272 + 36, 40, NAVY, { stroke: 2.6, name: "Arrow" }),
    T("link in bio", 580, 1306, 428, 38, { fontFamily: MONO, fontWeight: 700, color: "#ffffff", align: "right", name: "Link note" }),
    sparkle(930, 262, 64, "#ffffff", { name: "Sparkle" }),
    sparkle(820, 860, 40, LIME, { name: "Sparkle" }),
    sparkle(980, 1010, 56, "#ffffff", { name: "Sparkle" }),
  ]);

  return template(
    { slug: "rooftop-night-market", category: "social", size: "story", accent: "#2b1360", tags: ["event", "announcement", "night market", "story", "party", "date", "rsvp", "lime", "purple", "city"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Plank challenge (fitness)                                        */
/* ------------------------------------------------------------------ */

function plankChallenge(): Template {
  const LIME = "#c8ff2e";
  const ORANGE = "#ff5a1f";
  const DISPLAY = "Bebas Neue";
  const SANS = "Inter";
  const weeks: Array<[string, string, number]> = [
    ["WEEK 1", "20 sec", 0.25],
    ["WEEK 2", "45 sec", 0.5],
    ["WEEK 3", "90 sec", 0.75],
    ["WEEK 4", "2 min", 1],
  ];

  const els: DesignElement[] = [
    S("parallelogram", -70, 246, 640, 84, LIME, { name: "Ribbon" }),
    T("NEW CHALLENGE", 64, 268, 400, 36, { fontFamily: SANS, fontWeight: 900, letterSpacing: 160, color: "#0a0a0a", lineHeight: 1.1, name: "Ribbon label" }),
    S("plus", 900, 270, 56, 56, ORANGE, { name: "Plus" }),
    S("plus", 980, 340, 32, 32, LIME, { name: "Plus" }),
    T("30", 64, 330, 520, 600, { fontFamily: DISPLAY, color: LIME, lineHeight: 0.84, name: "Day count" }),
    RT([para(run("DAY")), para(run("PLANK")), para(run("CHALLENGE", { color: ORANGE }))], 560, 430, 450, 118, { fontFamily: DISPLAY, color: "#ffffff", lineHeight: 0.98, name: "Headline" }),
    T("No equipment. No excuses. 5 minutes a day.", 72, 904, 936, 40, { fontFamily: SANS, fontWeight: 600, color: "#d6d6d6", lineHeight: 1.25, name: "Tagline" }),
    T("YOUR 4-WEEK RAMP", 72, 1010, 700, 64, { fontFamily: DISPLAY, color: LIME, letterSpacing: 40, lineHeight: 1, name: "Plan heading" }),
  ];
  weeks.forEach(([week, time, share], i) => {
    const y = 1110 + i * 100;
    els.push(T(week, 72, y, 200, 58, { fontFamily: DISPLAY, color: "#ffffff", lineHeight: 1, letterSpacing: 40, name: `${week} label` }));
    els.push(RR(280, y + 14, 520, 30, 15, "#2a2a2a", { name: "Bar track" }));
    els.push(RR(280, y + 14, Math.round(520 * share), 30, 15, share === 1 ? ORANGE : LIME, { name: `${week} bar` }));
    els.push(T(time, 820, y + 6, 188, 38, { fontFamily: SANS, fontWeight: 800, color: "#ffffff", align: "right", lineHeight: 1.1, name: `${week} time` }));
  });
  els.push(
    RR(72, 1560, 936, 124, 26, ORANGE, { name: "Button" }),
    centered("JOIN FREE  •  LINK IN BIO", 540, 1622, 900, 70, { fontFamily: DISPLAY, color: "#0a0a0a", letterSpacing: 40, lineHeight: 1, name: "Button label" }),
  );

  return template(
    { slug: "plank-challenge-black", category: "social", size: "story", accent: "#161616", tags: ["fitness", "challenge", "workout", "gym", "30 day", "plank", "story", "neon", "black", "training"] },
    [pg(patternBg("diagonal", "#161616", "#0a0a0a", 1), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Launch countdown                                                 */
/* ------------------------------------------------------------------ */

function launchCountdown(): Template {
  const PLUM = "#24106b";
  const YELLOW = "#ffe45e";
  const DISPLAY = "Syne";
  const SANS = "DM Sans";
  const days: Array<[string, string]> = [
    ["TUE", "today"],
    ["WED", "teaser"],
    ["THU", "preview"],
    ["FRI", "the drop"],
  ];

  const els: DesignElement[] = [
    C(920, 330, 300, "#ff8a9a", { opacity: 0.22, name: "Disc" }),
    C(100, 1560, 360, "#1e0f6b", { opacity: 0.4, name: "Disc" }),
    RR(320, 252, 440, 66, 33, "rgba(36,16,107,0.55)", { stroke: { color: "#ffffff", width: 3, style: "solid" }, name: "Pill" }),
    centered("Launch countdown", 540, 285, 420, 28, { fontFamily: SANS, fontWeight: 800, letterSpacing: 200, textCase: "upper", color: "#ffffff", name: "Pill label" }),
    T("03", 40, 350, 1000, 430, { fontFamily: DISPLAY, fontWeight: 800, align: "center", lineHeight: 0.95, color: "#ffffff", gradient: gradientBg(180, "#ffffff", YELLOW), name: "Days left" }),
    T("DAYS TO GO", 40, 788, 1000, 92, { fontFamily: DISPLAY, fontWeight: 800, color: "#ffffff", align: "center", lineHeight: 1.05, name: "Headline" }),
    T("The Salt & Sun summer collection drops Friday at 9 AM.", 150, 960, 780, 44, { fontFamily: SANS, fontWeight: 600, color: "#ffffff", align: "center", lineHeight: 1.3, name: "Message" }),
  ];
  days.forEach(([day, sub], i) => {
    const x = 73 + i * 242;
    const today = i === 0;
    const drop = i === 3;
    els.push(RR(x, 1236, 208, 156, 40, today ? "#ffffff" : drop ? YELLOW : null, { stroke: today || drop ? null : { color: "#ffffff", width: 3, style: "solid" }, name: `${day} chip` }));
    els.push(centered(day, x + 104, 1290, 200, 38, { fontFamily: DISPLAY, fontWeight: 800, color: today || drop ? PLUM : "#ffffff", name: `${day} label` }));
    els.push(centered(sub, x + 104, 1348, 200, 32, { fontFamily: SANS, fontWeight: 700, color: today || drop ? PLUM : "#ffffff", name: `${day} note` }));
  });
  els.push(
    RR(150, 1486, 780, 116, 58, "#ffffff", { name: "Button", shadow: cardShadow("rgba(20,5,80,0.35)", 30, 14) }),
    icon("bell", 214, 1522, 44, PLUM, { stroke: 2.2, name: "Bell" }),
    T("Tap to set a reminder", 282, 1520, 600, 42, { fontFamily: SANS, fontWeight: 800, color: PLUM, lineHeight: 1.2, name: "Button label" }),
    sparkle(960, 960, 64, YELLOW, { name: "Sparkle" }),
    sparkle(120, 420, 44, "#ffffff", { name: "Sparkle" }),
    sparkle(180, 1120, 36, YELLOW, { name: "Sparkle" }),
  );

  return template(
    { slug: "launch-countdown-dusk", category: "social", size: "story", accent: "#8a2fb8", tags: ["countdown", "launch", "coming soon", "days left", "reminder", "story", "gradient", "teaser", "drop", "product"] },
    [pg(gradientBg(160, "#2a1a8a", "#8a2fb8", "#ff5f6d"), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Travel postcard                                                  */
/* ------------------------------------------------------------------ */

function travelPostcard(): Template {
  const TEAL = "#0a7d83";
  const INK = "#0d2a3a";
  const SCRIPT = "Dancing Script";
  const SANS = "Montserrat";

  const stamp = tilt(
    [
      RR(786, 236, 200, 244, 6, "#fffdf6", { name: "Stamp", stroke: { color: "#fffdf6", width: 12, style: "dotted" }, shadow: { color: "rgba(0,0,0,0.3)", blur: 20, x: 0, y: 10 } }),
      P("sunset-hills", 806, 256, 160, 160, { name: "Stamp picture" }),
      T("70c", 806, 426, 160, 36, { fontFamily: SANS, fontWeight: 800, color: INK, align: "right", lineHeight: 1.1, name: "Stamp value" }),
    ],
    886,
    358,
    7,
  );

  const page = pg("#0b4a63", [
    P("tropical-beach", 0, 0, 1080, 1920, { name: "Beach photo", alt: "Palm fronds over a turquoise tropical beach", crop: { x: -0.14, y: 0, w: 2.667, h: 1 } }),
    S("rect", 0, 0, 1080, 900, { type: "linear", angle: 180, stops: [{ offset: 0, color: "rgba(6,38,66,0.8)" }, { offset: 0.5, color: "rgba(6,38,66,0.58)" }, { offset: 1, color: "rgba(6,38,66,0)" }] }, { name: "Top scrim" }),
    T("Greetings from", 72, 232, 700, 110, { fontFamily: SCRIPT, fontWeight: 700, color: "#ffffff", lineHeight: 1.05, effect: softShadow("#05223a", 30, 40), name: "Greeting" }),
    T("ZANZIBAR", 72, 348, 760, 100, { fontFamily: SANS, fontWeight: 800, color: "#ffffff", letterSpacing: 40, lineHeight: 1.05, effect: softShadow("#05223a", 30, 40), name: "Place" }),
    ...stamp,
    O("ellipse", 770, 414, 132, 132, "#ffffff", 5, { opacity: 0.9, name: "Postmark ring" }),
    gfx("dividers-wavy", 836, 470, 240, { rotation: -6, name: "Postmark waves", opacity: 0.95, colors: { "#5b8def": "#ffffff" } }),
    RR(64, 1150, 952, 540, 56, "#ffffff", { name: "Caption card", shadow: cardShadow("rgba(3,30,50,0.4)", 50, 24) }),
    gfx("travel-map-pin", 108, 1064, 120, { name: "Pin" }),
    T("Island-hopping guide", 120, 1200, 760, 30, { fontFamily: SANS, fontWeight: 800, letterSpacing: 160, textCase: "upper", color: TEAL, name: "Eyebrow" }),
    T("7 days, 3 islands, zero alarm clocks.", 120, 1256, 840, 60, { fontFamily: SANS, fontWeight: 800, color: INK, lineHeight: 1.16, name: "Title" }),
    T("Where to stay, what to eat and how to hop between them.", 120, 1448, 840, 36, { fontFamily: SANS, fontWeight: 500, color: "#3f5668", lineHeight: 1.4, name: "Description" }),
    RR(120, 1570, 470, 84, 42, TEAL, { name: "Button" }),
    T("Read the guide", 156, 1594, 340, 36, { fontFamily: SANS, fontWeight: 700, color: "#ffffff", lineHeight: 1.2, name: "Button label" }),
    icon("arrowRight", 522, 1592, 40, "#ffffff", { stroke: 2.4, name: "Arrow" }),
    icon("bookmark", 896, 1590, 48, TEAL, { stroke: 2.2, name: "Save icon" }),
  ]);

  return template(
    { slug: "zanzibar-travel-postcard", category: "social", size: "story", accent: "#0a7d83", tags: ["travel", "postcard", "beach", "vacation", "story", "guide", "holiday", "tropical", "stamp", "photo"] },
    [page],
  );
}

export const STORY_TEMPLATES: Template[] = [nightMarket(), plankChallenge(), launchCountdown(), travelPostcard()];
