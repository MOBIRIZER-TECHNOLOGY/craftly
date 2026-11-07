/** Instagram portrait (1080 x 1350) templates: quote, product, recipe, Monday, testimonial, checklist. */
import type { Template } from "@/core/types";
import { C, F, L, O, P, RR, S, T, gradientBg, pg, patternBg, template } from "./dsl";
import { RT, cardShadow, centered, gfx, grain, icon, label, para, pill, run, sparkle, stars, tilt } from "./social-kit";

const W = 1080;
const H_ = 1350;

/* ------------------------------------------------------------------ */
/* 1. Peach quote card (2 pages)                                       */
/* ------------------------------------------------------------------ */

function peachQuoteCard(): Template {
  const CORAL = "#d4452a";
  const CORAL_D = "#b3361d";
  const PLUM = "#3a1a33";
  const CREAM = "#fff6ef";
  const SERIF = "DM Serif Display";
  const SANS = "DM Sans";

  const footer = (right: string, color: string) => [
    T("@littlemorningnotes", 96, 1228, 520, 34, { fontFamily: SANS, fontWeight: 600, color, name: "Handle" }),
    T(right, 700, 1228, 238, 34, { fontFamily: SANS, fontWeight: 600, color, align: "right", name: "Swipe label" }),
    icon("arrowRight", 944, 1230, 40, color, { stroke: 2.4, name: "Swipe arrow" }),
  ];

  const page1 = pg(gradientBg(160, "#ffeade", "#ffc6a4"), [
    S("blob-3", -190, -210, 640, 640, "#ffb089", { opacity: 0.55, name: "Soft blob" }),
    S("blob-6", 640, 950, 640, 640, "#ff9f78", { opacity: 0.45, name: "Soft blob" }),
    O("arch", 126, 180, 888, 1010, CORAL, 4, { name: "Arch outline" }),
    S("arch", 96, 150, 888, 1010, CREAM, { name: "Arch card", shadow: cardShadow("rgba(120,50,30,0.16)", 50, 24) }),
    gfx("decor-sparkles", 790, 150, 118, { name: "Sparkles", colors: { "#ffc233": "#f4a23a", "#ffe08a": "#ffd08a", "#ff8fab": "#ff8a73" } }),
    label("Sunday reset", 190, 236, 700, 30, CORAL_D, { align: "center", fontFamily: SANS, letterSpacing: 320, name: "Eyebrow" }),
    T("“", 340, 280, 400, 320, { fontFamily: SERIF, color: CORAL, align: "center", lineHeight: 1, name: "Decorative quote mark" }),
    T("Be gentle with the version of you that is still becoming.", 156, 540, 768, 90, { fontFamily: SERIF, color: PLUM, align: "center", lineHeight: 1.14, name: "Quote" }),
    L(480, 926, 600, 926, CORAL, 5, { name: "Rule" }),
    T("Maya Ellison", 156, 960, 768, 42, { fontFamily: SANS, fontWeight: 700, color: PLUM, align: "center", letterSpacing: 20, name: "Author" }),
    T("Writer, Little Morning Notes", 156, 1012, 768, 34, { fontFamily: SANS, color: "#7a4a47", align: "center", name: "Author role" }),
    ...footer("Swipe", "#8f2a15"),
    grain(W, H_, 0.05),
  ]);

  const page2 = pg(gradientBg(160, "#c63f1c", "#9e2b0d"), [
    S("blob-1", 620, -230, 720, 720, "#ff9a78", { opacity: 0.28, name: "Soft blob" }),
    S("blob-4", -260, 880, 700, 700, "#7d1f08", { opacity: 0.4, name: "Soft blob" }),
    O("arch", 96, 150, 888, 1010, "#ffd9c4", 4, { name: "Arch outline" }),
    gfx("decor-sparkles", 800, 150, 104, { name: "Sparkles", colors: { "#ffc233": "#ffd9a0", "#ffe08a": "#fff1d6", "#ff8fab": "#ffb7a3" } }),
    label("Part two", 190, 252, 700, 30, "#fff0e6", { align: "center", fontFamily: SANS, letterSpacing: 320, name: "Eyebrow" }),
    T("Save this for the day you forget how far you’ve come.", 156, 470, 768, 84, { fontFamily: SERIF, color: "#fff6ef", align: "center", lineHeight: 1.14, name: "Message" }),
    L(480, 876, 600, 876, "#ffd9c4", 5, { name: "Rule" }),
    ...pill("Save it", 150, 940, 244, 84, "#fff6ef", CORAL_D, 36, { font: SANS }),
    ...pill("Send it", 418, 940, 244, 84, null, "#fff6ef", 36, { font: SANS, stroke: "#fff6ef", strokeWidth: 3 }),
    ...pill("Follow", 686, 940, 244, 84, null, "#fff6ef", 36, { font: SANS, stroke: "#fff6ef", strokeWidth: 3 }),
    T("@littlemorningnotes", 96, 1228, 520, 34, { fontFamily: SANS, fontWeight: 600, color: "#ffd9c4", name: "Handle" }),
    T("New note every Sunday", 560, 1228, 424, 34, { fontFamily: SANS, fontWeight: 500, color: "#ffd9c4", align: "right", name: "Cadence" }),
    grain(W, H_, 0.06),
  ]);

  return template(
    { slug: "peach-quote-card", name: "Peach Quote Card", category: "social", size: "instagram", accent: "#ffc6a4", tags: ["quote", "instagram", "peach", "soft", "serif", "boho", "carousel", "inspiration", "aesthetic"] },
    [page1, page2],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Fernwood product spotlight                                       */
/* ------------------------------------------------------------------ */

function fernwoodSpotlight(): Template {
  const FOREST = "#1d3a2b";
  const SAGE = "#c9d8bc";
  const TERRA = "#b84a22";
  const CREAM = "#f4eee1";
  const PAPER = "#fffaf0";
  const SERIF = "Fraunces";
  const SANS = "Manrope";

  const page = pg(CREAM, [
    S("arch", 118, 150, 760, 780, SAGE, { name: "Arch backdrop" }),
    O("arch", 214, 204, 760, 780, FOREST, 3, { name: "Arch outline" }),
    gfx("nature-fern", 96, 66, 58, { name: "Fern mark", colors: { "#1f5a3e": FOREST, "#46b07a": "#5d8c63", "#2c8260": "#3f6b4a" } }),
    T("FERNWOOD", 166, 78, 420, 34, { fontFamily: SANS, fontWeight: 800, letterSpacing: 260, color: FOREST, name: "Brand" }),
    ...pill("New arrival", 744, 70, 240, 58, TERRA, PAPER, 30, { font: SANS, weight: 800 }),
    P("palm-leaves", 170, 180, 760, 780, { mask: "arch", name: "Product photo", alt: "Close-up of green palm fronds" }),
    ...tilt(
      [
        S("tag", 676, 782, 316, 180, TERRA, { flipH: true, name: "Price tag", shadow: cardShadow("rgba(30,20,10,0.3)", 26, 12) }),
        C(734, 872, 13, CREAM, { name: "Tag hole" }),
        centered("$38", 878, 872, 200, 96, { fontFamily: SERIF, fontWeight: 800, color: PAPER, name: "Price" }),
      ],
      834,
      872,
      -9,
    ),
    T("Areca Palm", 96, 1016, 888, 92, { fontFamily: SERIF, fontWeight: 700, color: FOREST, lineHeight: 1.05, name: "Product name" }),
    T("Pet safe  ·  32 in tall  ·  Free shipping", 96, 1130, 888, 36, { fontFamily: SANS, fontWeight: 600, color: "#46604f", name: "Details" }),
    RR(96, 1190, 360, 84, 42, FOREST, { name: "Button" }),
    centered("Shop the drop", 258, 1232, 300, 36, { fontFamily: SANS, fontWeight: 800, color: PAPER, name: "Button label" }),
    icon("arrowRight", 392, 1212, 40, PAPER, { stroke: 2.4, name: "Arrow" }),
    T("fernwood.co", 600, 1210, 384, 38, { fontFamily: SANS, fontWeight: 700, color: FOREST, align: "right", name: "Website" }),
    grain(W, H_, 0.05),
  ]);

  return template(
    { slug: "fernwood-plant-spotlight", name: "Fernwood Plant Spotlight", category: "social", size: "instagram", accent: "#c9d8bc", tags: ["product", "spotlight", "plant", "shop", "price tag", "new arrival", "instagram", "sage", "ecommerce"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Citrus olive-oil cake recipe (2 pages)                           */
/* ------------------------------------------------------------------ */

function citrusRecipe(): Template {
  const INK = "#2b1d14";
  const TOMATO = "#d8431e";
  const TOMATO_D = "#bf3515";
  const PAPER = "#fbf0dc";
  const SERIF = "Playfair Display";
  const SANS = "Work Sans";

  const stat = (n: string, caption: string, y: number) => [
    T(n, 96, y, 220, 100, { fontFamily: SERIF, fontWeight: 900, color: TOMATO_D, lineHeight: 1, name: `${caption} value` }),
    T(caption, 96, y + 114, 260, 32, { fontFamily: SANS, fontWeight: 700, letterSpacing: 160, textCase: "upper", color: INK, name: `${caption} label` }),
  ];

  const page1 = pg(PAPER, [
    T("The Sunday Table", 96, 84, 520, 30, { fontFamily: SANS, fontWeight: 800, letterSpacing: 220, textCase: "upper", color: INK, name: "Brand" }),
    T("Recipe No. 14", 600, 84, 384, 30, { fontFamily: SANS, fontWeight: 700, letterSpacing: 220, textCase: "upper", color: TOMATO_D, align: "right", name: "Recipe number" }),
    L(96, 146, 984, 146, INK, 3, { name: "Rule" }),
    RT([para(run("Citrus")), para(run("Olive-oil", { italic: true, color: TOMATO })), para(run("cake"))], 96, 186, 888, 176, { fontFamily: SERIF, fontWeight: 900, color: INK, lineHeight: 0.98, name: "Title" }),
    C(708, 982, 316, "#f2d6a2", { name: "Plate rim" }),
    C(708, 982, 262, "#fff8ea", { name: "Plate" }),
    O("ellipse", 708 - 232, 982 - 232, 464, 464, "#ecd0a0", 4, { name: "Plate ring" }),
    gfx("food-cake-slice", 708 - 250, 982 - 214, 500, { name: "Cake slice", colors: { "#ff6fa8": "#ffe27a", "#ff6b63": "#f58a2a", "#a96b3f": "#d9a05b" } }),
    gfx("food-lemon", 396, 668, 210, { rotation: -12, name: "Lemon" }),
    gfx("food-orange", 840, 1086, 200, { rotation: 10, name: "Orange" }),
    gfx("nature-olive-branch", 820, 690, 240, { rotation: 20, name: "Olive branch" }),
    ...stat("8", "servings", 744),
    ...stat("55", "minutes", 894),
    ...stat("1", "bowl", 1044),
    T("Swipe for the recipe", 96, 1240, 400, 34, { fontFamily: SANS, fontWeight: 700, color: INK, name: "Swipe label" }),
    icon("arrowRight", 440, 1242, 40, TOMATO_D, { stroke: 2.6, name: "Swipe arrow" }),
    grain(W, H_, 0.05),
  ]);

  const items = ["3 large eggs", "1 cup sugar", "¾ cup olive oil", "2 lemons, zested", "1 orange, juiced", "1½ cups flour"];
  const steps = ["Whisk the eggs and sugar until pale.", "Stream in the oil, then the juice.", "Fold in the flour and zest. Don’t overmix.", "Bake 40 min at 175 °C. Cool, then glaze."];

  const p2: Parameters<typeof pg>[1] = [
    RR(0, 0, W, 330, 0, TOMATO_D, { name: "Header band" }),
    T("Recipe No. 14", 96, 84, 520, 30, { fontFamily: SANS, fontWeight: 700, letterSpacing: 220, textCase: "upper", color: "#ffe9d2", name: "Recipe number" }),
    T("What you need", 96, 140, 888, 112, { fontFamily: SERIF, fontWeight: 900, color: "#fff6e8", lineHeight: 1, name: "Heading" }),
    RR(72, 290, 936, 330, 36, "#fffaf0", { name: "Ingredients card", shadow: cardShadow("rgba(80,40,10,0.2)", 40, 16) }),
  ];
  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 120 + col * 450;
    const y = 346 + row * 92;
    p2.push(C(x + 12, y + 28, 12, TOMATO, { name: "Bullet" }));
    p2.push(T(it, x + 40, y, 400, 40, { fontFamily: SANS, fontWeight: 600, color: INK, name: `Ingredient ${i + 1}` }));
  });
  p2.push(T("Method", 96, 668, 600, 64, { fontFamily: SERIF, fontWeight: 900, italic: true, color: TOMATO_D, lineHeight: 1, name: "Method heading" }));
  steps.forEach((st, i) => {
    const y = 770 + i * 118;
    p2.push(C(132, y + 36, 36, INK, { name: "Step badge" }));
    p2.push(centered(String(i + 1), 132, y + 36, 60, 38, { fontFamily: SERIF, fontWeight: 900, color: "#fff6e8", name: `Step ${i + 1} number` }));
    p2.push(T(st, 196, y, 788, 38, { fontFamily: SANS, fontWeight: 600, color: INK, lineHeight: 1.22, name: `Step ${i + 1}` }));
  });
  p2.push(T("Save it for Sunday", 96, 1240, 560, 34, { fontFamily: SANS, fontWeight: 700, color: TOMATO_D, name: "Save prompt" }));
  p2.push(T("@thesundaytable", 600, 1240, 384, 34, { fontFamily: SANS, fontWeight: 600, color: INK, align: "right", name: "Handle" }));
  p2.push(grain(W, H_, 0.05));
  const page2 = pg(PAPER, p2);

  return template(
    { slug: "citrus-recipe-card", name: "Citrus Cake Recipe Card", category: "social", size: "instagram", accent: "#f3d9a4", tags: ["recipe", "food", "cooking", "carousel", "cake", "baking", "cream", "instagram", "editorial"] },
    [page1, page2],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Cobalt Monday                                                    */
/* ------------------------------------------------------------------ */

function cobaltMonday(): Template {
  const COBALT = "#2335f5";
  const SUN = "#ffd93d";
  const NAVY = "#0b1380";
  const page = pg(patternBg("dots", "#3a4bff", COBALT, 1.5), [
    O("ellipse", -560, 840, 2200, 1100, "#5f6dff", 3, { name: "Ring" }),
    O("ellipse", -380, 960, 1840, 880, "#8d98ff", 3, { name: "Ring" }),
    S("ellipse", -300, 1040, 1680, 740, SUN, { name: "Sun" }),
    ...pill("Monday motivation", 72, 96, 430, 64, null, "#ffffff", 30, { font: "Inter", weight: 800, stroke: "#ffffff", strokeWidth: 3, spacing: 120, upper: true }),
    RT(
      [para(run("START")), para(run("BEFORE")), para(run("YOU’RE")), para(run("READY.", { color: SUN }))],
      72,
      196,
      936,
      196,
      { fontFamily: "Anton", color: "#ffffff", lineHeight: 0.96, name: "Headline" },
    ),
    S("scallop", 764, 80, 236, 236, SUN, { rotation: 12, name: "Week sticker" }),
    T("WEEK\n32", 764, 150, 236, 70, { fontFamily: "Anton", color: NAVY, align: "center", lineHeight: 1.0, rotation: 12, name: "Week label" }),
    gfx("objects-clock", 662, 470, 330, { rotation: 10, name: "Alarm clock" }),
    sparkle(972, 520, 70, "#ffffff", { name: "Sparkle" }),
    sparkle(640, 880, 52, SUN, { name: "Sparkle" }),
    T("The first draft is allowed to be messy. Open the doc anyway.", 190, 1086, 700, 46, { fontFamily: "Inter", fontWeight: 800, color: NAVY, align: "center", lineHeight: 1.22, name: "Message" }),
    T("@hustleandharbor  ·  Mondays at 8 AM", 140, 1236, 800, 34, { fontFamily: "Inter", fontWeight: 700, color: NAVY, align: "center", name: "Handle" }),
  ]);
  return template(
    { slug: "cobalt-monday", name: "Cobalt Monday Motivation", category: "social", size: "instagram", accent: "#2335f5", tags: ["monday", "motivation", "quote", "bold", "blue", "yellow", "sunrise", "instagram", "workweek"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 5. Violet testimonial bubble                                        */
/* ------------------------------------------------------------------ */

function violetTestimonial(): Template {
  const INK = "#1c1540";
  const page = pg(gradientBg(160, "#6a4bff", "#4a2de0"), [
    C(960, 130, 230, "#8a73ff", { opacity: 0.45, name: "Disc" }),
    C(40, 1260, 280, "#3a1fc4", { opacity: 0.55, name: "Disc" }),
    ...pill("Loved by 12,000+ teams", 96, 86, 500, 64, null, "#ffffff", 30, { font: "Plus Jakarta Sans", weight: 800, stroke: "#ffffff", strokeWidth: 3, spacing: 100, upper: true }),
    S("speech", 72, 210, 936, 780, "#ffffff", { name: "Speech bubble", shadow: cardShadow("rgba(20,8,90,0.35)", 50, 24) }),
    ...stars(5, 132, 270, 76, 14, "#ffb400"),
    T("”", 760, 250, 200, 240, { fontFamily: "Lora", fontWeight: 700, color: "#e3dbff", align: "right", lineHeight: 1, name: "Decorative quote mark" }),
    T("We replaced three tools and two freelancers with one tab. Our feed finally looks like one brand.", 132, 392, 816, 66, { fontFamily: "Lora", fontWeight: 600, italic: true, color: INK, lineHeight: 1.26, name: "Testimonial" }),
    F(140, 1018, 156, 156, "ellipse", { name: "Customer photo", alt: "Customer portrait", stroke: { color: "#ffffff", width: 8, style: "solid" } }),
    T("Priya Raman", 330, 1054, 640, 48, { fontFamily: "Plus Jakarta Sans", fontWeight: 800, color: "#ffffff", name: "Customer name" }),
    T("Head of Brand, Lumen Coffee", 330, 1112, 640, 34, { fontFamily: "Plus Jakarta Sans", fontWeight: 500, color: "#e4dcff", name: "Customer role" }),
    T("4.9 average rating from 2,300 reviews", 72, 1226, 936, 34, { fontFamily: "Plus Jakarta Sans", fontWeight: 700, color: "#ffffff", align: "center", name: "Rating note" }),
  ]);
  return template(
    { slug: "violet-review-bubble", name: "Violet Review Bubble", category: "social", size: "instagram", accent: "#5b3df5", tags: ["testimonial", "review", "stars", "customer", "feedback", "social proof", "violet", "speech bubble", "instagram"] },
    [page],
  );
}

/* ------------------------------------------------------------------ */
/* 6. Mint tip checklist (2 pages)                                     */
/* ------------------------------------------------------------------ */

function mintChecklist(): Template {
  const INK = "#0d0d0d";
  const MINT = "#c7f4da";
  const PINK = "#ff8fc7";
  const FONT = "Space Grotesk";
  const MONO = "Space Mono";

  const hardCard = (x: number, y: number, w: number, h: number, r: number, fill: string, d = 12) => [
    RR(x + d, y + d, w, h, r, INK, { name: "Shadow" }),
    RR(x, y, w, h, r, fill, { stroke: { color: INK, width: 5, style: "solid" }, name: "Card" }),
  ];

  const page1 = pg(MINT, [
    ...hardCard(96, 92, 330, 76, 38, "#ffffff", 8),
    centered("Tip of the day", 261, 130, 310, 30, { fontFamily: MONO, fontWeight: 700, color: INK, textCase: "upper", letterSpacing: 60, name: "Tag" }),
    T("Sleep better tonight.", 96, 240, 700, 170, { fontFamily: FONT, fontWeight: 700, color: INK, lineHeight: 0.98, letterSpacing: -20, name: "Headline" }),
    C(816 + 14, 206 + 14, 168, INK, { name: "Shadow" }),
    C(816, 206, 168, PINK, { stroke: { color: INK, width: 5, style: "solid" }, name: "Moon disc" }),
    gfx("nature-moon-stars", 696, 86, 240, { name: "Moon" }),
    ...hardCard(96, 860, 888, 250, 36, "#ffffff", 14),
    T("5 tiny habits", 144, 896, 800, 70, { fontFamily: FONT, fontWeight: 700, color: INK, name: "Card title" }),
    T("that help you fall asleep faster and wake up lighter.", 144, 982, 790, 38, { fontFamily: FONT, fontWeight: 500, color: "#2a2a2a", lineHeight: 1.28, name: "Card text" }),
    RR(96 + 8, 1170 + 8, 520, 96, 28, INK, { name: "Shadow" }),
    RR(96, 1170, 520, 96, 28, "#ffe14d", { stroke: { color: INK, width: 5, style: "solid" }, name: "Button" }),
    T("Swipe for the checklist", 128, 1196, 420, 34, { fontFamily: FONT, fontWeight: 700, color: INK, name: "Button label" }),
    icon("arrowRight", 540, 1198, 44, INK, { stroke: 2.6, name: "Arrow" }),
    T("@calmcraft.club", 660, 1204, 324, 34, { fontFamily: MONO, fontWeight: 700, color: INK, align: "right", name: "Handle" }),
  ]);

  const rows = ["Dim lights after 9 pm", "Keep the room at 18 °C", "Phone out of reach", "Same wake-up time", "No caffeine after 2 pm"];
  const p2: Parameters<typeof pg>[1] = [
    T("Tonight’s checklist", 96, 96, 888, 92, { fontFamily: FONT, fontWeight: 700, color: INK, letterSpacing: -20, name: "Heading" }),
    T("Tick them off before 10 pm.", 96, 200, 888, 40, { fontFamily: MONO, fontWeight: 700, color: INK, name: "Subheading" }),
  ];
  rows.forEach((text, i) => {
    const y = 300 + i * 168;
    p2.push(...hardCard(96, y, 888, 140, 30, "#ffffff", 12));
    p2.push(RR(132, y + 30, 80, 80, 20, i === 0 ? "#ffe14d" : PINK, { stroke: { color: INK, width: 5, style: "solid" }, name: "Checkbox" }));
    p2.push(icon("check", 146, y + 44, 52, INK, { stroke: 3.2, name: "Check" }));
    p2.push(T(text, 244, y + 48, 700, 42, { fontFamily: FONT, fontWeight: 700, color: INK, name: `Tip ${i + 1}` }));
  });
  p2.push(T("Save it for tonight", 96, 1204, 560, 38, { fontFamily: FONT, fontWeight: 700, color: INK, name: "Save prompt" }));
  p2.push(icon("bookmark", 520, 1204, 44, INK, { stroke: 2.6, name: "Bookmark" }));
  p2.push(T("@calmcraft.club", 660, 1208, 324, 34, { fontFamily: MONO, fontWeight: 700, color: INK, align: "right", name: "Handle" }));
  const page2 = pg(MINT, p2);

  return template(
    { slug: "mint-tip-checklist", name: "Mint Tip Checklist", category: "social", size: "instagram", accent: "#c7f4da", tags: ["tip", "checklist", "habits", "carousel", "brutalist", "mint", "sleep", "wellness", "instagram"] },
    [page1, page2],
  );
}

export const IG_TEMPLATES: Template[] = [peachQuoteCard(), fernwoodSpotlight(), citrusRecipe(), cobaltMonday(), violetTestimonial(), mintChecklist()];

