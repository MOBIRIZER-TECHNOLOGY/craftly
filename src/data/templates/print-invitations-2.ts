/** Three more invitations (480 x 672): housewarming in colour blocks, a supper with a photo, a graduation ticket. */
import type { DesignElement, Template } from "@/core/types";
import { C, L, R, RR, S, pg, template } from "./dsl";
import { diamond, font, group, gxb, hr, ph } from "./print-kit";

const W = 480;

/* ------------------------------------------------------------------ */
/* 5. Housewarming - colour blocks                                      */
/* ------------------------------------------------------------------ */

function housewarming(): Template {
  const TERRA = "#b3472c";
  const CREAM = "#fbf1e2";
  const INK = "#2a1d17";
  const MUSTARD = "#f0b545";
  const SAND = "#e6d5bb";
  const head = font("Bricolage Grotesque", { color: INK });
  const sans = font("DM Sans", { color: INK });
  const FLOOR = 300;
  const els: DesignElement[] = [
    R(0, 0, W, FLOOR, TERRA),
    group("Doorway", [S("arch", 262, 66, 176, 234, MUSTARD), S("arch", 292, 104, 116, 196, CREAM), C(388, 214, 6, TERRA)]),
    gxb("objects-plant-pot", 196, FLOOR, 74),
    sans("NEW KEYS, NEW ADDRESS", 36, 40, 220, 11.5, { fontWeight: 700, letterSpacing: 300, color: CREAM }),
    head("We\nmoved!", 33, 64, 230, 62, { fontWeight: 800, color: CREAM, lineHeight: 0.95 }),
    head("Come and see the new place", 36, 326, 408, 29, { fontWeight: 700, lineHeight: 1.15 }),
    sans("Housewarming drinks, a lot of snacks and a tour that takes ninety seconds.", 36, 370, 400, 15, { lineHeight: 1.5 }),
  ];
  const rows: Array<[string, string]> = [
    ["WHEN", "Saturday 8 May, from 4 pm"],
    ["WHERE", "Flat 3, 21 Larch Lane, Alderbrook"],
    ["BRING", "Nothing but yourselves"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 438 + i * 46;
    els.push(hr(36, y, 408, SAND, 1.5), sans(k, 36, y + 17, 80, 10.5, { fontWeight: 700, letterSpacing: 280, color: TERRA }), sans(v, 116, y + 12, 328, 16, { fontWeight: 600 }));
  });
  els.push(hr(36, 576, 408, SAND, 1.5), sans("Tell Ana and Sol you are coming: 555-0145", 36, 598, 408, 13.5, { fontWeight: 700, color: TERRA }));
  return template(
    { slug: "housewarming", category: "invitation", size: "invitation", tags: ["housewarming", "new home", "moving", "invitation", "party", "modern", "terracotta", "colour block", "casual"], accent: TERRA },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 6. Midsummer supper - photo in an arch                               */
/* ------------------------------------------------------------------ */

function midsummerSupper(): Template {
  const LINEN = "#f4efe6";
  const GREEN = "#2d4a3a";
  const GOLD = "#8a5f1c";
  const INK = "#26302a";
  const serif = font("Playfair Display", { color: GREEN });
  const sans = font("Raleway", { color: INK });
  const els: DesignElement[] = [
    S("arch", 110, 30, 260, 312, null, { stroke: { color: GOLD, width: 1.2, style: "solid" } }),
    ph("lavender-fields", 122, 42, 236, 300, { mask: "arch", fx: 0.5, fy: 0.5, alt: "A field of lavender at dusk" }),
    sans("YOU ARE INVITED TO A", 40, 366, 400, 11, { align: "center", fontWeight: 700, letterSpacing: 400, color: GOLD }),
    serif("Midsummer\nSupper", 30, 386, 420, 54, { align: "center", italic: true, fontWeight: 500, lineHeight: 1.02 }),
    hr(190, 513, 38, GOLD, 1),
    diamond(240, 513.5, 4, GOLD),
    hr(252, 513, 38, GOLD, 1),
    sans("Saturday 19 June at seven o'clock\nThe long table in the orchard\n4 Mill Row, Wrenfield", 50, 528, 380, 14.5, { align: "center", fontWeight: 600, lineHeight: 1.6 }),
    sans("Five courses from the garden. Reply to Maren by 5 June: maren@example.com", 70, 608, 340, 12.5, { align: "center", fontWeight: 500, color: GREEN, lineHeight: 1.5 }),
  ];
  return template(
    { slug: "midsummer-supper", category: "invitation", size: "invitation", tags: ["dinner", "supper", "invitation", "summer", "garden", "elegant", "photo", "arch", "serif", "green"], accent: GREEN },
    [pg(LINEN, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Graduation party - a ticket                                       */
/* ------------------------------------------------------------------ */

function graduationTicket(): Template {
  const COBALT = "#1a3fd1";
  const YELLOW = "#ffd22e";
  const WHITE = "#ffffff";
  const INK = "#0d1b4d";
  const cond = font("Anton", { color: COBALT, lineHeight: 1 });
  const sans = font("Montserrat", { color: INK });
  const TEAR = 432;
  // widths of the bars of the barcode, in px (a bar, then a gap of 3)
  const bars = [3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 4, 1, 2];
  let bx = 0;
  const barcode = bars.map((w) => {
    const bar = R(168 + bx, 588, w, 30, INK);
    bx += w + 3;
    return bar;
  });
  const els: DesignElement[] = [
    RR(28, 28, 424, 616, 22, WHITE),
    C(28, TEAR, 16, COBALT),
    C(452, TEAR, 16, COBALT),
    L(56, TEAR, 424, TEAR, COBALT, 2, { stroke: { color: COBALT, width: 2, style: "dashed", cap: "butt" } }),
    S("star-4", 66, 60, 26, 26, YELLOW),
    S("star-4", 388, 60, 26, 26, YELLOW),
    sans("ADMIT ONE PROUD FAMILY", 96, 66, 288, 11, { align: "center", fontWeight: 800, letterSpacing: 300, color: COBALT }),
    cond("CLASS", 40, 100, 400, 112, { align: "center" }),
    R(64, 220, 352, 118, YELLOW),
    cond("OF 2027", 40, 222, 400, 112, { align: "center" }),
    sans("Leona Achterberg is graduating", 56, 358, 368, 17, { align: "center", fontWeight: 700 }),
    sans("and four years of late nights in the library\ndeserve a proper party.", 56, 384, 368, 13, { align: "center", fontWeight: 500, lineHeight: 1.45 }),
  ];
  const stub: Array<[string, string, number, number]> = [
    ["DATE", "SAT 10 JULY", 56, 140],
    ["TIME", "3 PM", 212, 80],
    ["PLACE", "9 FERN ROAD", 300, 124],
  ];
  stub.forEach(([k, v, x, w]) => els.push(sans(k, x, 458, w, 10, { fontWeight: 800, letterSpacing: 280, color: COBALT }), cond(v, x, 476, w, 25, { color: INK, lineHeight: 1.1 })));
  els.push(sans("Garden party, cake and one short speech. Reply by 1 July to 555-0133.", 66, 522, 348, 13, { align: "center", fontWeight: 600, lineHeight: 1.5 }), group("Barcode", barcode));
  return template(
    { slug: "graduation-ticket", category: "invitation", size: "invitation", tags: ["graduation", "party", "invitation", "ticket", "class of", "school", "university", "bold", "blue", "yellow"], accent: COBALT },
    [pg(COBALT, els)],
  );
}

export const INVITATION_TEMPLATES_2: Template[] = [housewarming(), midsummerSupper(), graduationTicket()];
