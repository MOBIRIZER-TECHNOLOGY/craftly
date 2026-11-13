/** Two more menus (816 x 1056): a street-food truck in bold bands, and a quiet tasting menu in one column. */
import type { Color, DesignElement, Template } from "@/core/types";
import { R, S, T, pg, template } from "./dsl";
import { font, hr, ring, vr } from "./print-kit";

const W = 816;
const M = 48;

/* ------------------------------------------------------------------ */
/* 4. Comal Street Tacos - food truck                                   */
/* ------------------------------------------------------------------ */

function tacoTruck(): Template {
  const INK = "#1c1730";
  const YELLOW = "#ffd23f";
  const TEAL = "#2cc4b6";
  const PINK = "#ff9dbb";
  const CREAM = "#fff7e6";
  const block = font("Bungee", { color: INK, lineHeight: 1.1 });
  const sans = font("Work Sans", { color: INK });
  const els: DesignElement[] = [
    R(0, 0, W, 232, INK),
    block("COMAL STREET", M, 44, 600, 56, { color: YELLOW }),
    block("TACOS", M, 106, 400, 56, { color: PINK }),
    sans("CORN TORTILLAS PRESSED TO ORDER", M, 186, 520, 13.5, { fontWeight: 700, letterSpacing: 300, color: CREAM }),
    S("burst", 622, 44, 150, 150, TEAL),
    T("OPEN\nLATE", 622, 87, 150, 27, { fontFamily: "Bungee", color: INK, align: "center", lineHeight: 1.15, rotation: -10 }),
  ];
  type Item = [string, string, string];
  const band = (title: string, note: string, y: number, h: number, fill: Color, rowH: number, items: Item[]) => {
    els.push(R(0, y, W, h, fill), block(title, M, y + 22, 300, 32), sans(note, 300, y + 34, W - M - 300, 14, { align: "right", fontWeight: 600 }));
    items.forEach(([n, d, p], i) => {
      const x = M + (i % 2) * 376;
      const cy = y + 78 + Math.floor(i / 2) * rowH;
      els.push(sans(n, x, cy, 280, 18, { fontWeight: 800, lineHeight: 1.2 }), block(p, x + 284, cy - 1, 60, 19, { align: "right" }), sans(d, x, cy + 26, 340, 14, { fontWeight: 500, lineHeight: 1.3 }));
    });
  };
  band("TACOS", "Two per order, on corn tortillas", 232, 330, YELLOW, 80, [
    ["Al pastor", "Pork, pineapple, onion, coriander", "9"],
    ["Carne asada", "Grilled beef, salsa roja, lime", "10"],
    ["Pollo verde", "Chicken, tomatillo, pickled onion", "9"],
    ["Hongos", "Mushrooms, garlic, salsa macha", "8"],
    ["Pescado", "Crisp fish, cabbage, chipotle mayo", "11"],
    ["Frijol", "Black beans, cheese, avocado", "7"],
  ]);
  band("SIDES", "Good for sharing", 562, 232, TEAL, 72, [
    ["Elote", "Grilled corn, lime, chilli, cheese", "5"],
    ["Chips and guacamole", "Made this morning", "6"],
    ["Rice and beans", "A small bowl of both", "4"],
    ["Churros", "Cinnamon sugar, chocolate dip", "5"],
  ]);
  els.push(R(0, 794, W, 166, PINK), block("DRINKS", M, 816, 300, 32));
  const drinks: Array<[string, string]> = [
    ["Agua fresca", "4"],
    ["Horchata", "4"],
    ["Cola in a bottle", "3"],
    ["Hibiscus iced tea", "4"],
    ["Cold beer", "5"],
    ["Michelada", "7"],
  ];
  drinks.forEach(([n, p], i) => {
    const x = M + (i % 3) * 248;
    const y = 872 + Math.floor(i / 3) * 38;
    els.push(sans(n, x, y, 170, 17, { fontWeight: 700 }), block(p, x + 170, y - 1, 46, 17, { align: "right" }));
  });
  els.push(
    R(0, 960, W, 96, INK),
    sans("THURSDAY TO SUNDAY AT THE MILL ROW MARKET", M, 982, W - M * 2, 14, { align: "center", fontWeight: 700, letterSpacing: 240, color: YELLOW }),
    sans("Everything can be made without meat or dairy. Just ask at the window.", M, 1008, W - M * 2, 13.5, { align: "center", color: CREAM }),
  );
  return template(
    { slug: "taco-truck", name: "Comal Street Tacos Truck Menu", category: "menu", size: "menu", tags: ["menu", "tacos", "food truck", "street food", "mexican", "bold", "colorful", "takeaway", "casual"], accent: YELLOW },
    [pg(YELLOW, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 5. Juniper Table - tasting menu                                      */
/* ------------------------------------------------------------------ */

function tastingMenu(): Template {
  const PAPER = "#f8f5ef";
  const INK = "#24211d";
  const OLIVE = "#5f5e30";
  const GREY = "#635d53";
  const serif = font("Cormorant Garamond", { color: INK, align: "center" });
  const sans = font("Raleway", { color: INK, align: "center" });
  const courses: Array<[string, string, string]> = [
    ["I", "Warm rye and cultured butter", "smoked salt"],
    ["II", "Beetroot, sheep's curd, hazelnut", "baked in the embers"],
    ["III", "Celeriac broth", "pickled mushrooms, thyme oil"],
    ["IV", "Brown trout", "leeks, mussel sauce, dill"],
    ["V", "Venison loin", "blackberry, kale, bone sauce"],
    ["VI", "Sheep's milk yoghurt", "quince, honey, bay"],
    ["VII", "Burnt apple tart", "buttermilk ice cream"],
  ];
  const els: DesignElement[] = [
    vr(64, 64, 928, OLIVE, 1, { opacity: 0.45 }),
    vr(W - 65, 64, 928, OLIVE, 1, { opacity: 0.45 }),
    ring(W / 2, 92, 27, INK, 1.2),
    serif("J", W / 2 - 30, 71, 60, 34, { fontWeight: 600, lineHeight: 1.2 }),
    sans("JUNIPER TABLE", 0, 136, W, 11.5, { fontWeight: 600, letterSpacing: 440 }),
    serif("Autumn Tasting Menu", 100, 162, W - 200, 60, { italic: true, fontWeight: 500, lineHeight: 1.1 }),
    sans("SEVEN COURSES  ·  OCTOBER AND NOVEMBER", 0, 244, W, 12, { fontWeight: 600, letterSpacing: 260, color: OLIVE }),
    hr(W / 2 - 40, 284, 80, INK, 1),
  ];
  courses.forEach(([n, dish, detail], i) => {
    const y = 310 + i * 86;
    els.push(
      sans(n, 0, y, W, 10.5, { fontWeight: 700, letterSpacing: 320, color: OLIVE }),
      serif(dish, 140, y + 16, W - 280, 26, { fontWeight: 600, lineHeight: 1.2 }),
      sans(detail, 140, y + 50, W - 280, 13, { color: GREY }),
    );
  });
  els.push(
    hr(W / 2 - 40, 926, 80, INK, 1),
    sans("Seven courses 78   ·   with paired wines 124", 0, 946, W, 13.5, { fontWeight: 600, letterSpacing: 100 }),
    sans("A vegetarian menu is always available. Please tell us about allergies when you book.", 128, 974, W - 256, 12, { color: GREY, lineHeight: 1.4 }),
    sans("6 MILL ROW, WRENFIELD  ·  555-0190", 0, 1004, W, 11, { fontWeight: 600, letterSpacing: 280, color: OLIVE }),
  );
  return template(
    { slug: "tasting-menu", name: "Juniper Table Tasting Menu", category: "menu", size: "menu", tags: ["menu", "tasting", "fine dining", "restaurant", "set menu", "minimal", "elegant", "courses", "seasonal"], accent: OLIVE },
    [pg(PAPER, els)],
  );
}

export const MENU_TEMPLATES_2: Template[] = [tacoTruck(), tastingMenu()];
