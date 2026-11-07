/** Three certificates (1123 x 794): achievement, completion, appreciation. */
import type { DesignElement, GraphicElement, Template } from "@/core/types";
import { G, R, S, T, photoBg, pg, template } from "./dsl";
import { cornerOrnament, lozengeStrip, sealRibbon } from "./print-art";
import { diamond, font, frame, gxw, hr } from "./print-kit";

const W = 1123;
const H = 794;

/** Four mirrored copies of a top-left ornament, `inset` px from the edges. */
function corners(svg: string, size: number, inset: number): GraphicElement[] {
  const x1 = W - inset - size;
  const y1 = H - inset - size;
  return [
    G(svg, inset, inset, size, size),
    G(svg, x1, inset, size, size, { flipH: true }),
    G(svg, inset, y1, size, size, { flipV: true }),
    G(svg, x1, y1, size, size, { flipH: true, flipV: true }),
  ];
}

/* ------------------------------------------------------------------ */
/* 1. Certificate of Achievement                                        */
/* ------------------------------------------------------------------ */

function achievement(): Template {
  const CREAM = "#fbf7ec";
  const NAVY = "#1d2b53";
  const GOLD = "#b8923b";
  const cin = font("Cinzel", { color: NAVY });
  const script = font("Great Vibes", { color: NAVY });
  const els: DesignElement[] = [
    frame(22, 22, W - 44, H - 44, NAVY, 7),
    frame(40, 40, W - 80, H - 80, GOLD, 2.5),
    frame(47, 47, W - 94, H - 94, NAVY, 1),
    ...corners(cornerOrnament(NAVY, GOLD), 132, 44),
    cin("NORTHBRIDGE PROFESSIONAL INSTITUTE", 0, 92, W, 17, { align: "center", letterSpacing: 400, color: GOLD, fontWeight: 700 }),
    cin("CERTIFICATE", 0, 120, W, 92, { align: "center", fontWeight: 700, letterSpacing: 120, lineHeight: 1.1 }),
    cin("OF ACHIEVEMENT", 0, 222, W, 30, { align: "center", letterSpacing: 560, color: GOLD }),
    gxw("dividers-ornamental-rule", 411, 268, 300, { colors: { "#a67c52": GOLD } }),
    cin("THIS CERTIFICATE IS PROUDLY PRESENTED TO", 0, 332, W, 15, { align: "center", letterSpacing: 360 }),
    script("Alexandra J. Reynolds", 0, 356, W, 100, { align: "center", lineHeight: 1.15 }),
    hr(311, 478, 500, GOLD, 2),
    cin("in recognition of outstanding performance, leadership and dedication\nas Top Regional Sales Performer for the fiscal year 2026", 160, 496, W - 320, 19, { align: "center", lineHeight: 1.65 }),
    // seal with ribbon
    G(sealRibbon(NAVY, "#101a38"), 561 - 42, 648, 84, 96),
    gxw("badges-seal", 561 - 62, 562, 124),
    // signatures
    hr(130, 664, 290, NAVY, 1.5),
    cin("Dr. Helena Marsh", 130, 674, 290, 16, { align: "center", fontWeight: 700, letterSpacing: 60 }),
    cin("DIRECTOR OF PROGRAMS", 130, 698, 290, 11.5, { align: "center", letterSpacing: 300, color: GOLD, fontWeight: 700 }),
    hr(703, 664, 290, NAVY, 1.5),
    cin("Thomas Okafor", 703, 674, 290, 16, { align: "center", fontWeight: 700, letterSpacing: 60 }),
    cin("CHAIR OF THE BOARD", 703, 698, 290, 11.5, { align: "center", letterSpacing: 300, color: GOLD, fontWeight: 700 }),
  ];
  return template(
    { slug: "achievement", name: "Gold and Navy Achievement Certificate", category: "certificate", size: "certificate", tags: ["certificate", "achievement", "award", "gold", "navy", "formal", "seal", "classic"], accent: GOLD },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Certificate of Completion                                         */
/* ------------------------------------------------------------------ */

function completion(): Template {
  const BG = "#f6faf9";
  const TEAL = "#0f4c5c";
  const AMBER = "#e0a21a";
  const AMBER_D = "#a8730a";
  const INK = "#14303a";
  const serif = font("DM Serif Display", { color: TEAL });
  const sans = font("DM Sans", { color: INK });
  const els: DesignElement[] = [
    frame(24, 24, W - 48, H - 48, TEAL, 10),
    frame(46, 46, W - 92, H - 92, AMBER, 2),
    diamond(46, 46, 15, AMBER),
    diamond(W - 46, 46, 15, AMBER),
    diamond(46, H - 46, 15, AMBER),
    diamond(W - 46, H - 46, 15, AMBER),
    G(lozengeStrip(620, TEAL, AMBER), 251, 62, 620, 24),
    G(lozengeStrip(620, TEAL, AMBER), 251, H - 80, 620, 24),
    sans("THE ATLAS LEARNING ACADEMY", 0, 112, W, 16, { align: "center", letterSpacing: 520, fontWeight: 700 }),
    serif("Certificate", 0, 140, W, 100, { align: "center", lineHeight: 1.05 }),
    sans("OF COMPLETION", 0, 246, W, 21, { align: "center", letterSpacing: 700, fontWeight: 700, color: AMBER_D }),
    sans("This certifies that", 0, 304, W, 19, { align: "center", color: "#4c6670" }),
    T("Samuel Okonkwo", 0, 330, W, 78, { fontFamily: "DM Serif Display", italic: true, color: INK, align: "center", lineHeight: 1.1 }),
    hr(281, 420, 560, AMBER, 2),
    sans("has successfully completed the 40-hour professional course", 0, 438, W, 19, { align: "center", color: "#4c6670" }),
    serif("Advanced Data Visualization & Storytelling", 0, 468, W, 40, { align: "center", lineHeight: 1.15 }),
  ];
  const meta: Array<[string, string]> = [
    ["COMPLETED", "October 2, 2026"],
    ["DURATION", "40 hours"],
    ["RESULT", "Distinction"],
  ];
  meta.forEach(([k, v], i) => {
    const x = 281 + i * 190;
    els.push(sans(k, x, 548, 180, 11.5, { align: "center", letterSpacing: 400, fontWeight: 700, color: AMBER_D }), sans(v, x, 568, 180, 19, { align: "center", fontWeight: 700 }));
    if (i > 0) els.push(R(x - 5, 548, 1.5, 46, "#c6d6d6"));
  });
  els.push(
    hr(130, 640, 270, INK, 1.5),
    sans("Dr. Priya Raman", 130, 650, 270, 16, { align: "center", fontWeight: 700 }),
    sans("Program Director", 130, 672, 270, 13, { align: "center", color: "#4c6670" }),
    hr(450, 640, 270, INK, 1.5),
    sans("Marcus Bell", 450, 650, 270, 16, { align: "center", fontWeight: 700 }),
    sans("Head of Learning", 450, 672, 270, 13, { align: "center", color: "#4c6670" }),
    gxw("badges-rosette", 884, 548, 124, { colors: { "#3b82f6": "#14917f", "#93c5fd": "#b4ebde", "#1d4ed8": "#0b5f58", "#2563eb": "#0f766e" } }),
    sans("Certificate No. ALA-2026-04817", 130, 694, 400, 11.5, { color: "#6b8590", letterSpacing: 120 }),
  );
  return template(
    { slug: "completion", name: "Teal Course Completion Certificate", category: "certificate", size: "certificate", tags: ["certificate", "completion", "course", "training", "teal", "modern", "rosette", "diploma"], accent: TEAL },
    [pg(BG, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Certificate of Appreciation                                       */
/* ------------------------------------------------------------------ */

function appreciation(): Template {
  const BURG = "#6e1f2f";
  const GOLD = "#b08d57";
  const INK = "#3b2a25";
  const head = font("Playfair Display", { color: BURG });
  const serif = font("Cormorant Garamond", { color: INK });
  const els: DesignElement[] = [
    frame(20, 20, W - 40, H - 40, BURG, 16),
    frame(44, 44, W - 88, H - 88, GOLD, 3),
    frame(52, 52, W - 104, H - 104, BURG, 1),
  ];
  const flourish = (x: number, y: number, o: Partial<GraphicElement>) => gxw("frames-corner-flourish", x, y, 132, o);
  els.push(
    flourish(56, 56, {}),
    flourish(W - 56 - 132, 56, { flipH: true }),
    flourish(56, H - 56 - 132, { flipV: true }),
    flourish(W - 56 - 132, H - 56 - 132, { flipH: true, flipV: true }),
    gxw("badges-laurel-wreath", 561 - 62, 66, 124),
    S("star", 561 - 20, 66 + 62 - 22, 40, 40, BURG),
    head("CERTIFICATE", 0, 200, W, 72, { align: "center", fontWeight: 700, letterSpacing: 120, lineHeight: 1.1 }),
    head("OF APPRECIATION", 0, 280, W, 32, { align: "center", fontWeight: 400, letterSpacing: 360, lineHeight: 1.2, color: GOLD }),
    gxw("dividers-floral", 561 - 130, 326, 260),
    serif("presented with sincere gratitude to", 0, 384, W, 23, { align: "center", italic: true, fontWeight: 500 }),
    T("Margaret Ellison", 0, 412, W, 70, { fontFamily: "Playfair Display", italic: true, color: BURG, align: "center", lineHeight: 1.15 }),
    hr(321, 496, 480, GOLD, 2),
    serif("In grateful recognition of your generous volunteer service, tireless commitment and the warmth you bring to Riverbend Community Pantry. Your 500 hours helped put food on the tables of over 12,000 neighbors this year.", 190, 514, W - 380, 22, { align: "center", lineHeight: 1.5, fontWeight: 500 }),
    // signatures
    hr(214, 660, 250, INK, 1.2),
    serif("Joan Whitaker", 214, 668, 250, 21, { align: "center", fontWeight: 700 }),
    serif("EXECUTIVE DIRECTOR", 214, 694, 250, 12, { align: "center", letterSpacing: 240, fontWeight: 700, color: GOLD }),
    hr(659, 660, 250, INK, 1.2),
    serif("Luis Moreno", 659, 668, 250, 21, { align: "center", fontWeight: 700 }),
    serif("VOLUNTEER COORDINATOR", 659, 694, 250, 12, { align: "center", letterSpacing: 180, fontWeight: 700, color: GOLD }),
    serif("November 22, 2026", 471, 640, 181, 21, { align: "center", italic: true, fontWeight: 600 }),
    diamond(561, 684, 5, GOLD),
    hr(491, 683, 56, GOLD, 1.5),
    hr(575, 683, 56, GOLD, 1.5),
  );
  return template(
    { slug: "appreciation", name: "Burgundy Appreciation Certificate", category: "certificate", size: "certificate", tags: ["certificate", "appreciation", "thank you", "volunteer", "burgundy", "ornate", "laurel", "warm"], accent: BURG },
    [pg(photoBg("paper-cream"), els)],
  );
}

export const CERTIFICATE_TEMPLATES: Template[] = [achievement(), completion(), appreciation()];
