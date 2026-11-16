/** Two more certificates (1123 x 794): a modern one with a dark side panel, and a bright reading award for children. */
import type { DesignElement, Template } from "@/core/types";
import { C, L, R, RR, S, pg, template } from "./dsl";
import { font, group, gxw, hr } from "./print-kit";

const W = 1123;
const H = 794;

/* ------------------------------------------------------------------ */
/* 4. Employee of the Year - side panel                                 */
/* ------------------------------------------------------------------ */

function sidePanelAward(): Template {
  const CHAR = "#1d1f27";
  const CORAL = "#ff6b4a";
  const PAPER = "#fbfaf7";
  const GREY = "#5d6170";
  const BODY = "#33363f";
  const head = font("Syne", { color: CHAR });
  const sans = font("DM Sans", { color: CHAR });
  const PW = 330;
  const X = 404;
  const els: DesignElement[] = [
    R(0, 0, PW, H, CHAR),
    R(PW, 0, 10, H, CORAL),
    C(PW / 2, 196, 104, "#2a2d38"),
    gxw("business-trophy", PW / 2 - 66, 124, 132),
    sans("ANNUAL AWARDS", 40, 344, PW - 80, 12.5, { align: "center", fontWeight: 700, letterSpacing: 340, color: CORAL }),
    head("20\n27", 40, 366, PW - 80, 84, { align: "center", fontWeight: 800, color: PAPER, lineHeight: 1.1 }),
    hr(PW / 2 - 24, 572, 48, CORAL, 3),
    sans("Harbor Street Supply Co.\nPresented at the winter gathering", 40, 664, PW - 80, 13.5, { align: "center", color: "#c3c6d1", lineHeight: 1.65 }),
    sans("CERTIFICATE OF RECOGNITION", X, 92, 600, 13, { fontWeight: 700, letterSpacing: 360, color: GREY }),
    head("Employee\nof the Year", X - 3, 122, 660, 64, { fontWeight: 800, lineHeight: 1.04 }),
    sans("awarded with thanks and admiration to", X, 292, 600, 16.5, { color: GREY }),
    head("Noor Achterberg", X - 2, 322, 660, 48, { fontWeight: 700, lineHeight: 1.2 }),
    R(X, 392, 120, 6, CORAL),
    sans("For running the calmest warehouse in the company, for training eleven new starters, and for a year in which not a single order went out late.", X, 426, 610, 16.5, { color: BODY, lineHeight: 1.6 }),
  ];
  const meta: Array<[string, string, number]> = [
    ["DATE", "17 December 2027", X],
    ["TEAM", "Warehouse", X + 240],
    ["AWARD NO.", "HS-2027-01", X + 440],
  ];
  meta.forEach(([k, v, x]) => els.push(sans(k, x, 556, 200, 11, { fontWeight: 700, letterSpacing: 300, color: GREY }), sans(v, x, 576, 220, 17, { fontWeight: 700 })));
  const signers: Array<[string, string, number]> = [
    ["Petra Lindholm", "Managing Director", X],
    ["Idris Vane", "Head of Operations", X + 320],
  ];
  signers.forEach(([n, r, x]) => els.push(hr(x, 690, 250, CHAR, 1.5), sans(n, x, 700, 250, 14.5, { fontWeight: 700 }), sans(r, x, 722, 250, 12.5, { color: GREY })));
  return template(
    { slug: "employee-of-the-year", category: "certificate", size: "certificate", tags: ["certificate", "award", "employee", "recognition", "staff", "modern", "trophy", "corporate", "coral"], accent: CORAL },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 5. Star Reader Award - for children                                  */
/* ------------------------------------------------------------------ */

function starReader(): Template {
  const BLUE = "#1463c4";
  const NAVY = "#12305c";
  const YELLOW = "#ffcf33";
  const PINK = "#ff8fb4";
  const MINT = "#8fdcc4";
  const WHITE = "#ffffff";
  const BODY = "#3a4a6b";
  const head = font("Fredoka", { color: NAVY });
  const sans = font("Poppins", { color: BODY });
  const confetti: Array<[string, number, number, number, string, number]> = [
    ["ellipse", 120, 110, 26, PINK, 0],
    ["star-4", 190, 200, 40, YELLOW, 0],
    ["rect", 110, 300, 22, MINT, 20],
    ["ellipse", 230, 110, 14, BLUE, 0],
    ["ellipse", 980, 120, 26, MINT, 0],
    ["star-4", 890, 190, 40, PINK, 0],
    ["rect", 990, 290, 22, YELLOW, -18],
    ["ellipse", 880, 100, 14, BLUE, 0],
    ["star-4", 100, 560, 34, MINT, 0],
    ["ellipse", 150, 660, 22, YELLOW, 0],
    ["star-4", 990, 570, 34, YELLOW, 0],
    ["ellipse", 960, 664, 22, PINK, 0],
  ];
  const els: DesignElement[] = [
    RR(36, 36, W - 72, H - 72, 36, WHITE),
    RR(56, 56, W - 112, H - 112, 24, null, { stroke: { color: YELLOW, width: 4, style: "dashed" } }),
    ...confetti.map(([kind, x, y, size, fill, rotation]) => S(kind, x, y, size, size, fill, { rotation })),
    group("Stars", [S("star", W / 2 - 78, 84, 156, 148, YELLOW), S("star", W / 2 - 168, 150, 70, 66, PINK), S("star", W / 2 + 98, 150, 70, 66, MINT)]),
    sans("WRENFIELD LIBRARY SUMMER READING CHALLENGE", 0, 252, W, 14.5, { align: "center", fontWeight: 700, letterSpacing: 340, color: BLUE }),
    head("Star Reader Award", 0, 276, W, 92, { align: "center", fontWeight: 700, lineHeight: 1.15 }),
    sans("This certificate is proudly given to", 0, 396, W, 19, { align: "center" }),
    head("Olive Brandt", 0, 424, W, 62, { align: "center", fontWeight: 600, color: BLUE, lineHeight: 1.2 }),
    L(W / 2 - 220, 510, W / 2 + 220, 510, NAVY, 2.5, { stroke: { color: NAVY, width: 2.5, style: "dotted", cap: "round" } }),
    sans("for reading 24 books in six weeks, including one about a very brave snail, and for telling everyone about them.", 220, 530, W - 440, 19, { align: "center", lineHeight: 1.55 }),
    gxw("badges-rosette", W / 2 - 50, 612, 100, { colors: { "#3b82f6": "#ff8fb4", "#93c5fd": "#ffd6e4", "#1d4ed8": "#d9487c", "#2563eb": "#f0689a" } }),
    hr(200, 672, 240, NAVY, 1.5),
    sans("Mrs Castellane, Librarian", 200, 682, 240, 14.5, { align: "center", fontWeight: 600, color: NAVY }),
    hr(W - 440, 672, 240, NAVY, 1.5),
    sans("31 August 2027", W - 440, 682, 240, 14.5, { align: "center", fontWeight: 600, color: NAVY }),
  ];
  return template(
    { slug: "star-reader-award", category: "certificate", size: "certificate", tags: ["certificate", "kids", "children", "school", "reading", "award", "library", "playful", "stars", "colorful"], accent: BLUE },
    [pg(BLUE, els)],
  );
}

export const CERTIFICATE_TEMPLATES_2: Template[] = [sidePanelAward(), starReader()];
