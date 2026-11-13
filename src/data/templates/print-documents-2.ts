/** Three more documents (794 x 1123): a research report with a chart, a team newsletter, a one-page proposal with a table. */
import { createChart } from "@/core/factory";
import type { DesignElement, Template } from "@/core/types";
import { C, F, R, RR, S, pg, template } from "./dsl";
import { font, group, hr, ph, ring, table } from "./print-kit";

const W = 794;
const M = 56;

/* ------------------------------------------------------------------ */
/* 4. Research report: cover + key findings                             */
/* ------------------------------------------------------------------ */

function smallTeamsReport(): Template {
  const VIOLET = "#3a1fb8";
  const VIOLET_L = "#5237d6";
  const CORAL = "#ff7a59";
  const LILAC = "#d6cdff";
  const WHITE = "#ffffff";
  const INK = "#17132e";
  const BODY = "#3a3650";
  const GREY = "#5b5870";
  const RULE = "#e3def8";
  const headC = font("Outfit", { color: WHITE });
  const head = font("Outfit", { color: INK });
  const serifC = font("Lora", { color: LILAC });
  const serif = font("Lora", { color: BODY });

  // 3 x 3 tiles of 150 px in the lower right corner of the cover
  const TX = W - M - 450;
  const TY = 580;
  const tile = (col: number, row: number) => [TX + col * 150, TY + row * 150] as const;
  const quarter = (col: number, row: number, fill: string, flipH = false, flipV = false) => S("quarter-circle", ...tile(col, row), 150, 150, fill, { flipH, flipV });
  const disc = (col: number, row: number, fill: string) => C(tile(col, row)[0] + 75, tile(col, row)[1] + 75, 75, fill);
  const square = (col: number, row: number, fill: string) => R(...tile(col, row), 150, 150, fill);
  const cover: DesignElement[] = [
    headC("FIELDWORK RESEARCH", M, 56, 360, 13, { fontWeight: 600, letterSpacing: 300, color: LILAC }),
    headC("REPORT NO. 9", 438, 56, 300, 13, { align: "right", fontWeight: 600, letterSpacing: 300, color: LILAC }),
    hr(M, 92, W - M * 2, VIOLET_L, 1.5),
    headC("The State\nof Small\nTeams", M - 3, 124, 640, 78, { fontWeight: 800, lineHeight: 1 }),
    headC("2027", M - 3, 358, 400, 78, { fontWeight: 800, lineHeight: 1, color: CORAL }),
    serifC("How 412 teams of two to twenty people plan, meet and ship, and what has changed since last year.", M, 462, 430, 17, { lineHeight: 1.55 }),
    group("Cover pattern", [
      square(0, 0, VIOLET_L),
      quarter(1, 0, CORAL),
      disc(2, 0, LILAC),
      disc(0, 1, CORAL),
      square(1, 1, VIOLET_L),
      quarter(2, 1, WHITE, true),
      quarter(0, 2, LILAC, false, true),
      disc(1, 2, WHITE),
      quarter(2, 2, CORAL, true, true),
    ]),
    headC("PUBLISHED", M, 944, 200, 11.5, { fontWeight: 600, letterSpacing: 280, color: LILAC }),
    serifC("January 2027", M, 964, 200, 16, { color: WHITE }),
    headC("fieldwork.example.com", M, 1010, 220, 14, { fontWeight: 600, color: LILAC }),
  ];

  const stats: Array<[string, string]> = [
    ["64%", "of teams keep one day a week free of meetings"],
    ["5", "people in the median meeting, down from eight"],
    ["2.4x", "more written updates than in the 2025 survey"],
  ];
  const inner: DesignElement[] = [
    R(0, 0, W, 8, VIOLET),
    head("01  /  KEY FINDINGS", M, 48, 300, 12, { fontWeight: 600, letterSpacing: 280, color: VIOLET }),
    serif("The State of Small Teams 2027", 438, 47, 300, 12, { align: "right", italic: true, color: GREY }),
    head("Smaller meetings,\nlonger focus", M - 2, 78, 600, 40, { fontWeight: 700, lineHeight: 1.08 }),
    serif("Teams told us they are meeting less and writing more. The share of teams with a no-meeting day has doubled, and the median meeting has lost three people.", M, 182, W - M * 2, 14.5, { lineHeight: 1.6 }),
  ];
  stats.forEach(([n, l], i) => {
    const x = M + i * 234;
    inner.push(
      RR(x, 276, 214, 124, 14, WHITE, { stroke: { color: RULE, width: 1.5, style: "solid" } }),
      head(n, x + 20, 290, 174, 44, { fontWeight: 800, color: VIOLET, lineHeight: 1.1 }),
      serif(l, x + 20, 344, 176, 13, { lineHeight: 1.4 }),
    );
  });
  inner.push(
    head("Hours of meetings per person, per week", M, 436, 420, 15.5, { fontWeight: 700 }),
    createChart({
      name: "Meeting hours chart",
      alt: "Column chart: weekly hours of meetings per person fell from 9.5 in 2023 to 5.6 in 2027",
      x: M,
      y: 468,
      width: 420,
      height: 280,
      chart: "column",
      labels: ["2023", "2024", "2025", "2026", "2027"],
      series: [{ name: "Hours", values: [9.5, 8.7, 7.9, 6.8, 5.6] }],
      palette: [VIOLET],
      fontFamily: "Outfit",
      textColor: INK,
      showLegend: false,
      showValues: true,
      showGrid: true,
    }),
    head("What teams changed", 506, 436, 232, 15.5, { fontWeight: 700 }),
    serif("Agendas sent a day ahead\nDecisions kept in one place\nA short note, not a stand-up\nOne shared no-meeting day", 506, 468, 232, 13.5, { list: "bullet", lineHeight: 1.55 }),
    RR(506, 664, 232, 84, 12, "#ebe6ff"),
    serif("“We stopped inviting people just in case.”", 522, 680, 200, 14, { italic: true, color: INK, lineHeight: 1.45 }),
    hr(M, 784, W - M * 2, RULE, 1.5),
    head("How we asked", M, 806, 400, 22, { fontWeight: 700, lineHeight: 1.1 }),
    serif("We surveyed 412 teams of two to twenty people between September and November 2026. Each team answered once, through whoever runs its planning.", M, 846, 330, 13.5, { lineHeight: 1.6 }),
    serif("Figures are medians unless we say otherwise. The full tables, the questions and the anonymous answers are free to download from our site.", 408, 846, 330, 13.5, { lineHeight: 1.6 }),
    RR(M, 944, W - M * 2, 84, 14, VIOLET),
    headC("Read the full tables", M + 26, 962, 330, 22, { fontWeight: 700, lineHeight: 1.1 }),
    serifC("Every question, every answer, free to download.", M + 26, 992, 360, 13.5),
    headC("fieldwork.example.com/small-teams", 420, 976, 292, 14.5, { align: "right", fontWeight: 600 }),
    hr(M, 1062, W - M * 2, RULE, 1),
    serif("Fieldwork Research  |  The State of Small Teams 2027", M, 1074, 460, 11, { color: GREY }),
    head("02", W - M - 60, 1074, 60, 11, { align: "right", fontWeight: 700 }),
  );
  return template(
    { slug: "small-teams-report", name: "State of Small Teams Research Report", category: "document", size: "document", tags: ["report", "research", "survey", "cover", "chart", "findings", "document", "a4", "violet", "data"], accent: VIOLET },
    [pg(VIOLET, cover), pg("#faf9ff", inner)],
  );
}

/* ------------------------------------------------------------------ */
/* 5. Team newsletter - The Loop                                        */
/* ------------------------------------------------------------------ */

function teamNewsletter(): Template {
  const PAPER = "#fffdf8";
  const INK = "#1c1c28";
  const BODY = "#2c2d3a";
  const TOMATO = "#c4381d";
  const BUTTER = "#ffe7a3";
  const MINT = "#d7f0e3";
  const GREY = "#55566a";
  const RULE = "#e7e2d6";
  const head = font("Poppins", { color: INK });
  const body = font("Open Sans", { color: BODY });
  const X = 48;
  const els: DesignElement[] = [
    RR(40, 40, W - 80, 150, 24, TOMATO),
    C(674, 150, 46, BUTTER),
    S("star-4", 652, 128, 44, 44, TOMATO),
    head("The Loop", 66, 58, 420, 72, { fontWeight: 800, color: "#ffffff", lineHeight: 1.1 }),
    body("News from the Harbor Street team", 70, 146, 400, 14.5, { color: "#ffffff", fontWeight: 600 }),
    head("ISSUE 24  /  MARCH 2027", 430, 70, 296, 12.5, { align: "right", fontWeight: 600, letterSpacing: 220, color: "#ffffff" }),
    // lead story
    head("BIG NEWS", X, 222, 300, 11, { fontWeight: 700, letterSpacing: 280, color: TOMATO }),
    head("We are moving upstairs in April", X, 242, 400, 30, { fontWeight: 700, lineHeight: 1.15 }),
    body(
      "After six years on the ground floor, the whole team moves to the third floor of the same building on Monday 12 April. There is twice the daylight, a real kitchen and a quiet room with a door that closes.\nPacking crates arrive on 6 April. Label everything with your name and your new desk number, and take your plants home for the weekend.",
      X,
      326,
      400,
      13.5,
      { lineHeight: 1.6 },
    ),
    ph("glass-towers", 472, 222, 274, 196, { radius: 16, fx: 0.5, fy: 0.3, alt: "Glass towers seen from a high window" }),
    body("The view from the new third-floor windows.", 472, 426, 274, 11.5, { italic: true, color: GREY }),
    RR(472, 458, 274, 100, 16, BUTTER),
    head("Moving day checklist", 490, 472, 240, 14, { fontWeight: 700 }),
    body("Crates packed by Friday 9 April. Laptops go home with you.", 490, 498, 240, 12.5, { color: INK, lineHeight: 1.5 }),
    hr(X, 584, W - X * 2, RULE, 1.5),
    // three columns
    head("By the numbers", X, 606, 216, 18, { fontWeight: 700 }),
    RR(277, 596, 240, 250, 16, MINT),
    head("Welcome", 293, 612, 208, 18, { fontWeight: 700 }),
    body("Say hello to Idris Vane, who joins customer care on Monday, and to Petra Lindholm, our first full-time photographer.\nBoth will be at the team lunch on the 18th. Ask Petra about her darkroom.", 293, 646, 208, 13, { color: INK, lineHeight: 1.55 }),
    head("Dates for the diary", 530, 606, 216, 18, { fontWeight: 700 }),
  ];
  const numbers: Array<[string, string]> = [
    ["1,204", "orders shipped in February"],
    ["98%", "arrived on the promised day"],
    ["17", "new wholesale customers"],
  ];
  numbers.forEach(([n, l], i) => {
    const y = 644 + i * 68;
    els.push(head(n, X, y, 216, 32, { fontWeight: 800, color: TOMATO, lineHeight: 1.1 }), body(l, X, y + 38, 216, 12.5, { color: GREY }));
  });
  const dates: Array<[string, string]> = [
    ["4 Mar", "Stocktake, warehouse closed"],
    ["18 Mar", "Team lunch at noon"],
    ["26 Mar", "Spring catalogue goes live"],
    ["12 Apr", "First day upstairs"],
  ];
  dates.forEach(([d, t], i) => {
    const y = 646 + i * 50;
    els.push(head(d, 530, y, 60, 12.5, { fontWeight: 700, color: TOMATO, lineHeight: 1.4 }), body(t, 592, y, 154, 12.5, { color: INK, lineHeight: 1.4 }));
    if (i > 0) els.push(hr(530, y - 10, 216, RULE, 1));
  });
  els.push(
    hr(X, 866, W - X * 2, RULE, 1.5),
    F(X, 890, 108, 108, "ellipse", { name: "Portrait", alt: "Placeholder: drop a portrait here" }),
    ring(X + 54, 944, 55.5, TOMATO, 3),
    head("FIVE MINUTES WITH", 180, 888, 400, 11, { fontWeight: 700, letterSpacing: 280, color: TOMATO }),
    head("Noor Achterberg, warehouse lead", 180, 906, 566, 21, { fontWeight: 700, lineHeight: 1.2 }),
    body("Best part of the job? “Friday afternoons, when the last van leaves and the shelves are straight.” Worst habit? “Hiding the good tape gun.” Ask Noor about her allotment, and bring a bag for the courgettes.", 180, 940, 566, 13.5, { lineHeight: 1.6 }),
    hr(X, 1036, W - X * 2, RULE, 1.5),
    body("Something for the next issue? Write to loop@example.com by the 20th.", X, 1050, 480, 11.5, { color: GREY }),
    body("Pinned up in the kitchen", 546, 1050, 200, 11.5, { align: "right", italic: true, color: GREY }),
  );
  return template(
    { slug: "team-newsletter", name: "The Loop Team Newsletter", category: "document", size: "document", tags: ["newsletter", "team", "company", "internal", "staff", "news", "document", "a4", "one page", "friendly"], accent: TOMATO },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 6. One-page proposal with a price table                              */
/* ------------------------------------------------------------------ */

function onePageProposal(): Template {
  const INK = "#16181d";
  const YELLOW = "#ffd43b";
  const GREY = "#5a5f6b";
  const BODY = "#2a2d35";
  const LINE = "#dfe1e6";
  const SOFT = "#f4f4f0";
  const head = font("Montserrat", { color: INK });
  const serif = font("Merriweather", { color: BODY });
  const SX = 40;
  const SW = 160;
  const X = 270;
  const CW = W - X - M;
  const els: DesignElement[] = [
    R(0, 0, 230, 1123, SOFT),
    group("Mark", [R(SX, 48, 44, 44, YELLOW), C(SX + 22, 70, 9, INK)]),
    head("FERNWOOD\nLANDSCAPES", SX, 108, SW, 13.5, { fontWeight: 800, letterSpacing: 140, lineHeight: 1.35 }),
  ];
  const meta: Array<[string, string, number]> = [
    ["PREPARED FOR", "Ms Adaeze Brandt\n9 Larch Lane\nAlderbrook", 220],
    ["PREPARED BY", "Tobias Engel\ntobias@example.com\n555-0171", 340],
    ["DATE", "8 March 2027", 460],
    ["VALID FOR", "30 days", 526],
    ["PROPOSAL", "No. 0318", 592],
  ];
  meta.forEach(([k, v, y]) => els.push(head(k, SX, y, SW, 9.5, { fontWeight: 700, letterSpacing: 260, color: GREY }), serif(v, SX, y + 20, SW + 20, 12.5, { lineHeight: 1.55, color: INK })));
  els.push(serif("Gardens that look after themselves, mostly.", SX, 1010, SW, 12, { italic: true, color: GREY, lineHeight: 1.5 }));

  els.push(
    head("PROPOSAL", X, 52, 300, 11, { fontWeight: 700, letterSpacing: 280, color: GREY }),
    R(X - 4, 131, 322, 20, YELLOW),
    head("A back garden\nfor all seasons", X - 2, 72, CW, 38, { fontWeight: 800, lineHeight: 1.1 }),
    serif("You asked for a garden that is green in every month, needs an hour a week and leaves room for a table of eight. This page sets out what we would build, what it costs and when it would be ready.", X, 182, CW, 13, { lineHeight: 1.7 }),
    head("What we will do", X, 300, CW, 16, { fontWeight: 800 }),
  );
  const steps: Array<[string, string]> = [
    ["Clear and level", "Remove the old shed base, level the lawn and lay drainage."],
    ["Plant", "Two multi-stem trees, an evergreen hedge and beds planted for March to November."],
    ["Build", "A gravel terrace of 18 square metres, a cedar bench and low path lights."],
  ];
  steps.forEach(([t, d], i) => {
    const y = 336 + i * 70;
    els.push(
      C(X + 14, y + 14, 14, YELLOW),
      head(String(i + 1), X, y + 6, 28, 13, { align: "center", fontWeight: 800 }),
      head(t, X + 42, y, CW - 42, 13.5, { fontWeight: 700 }),
      serif(d, X + 42, y + 22, CW - 42, 12.5, { color: GREY, lineHeight: 1.55 }),
    );
  });
  els.push(
    head("Costs", X, 560, CW, 16, { fontWeight: 800 }),
    table(
      X,
      590,
      [268, 80, 120],
      34,
      [
        ["Item", "Days", "Cost"],
        ["Clearing, levelling and drainage", "3", "$2,400"],
        ["Trees, hedge and planting", "2", "$3,150"],
        ["Terrace, bench and lighting", "4", "$4,900"],
        ["Aftercare visits, first year", "4", "$600"],
        ["Total", "13", "$11,050"],
      ],
      { name: "Cost table", alt: "Costs by item: total 13 days, $11,050", fontFamily: "Montserrat", fontSize: 12, color: INK, headerFill: INK, headerColor: "#ffffff", stripeFill: SOFT, borderColor: LINE, borderWidth: 1, align: "left" },
    ),
    serif("Prices include materials, labour and waste removal. Half is due on booking and half on completion.", X, 808, CW, 11.5, { color: GREY, lineHeight: 1.6 }),
    head("Timing", X, 872, CW, 16, { fontWeight: 800 }),
    RR(X, 904, 152, 28, 14, INK),
    RR(X + 158, 904, 152, 28, 14, GREY),
    RR(X + 316, 904, 152, 28, 14, YELLOW),
    head("April: clear", X, 912, 152, 11, { align: "center", fontWeight: 700, color: "#ffffff" }),
    head("May: plant", X + 158, 912, 152, 11, { align: "center", fontWeight: 700, color: "#ffffff" }),
    head("June: build", X + 316, 912, 152, 11, { align: "center", fontWeight: 700 }),
    hr(X, 1020, 214, INK, 1.2),
    hr(X + 254, 1020, 214, INK, 1.2),
    serif("Signed for the client, and date", X, 1030, 214, 11, { color: GREY }),
    serif("Tobias Engel, Fernwood Landscapes", X + 254, 1030, 214, 11, { color: GREY }),
  );
  return template(
    { slug: "one-page-proposal", name: "One-Page Garden Project Proposal", category: "document", size: "document", tags: ["proposal", "one page", "quote", "estimate", "pricing", "table", "freelance", "document", "a4", "yellow"], accent: YELLOW },
    [pg("#ffffff", els)],
  );
}

export const DOCUMENT_TEMPLATES_2: Template[] = [smallTeamsReport(), teamNewsletter(), onePageProposal()];
