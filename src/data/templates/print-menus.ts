/** Three menus (816 x 1056): trattoria, cafe, cocktail bar. */
import type { DesignElement, Template } from "@/core/types";
import { C, G, R, RR, photoBg, pg, template } from "./dsl";
import { decoFan } from "./print-art";
import { diamond, font, frame, gxw, hr, vr } from "./print-kit";

const W = 816;
const H = 1056;

/* ------------------------------------------------------------------ */
/* 1. Osteria Lucia - trattoria menu                                    */
/* ------------------------------------------------------------------ */

function trattoria(): Template {
  const GREEN = "#243f2e";
  const RED = "#b0402b";
  const INK = "#2b2a26";
  const GREY = "#5f5a50";
  const head = font("Playfair Display", { color: GREEN });
  const sans = font("Lato", { color: GREY });
  const els: DesignElement[] = [
    frame(28, 28, W - 56, H - 56, GREEN, 2),
    frame(36, 36, W - 72, H - 72, GREEN, 0.8),
    gxw("nature-olive-branch", 58, 62, 104, { flipH: true }),
    gxw("nature-olive-branch", 654, 62, 104),
    sans("TRATTORIA   *   EST. 1998", 0, 64, W, 13, { align: "center", letterSpacing: 420, fontWeight: 700, color: RED }),
    head("Osteria Lucia", 0, 88, W, 70, { align: "center", fontWeight: 700, lineHeight: 1.1 }),
    sans("Handmade pasta and wood-fired classics from the kitchen of Lucia Ferraro", 0, 170, W, 15, { align: "center", italic: true }),
    hr(76, 208, W - 152, GREEN, 1.5),
    diamond(408, 209, 6, RED),
  ];
  type Item = [string, string, string];
  const CW = 316;
  const section = (title: string, x: number, y: number, items: Item[]): number => {
    els.push(head(title, x, y, CW, 15, { fontWeight: 700, letterSpacing: 360, color: RED }), hr(x, y + 28, CW, GREEN, 1));
    let cy = y + 46;
    items.forEach(([n, d, p]) => {
      els.push(head(n, x, cy, CW - 52, 21.5, { fontWeight: 600, color: INK, lineHeight: 1.2 }), head(p, x + CW - 52, cy, 52, 21.5, { align: "right", fontWeight: 600, color: RED, lineHeight: 1.2 }), sans(d, x, cy + 30, CW, 14.5, { lineHeight: 1.35 }));
      cy += 82;
    });
    return cy;
  };
  const L = 76;
  const R_ = 424;
  let ly = 236;
  ly = section("ANTIPASTI", L, ly, [
    ["Burrata e Pesche", "Burrata, roasted peaches, basil oil", "16"],
    ["Carpaccio di Manzo", "Thin-sliced beef, arugula, parmigiano", "17"],
    ["Arancini", "Saffron risotto balls, fontina, pomodoro", "12"],
    ["Zuppa del Giorno", "Soup of the day, grilled country bread", "10"],
  ]);
  section("PRIMI", L, ly + 6, [
    ["Tagliatelle al Ragù", "House-made pasta, slow-cooked beef ragù", "22"],
    ["Cacio e Pepe", "Spaghetti, pecorino romano, black pepper", "19"],
    ["Gnocchi ai Funghi", "Potato gnocchi, wild mushrooms, sage", "21"],
  ]);
  let ry = 236;
  ry = section("SECONDI", R_, ry, [
    ["Pollo alla Cacciatora", "Braised chicken, olives, rosemary potatoes", "27"],
    ["Branzino al Forno", "Roasted sea bass, fennel, salsa verde", "32"],
    ["Bistecca Fiorentina", "28 oz T-bone for two, rosemary, sea salt", "78"],
    ["Melanzane Parmigiana", "Layered eggplant, mozzarella, basil", "21"],
  ]);
  section("DOLCI", R_, ry + 6, [
    ["Tiramisù", "Mascarpone, espresso, cocoa", "11"],
    ["Panna Cotta", "Vanilla bean, seasonal berry compote", "10"],
    ["Affogato", "Vanilla gelato drowned in hot espresso", "9"],
  ]);
  els.push(
    vr(W / 2 - 0.75, 240, 668, "#c9c2ae", 1.5),
    hr(76, 948, W - 152, GREEN, 1.5),
    sans("Please tell us about any allergies. Gluten-free pasta is available on request.", 76, 962, W - 152, 12.5, { align: "center" }),
    head("412 Alder Street, Portland   *   (503) 555-0141", 76, 988, W - 152, 15.5, { align: "center", fontWeight: 600, color: RED, lineHeight: 1.2 }),
  );
  return template(
    { slug: "trattoria", category: "menu", size: "menu", tags: ["menu", "restaurant", "italian", "trattoria", "dinner", "elegant", "olive", "pasta"], accent: GREEN },
    [pg(photoBg("paper-cream"), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Maple & Mug - cafe menu                                           */
/* ------------------------------------------------------------------ */

function cafe(): Template {
  const CREAM = "#fbf3e4";
  const BROWN = "#4a2c1d";
  const MAPLE = "#c2652b";
  const MUSTARD = "#e8b44a";
  const GREY = "#6b5646";
  const head = font("Fraunces", { color: BROWN });
  const sans = font("Work Sans", { color: BROWN });
  const els: DesignElement[] = [
    R(0, 0, W, 232, BROWN),
    C(716, 66, 182, "#5a3827"),
    gxw("food-coffee-beans", 618, 28, 150),
    gxw("food-croissant", 560, 112, 104),
    sans("CAFE AND BAKERY", 56, 58, 400, 14, { color: MUSTARD, letterSpacing: 520, fontWeight: 700 }),
    head("Maple & Mug", 52, 84, 500, 76, { color: CREAM, fontWeight: 700, italic: true, lineHeight: 1.05 }),
    sans("Small-batch roasts, bakery-fresh pastries and an all-day brunch.", 56, 176, 470, 17, { color: "#e9d7bc", lineHeight: 1.4 }),
  ];
  const rowH = 36;
  const list = (title: string, x: number, y: number, w: number, rows: Array<[string, string]>, note?: string): number => {
    els.push(head(title, x, y, w, 25, { fontWeight: 700, lineHeight: 1.1, color: MAPLE }), R(x, y + 38, 40, 4, MUSTARD));
    let cy = y + 58;
    rows.forEach(([n, p]) => {
      els.push(sans(n, x, cy, w - 70, 18, { fontWeight: 500 }), sans(p, x + w - 70, cy, 70, 18, { align: "right", fontWeight: 700, color: MAPLE }), hr(x, cy + 29, w, "#e4d3b7", 1));
      cy += rowH;
    });
    if (note) {
      els.push(sans(note, x, cy + 2, w, 13.5, { color: GREY, lineHeight: 1.4 }));
      cy += 40;
    }
    return cy;
  };
  const LX = 56;
  const CW = 328;
  const RX = 432;
  let y = list("Espresso Bar", LX, 272, CW, [
    ["Espresso", "3.25"],
    ["Americano", "3.75"],
    ["Cappuccino", "4.75"],
    ["Flat White", "4.95"],
    ["Latte", "5.25"],
    ["Maple Cinnamon Latte", "5.95"],
    ["Mocha", "5.75"],
  ], "Oat, almond or soy milk +0.75");
  list("Brewed and Iced", LX, y + 8, CW, [
    ["Drip Coffee", "3.00"],
    ["Pour Over", "4.50"],
    ["Cold Brew", "4.75"],
    ["Chai Latte", "5.25"],
    ["Matcha Latte", "5.75"],
  ]);
  y = list("From the Oven", RX, 272, CW, [
    ["Butter Croissant", "3.75"],
    ["Almond Croissant", "4.50"],
    ["Blueberry Muffin", "3.50"],
    ["Cinnamon Roll", "4.75"],
    ["Maple Pecan Scone", "3.95"],
  ]);
  // brunch block
  const by = y + 10;
  els.push(RR(RX - 14, by, CW + 28, 292, 18, "#f3e2c3"), head("Brunch", RX + 8, by + 16, 200, 25, { fontWeight: 700, color: MAPLE, lineHeight: 1.1 }), sans("served until 2 pm", RX + 112, by + 23, 200, 13.5, { color: GREY }));
  const brunch: Array<[string, string, string]> = [
    ["Avocado Toast", "Sourdough, smashed avocado, chili, lemon", "11.50"],
    ["Maple Granola Bowl", "Greek yogurt, seasonal fruit, honey", "9.50"],
    ["Breakfast Sandwich", "Egg, cheddar, bacon, toasted brioche", "10.50"],
    ["Veggie Frittata", "Spinach, feta, roasted tomatoes, greens", "12.00"],
  ];
  brunch.forEach(([n, d, p], i) => {
    const cy = by + 62 + i * 56;
    els.push(sans(n, RX + 8, cy, CW - 90, 18, { fontWeight: 600 }), sans(p, RX + CW - 78, cy, 70, 18, { align: "right", fontWeight: 700, color: MAPLE }), sans(d, RX + 8, cy + 26, CW - 20, 13.5, { color: GREY }));
  });
  els.push(
    RR(LX, 884, W - LX * 2, 72, 18, MUSTARD),
    head("Weekday combo", LX + 28, 898, 300, 26, { fontWeight: 700, italic: true, lineHeight: 1.1 }),
    sans("Any pastry plus a drip coffee for 6.50, before 10 am, Monday to Friday.", LX + 28, 930, 640, 15.5, { fontWeight: 500 }),
    R(0, H - 62, W, 62, BROWN),
    sans("OPEN DAILY 7 AM TO 5 PM   *   318 MAPLE AVENUE   *   @MAPLEMUGCAFE", 0, H - 40, W, 13, { align: "center", color: "#f0dfc2", letterSpacing: 260, fontWeight: 600 }),
  );
  return template(
    { slug: "maple-mug-cafe", category: "menu", size: "menu", tags: ["menu", "cafe", "coffee", "bakery", "brunch", "breakfast", "warm", "coffee shop"], accent: MAPLE },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. The Gilded Fern - cocktail bar                                    */
/* ------------------------------------------------------------------ */

function cocktailBar(): Template {
  const BLACK = "#0f0e0c";
  const GOLD = "#c9955a";
  const GOLD_L = "#ecd2a8";
  const CREAM = "#efe6d6";
  const MUTED = "#a99b86";
  const head = font("Abril Fatface", { color: GOLD });
  const sans = font("Josefin Sans", { color: CREAM });
  const els: DesignElement[] = [
    frame(26, 26, W - 52, H - 52, GOLD, 1.6),
    frame(36, 36, W - 72, H - 72, GOLD, 0.8),
    diamond(W / 2, 36, 7, GOLD),
    diamond(W / 2, H - 36, 7, GOLD),
    G(decoFan(GOLD), W / 2 - 150, 62, 300, 150),
    head("The Gilded Fern", 0, 202, W, 72, { align: "center", lineHeight: 1.1, color: GOLD_L }),
    sans("COCKTAIL BAR   *   SINCE 2016", 0, 286, W, 14, { align: "center", letterSpacing: 500, color: GOLD, fontWeight: 600 }),
  ];
  type Drink = [string, string, string];
  const group = (title: string, x: number, y: number, w: number, drinks: Drink[], gap: number): number => {
    els.push(head(title, x, y, w, 23, { lineHeight: 1.1, color: GOLD }), hr(x, y + 38, w, GOLD, 1));
    let cy = y + 56;
    drinks.forEach(([n, d, p]) => {
      els.push(sans(n.toUpperCase(), x, cy, w - 54, 16.5, { fontWeight: 700, letterSpacing: 200, lineHeight: 1.2 }), sans(p, x + w - 54, cy, 54, 16.5, { align: "right", fontWeight: 700, color: GOLD_L, lineHeight: 1.2 }));
      if (d) els.push(sans(d, x, cy + 27, w - 20, 14.5, { color: MUTED, lineHeight: 1.45 }));
      cy += gap;
    });
    return cy;
  };
  const LX = 76;
  const CW = 316;
  const RX = 424;
  group("Signatures", LX, 336, CW, [
    ["The Gilded Fern", "Gin, elderflower, cucumber, lemon, bubbles", "16"],
    ["Smoke and Honey", "Mezcal, honey, grapefruit, smoked salt rim", "17"],
    ["Midnight Orchard", "Bourbon, apple brandy, maple, walnut bitters", "17"],
    ["Velvet Hour", "Vodka, espresso, vanilla, amaro, cream", "16"],
    ["Paper Crane", "Sake, yuzu, lychee, soda, shiso leaf", "16"],
  ], 86);
  const ry = group("The Classics", RX, 336, CW, [
    ["Negroni", "", "14"],
    ["Old Fashioned", "", "15"],
    ["Daiquiri", "", "13"],
    ["Espresso Martini", "", "15"],
    ["Manhattan", "", "16"],
    ["Whiskey Sour", "", "14"],
  ], 38);
  group("Zero Proof", RX, ry + 18, CW, [
    ["Garden Spritz", "Non-alcoholic aperitif, tonic, cucumber", "10"],
    ["Ginger Ember", "Ginger, lime, honey, soda", "9"],
  ], 72);
  els.push(
    vr(W / 2 - 0.5, 342, 508, "#5c4630", 1),
    hr(LX, 880, W - LX * 2, GOLD, 1),
    sans("SMALL PLATES", LX, 898, 200, 13, { letterSpacing: 400, color: GOLD, fontWeight: 700 }),
    sans("Marinated olives  7        Truffle fries  11        Cheese and charcuterie board  24", LX, 924, W - LX * 2, 15.5, { color: CREAM, letterSpacing: 40 }),
    sans("TUE TO SUN, 5 PM UNTIL LATE   *   77 GRAND AVENUE   *   (312) 555-0176", 0, 974, W, 11.5, { align: "center", letterSpacing: 220, color: MUTED, fontWeight: 600 }),
  );
  return template(
    { slug: "gilded-fern-bar", category: "menu", size: "menu", tags: ["menu", "cocktail", "bar", "drinks", "art deco", "dark", "gold", "speakeasy"], accent: GOLD },
    [pg(BLACK, els)],
  );
}

export const MENU_TEMPLATES: Template[] = [trattoria(), cafe(), cocktailBar()];
