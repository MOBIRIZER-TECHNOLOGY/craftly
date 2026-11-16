/**
 * Corporate annual report deck: deep navy, royal blue, pale sky and one amber accent.
 * DM Serif Display for display, DM Sans for text. A fictional financial group ("Calder & Stone").
 */
import type { Template } from "@/core/types";
import { C, L, O, R, RR, S, T, template } from "./dsl";
import { atBase, BOTTOM, frame, hrule, makeType, num, photo, RIGHT, slide, SPAN, X } from "./presentations-kit";

const NAVY = "#0b2a55";
const ROYAL = "#1f5fd0";
const SKY = "#bcd6ff";
const PALE = "#eef4ff";
const WHITE = "#ffffff";
const AMBER = "#f4b400";
const INK = "#0f1b33";
const SOFT = "#465470";
const RULE = "#cfd9ea";

const DISPLAY = "DM Serif Display";
const TEXT = "DM Sans";

const { D, LBL, B } = makeType({
  display: DISPLAY,
  text: TEXT,
  ink: NAVY,
  displayWeight: 400,
  tracking: (s) => (s >= 100 ? -6 : -2),
  bodyLh: 1.5,
  labelWeight: 700,
  labelTracking: 160,
});

export const folio = (n: number, onDark = false) => [
  T("Calder & Stone  /  Annual Report 2025", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 900, 26, { fontFamily: TEXT, fontWeight: 500, color: onDark ? SKY : SOFT, name: "Footer" }),
  T(num(n), RIGHT - 200, atBase(TEXT, 26, 1.2, BOTTOM), 200, 26, { fontFamily: TEXT, fontWeight: 700, color: onDark ? WHITE : NAVY, align: "right", name: "Page number" }),
];

const logo = (x: number, y: number, color = WHITE) => [
  C(x + 16, y + 16, 16, ROYAL, { name: "Logo" }),
  C(x + 34, y + 16, 16, SKY, { opacity: 0.95, name: "Logo" }),
  T("CALDER & STONE", x + 64, atBase(TEXT, 26, 1.2, y + 24), 420, 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 160, color, name: "Wordmark" }),
];

/* ---------------------------------------------------------------- 1 cover */
const cover = slide(
  "Cover",
  NAVY,
  [
    O("ellipse", -380, 560, 1000, 1000, "#1c427a", 3, { name: "Ring" }),
    O("ellipse", -250, 690, 740, 740, "#1c427a", 3, { name: "Ring" }),
    photo("glass-towers", 1190, 0, 730, 1080, { fy: 0.5, name: "Cover photo", alt: "Glass office towers seen from below" }),
    R(1190, 0, 8, 1080, AMBER, { name: "Accent bar" }),
    ...logo(X(0), 96),
    D("Annual\nReport 2025", X(0), 330, SPAN(8), 120, { color: WHITE, name: "Title" }),
    B("Steady growth in an uncertain year.", X(0), 660, SPAN(7), SKY, { fontSize: 32, name: "Subtitle" }),
    T("Calder & Stone Financial Group  /  Published 12 March 2026", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 1000, 26, { fontFamily: TEXT, fontWeight: 500, color: SKY, name: "Footer" }),
  ],
  "Open with the headline of the year: steady growth in an uncertain year. Then hand over to the letter from the CEO.",
);

/* ---------------------------------------------------------------- 2 contents */
const sections: Array<[string, string]> = [
  ["Letter from the CEO", "03"],
  ["2025 at a glance", "04"],
  ["Financial performance", "05"],
  ["Sustainability", "06"],
  ["Outlook for 2026", "07"],
];
const contents = slide(
  "Contents",
  WHITE,
  [
    R(0, 0, X(5) - 24, 1080, NAVY, { name: "Panel" }),
    O("ellipse", -300, 600, 800, 800, "#1c427a", 3, { name: "Ring" }),
    LBL("Annual report 2025", X(0), 96, 600, AMBER),
    D("Contents", X(0), 300, SPAN(5), 120, { color: WHITE }),
    B("Our performance, strategy and outlook in five short parts.", X(0), 470, SPAN(4) + 60, SKY),
    ...sections.flatMap(([name, page], i) => {
      const y = 150 + i * 150;
      return [
        hrule(X(6), y, SPAN(6), RULE, 2),
        T(num(i + 1), X(6), atBase(DISPLAY, 64, 1.0, y + 98), 130, 64, { fontFamily: DISPLAY, color: ROYAL, lineHeight: 1.0 }),
        T(name, X(6) + 130, atBase(DISPLAY, 40, 1.0, y + 96), SPAN(5), 40, { fontFamily: DISPLAY, color: NAVY, lineHeight: 1.0 }),
        T(page, RIGHT - 100, atBase(TEXT, 26, 1.2, y + 96), 100, 26, { fontFamily: TEXT, fontWeight: 700, color: SOFT, align: "right" }),
      ];
    }),
    hrule(X(6), 150 + sections.length * 150, SPAN(6), RULE, 2),
    T(num(2), RIGHT - 200, atBase(TEXT, 26, 1.2, BOTTOM), 200, 26, { fontFamily: TEXT, fontWeight: 700, color: NAVY, align: "right", name: "Page number" }),
    T("Calder & Stone  /  Annual Report 2025", X(0), atBase(TEXT, 26, 1.2, BOTTOM), 700, 26, { fontFamily: TEXT, fontWeight: 500, color: SKY, name: "Footer" }),
  ],
  "A one-line map of the report. Skip it if time is short.",
);

/* ---------------------------------------------------------------- 3 CEO letter */
const letter = slide(
  "CEO letter",
  WHITE,
  [
    O("arch", X(9) - 24, 174, SPAN(3), 560, ROYAL, 3, { name: "Arch outline" }),
    frame(X(9), 150, SPAN(3), 560, { mask: "arch", name: "Portrait frame" }),
    LBL("Message from the CEO", X(0), 96, 700, ROYAL),
    D("We grew by doing what\nwe promised: steadily,\ncarefully, together.", X(0), 190, SPAN(8), 80, { lineHeight: 1.08, name: "Statement" }),
    B("Customers trusted us with more of their savings, our teams delivered four new products on time, and we kept costs flat while investing in people.", X(0), 540, SPAN(7), SOFT, { name: "Body" }),
    hrule(X(0), 760, 96, AMBER, 4),
    T("Helen Calder", X(0), 790, SPAN(5), 44, { fontFamily: DISPLAY, color: NAVY, italic: true, lineHeight: 1.1 }),
    T("CHIEF EXECUTIVE OFFICER", X(0), 850, SPAN(6), 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 140, color: SOFT }),
    ...folio(3),
  ],
  "Read the first sentence of the letter, then summarise in your own words. Replace the frame with a portrait of your CEO.",
);

/* ---------------------------------------------------------------- 4 KPIs */
const kpis: Array<[string, string, string, string, number[]]> = [
  ["Revenue", "$2.48B", "+12% on 2024", "Total group revenue", [1.5, 1.7, 1.95, 2.2, 2.48]],
  ["Operating margin", "18.4%", "+1.2 pts", "Before one-off items", [15.1, 15.9, 16.4, 17.2, 18.4]],
  ["Customers", "1.9M", "+210K new", "Active in 14 countries", [1.1, 1.3, 1.5, 1.7, 1.9]],
  ["Retention", "96%", "+2 pts", "Kept for 12+ months", [91, 92, 93, 94, 96]],
];
const glance = slide(
  "At a glance",
  PALE,
  [
    LBL("2025 at a glance", X(0), 96, 700, ROYAL),
    D("Four numbers that tell the year", X(0), 170, SPAN(11), 64),
    ...kpis.flatMap(([name, big, delta, text, series], i) => {
      const x = X(i * 3);
      const y = 330;
      const max = Math.max(...series);
      const min = Math.min(...series);
      return [
        RR(x, y, SPAN(3), 560, 28, WHITE, { shadow: { color: "rgba(11,42,85,0.10)", blur: 40, x: 0, y: 16 }, name: "Card" }),
        LBL(name, x + 36, y + 40, SPAN(3) - 72, ROYAL, { fontSize: 26, letterSpacing: 100 }),
        D(big, x + 36, y + 120, SPAN(3) - 72, 104, { color: NAVY, name: "KPI" }),
        RR(x + 36, y + 262, 270, 52, 26, PALE, { name: "Delta chip" }),
        S("arrow-up", x + 36 + 20, y + 262 + 13, 20, 26, ROYAL, { name: "Arrow" }),
        T(delta, x + 36 + 52, y + 262 + 12, 210, 26, { fontFamily: TEXT, fontWeight: 700, color: NAVY, lineHeight: 1.2 }),
        B(text, x + 36, y + 340, SPAN(3) - 72, SOFT, { lineHeight: 1.35 }),
        ...series.map((v, k) => {
          const h = 28 + ((v - min) / (max - min || 1)) * 72;
          return RR(x + 36 + k * 44, y + 520 - h, 30, h, 8, k === series.length - 1 ? ROYAL : "#b7cdf2", { name: "Spark bar" });
        }),
      ];
    }),
    ...folio(4),
  ],
  "Four headline numbers. The small bars show five years of trend; the last bar is 2025.",
);

/* ---------------------------------------------------------------- 5 revenue chart */
const years = [2021, 2022, 2023, 2024, 2025];
const revenue = [1.52, 1.71, 1.95, 2.21, 2.48];
const BASE_Y = 850;
const SCALE_Y = 178;
const points: Array<[string, string]> = [
  ["Subscriptions", "Recurring fees are now 61% of our revenue."],
  ["New markets", "Spain and Poland added $140M in their first full year."],
  ["Pricing discipline", "Revenue per customer rose 4% with no rise in churn."],
];
const chart = slide(
  "Revenue",
  WHITE,
  [
    LBL("Financial performance", X(0), 96, 700, ROYAL),
    D("Revenue by year", X(0), 170, SPAN(8), 64),
    T("US$ billions, fiscal years ending 31 December", X(0), 262, SPAN(8), 28, { fontFamily: TEXT, color: SOFT }),
    ...[0, 1, 2, 3].map((k) => hrule(X(0), BASE_Y - k * 150, SPAN(7), RULE, 2, { name: "Gridline" })),
    ...revenue.flatMap((v, i) => {
      const w = 120;
      const x = X(0) + i * ((SPAN(7) - w) / 4);
      const h = Math.round(v * SCALE_Y);
      const last = i === revenue.length - 1;
      return [
        R(x, BASE_Y - h, w, h, last ? ROYAL : NAVY, { name: "Bar" }),
        T(v.toFixed(2), x, BASE_Y - h - 56, w, 40, { fontFamily: DISPLAY, color: NAVY, align: "center", lineHeight: 1.1 }),
        T(String(years[i]), x, BASE_Y + 20, w, 26, { fontFamily: TEXT, fontWeight: 600, color: SOFT, align: "center" }),
      ];
    }),
    RR(X(0) + SPAN(7) - 120 - 28, 250, 176, 60, 30, AMBER, { name: "Growth pill" }),
    T("+12% YoY", X(0) + SPAN(7) - 120 - 28, 250 + 15, 176, 28, { fontFamily: TEXT, fontWeight: 700, color: NAVY, align: "center", lineHeight: 1.2 }),
    ...points.flatMap(([head, text], i) => {
      const y = 150 + i * 250;
      return [
        hrule(X(8), y, SPAN(4), RULE, 2),
        T(head, X(8), y + 30, SPAN(4), 40, { fontFamily: DISPLAY, color: NAVY, lineHeight: 1.1 }),
        B(text, X(8), y + 92, SPAN(4), SOFT, { lineHeight: 1.45 }),
      ];
    }),
    ...folio(5),
  ],
  "Revenue has grown every year for five years. Point at the 2025 bar and the +12% pill, then the three drivers on the right.",
);

/* ---------------------------------------------------------------- 6 sustainability (image + text) */
const climate: Array<[string, string]> = [
  ["−38%", "operational emissions since 2019"],
  ["100%", "renewable power in every European office"],
  ["4,200", "volunteer hours from colleagues in 2025"],
];
const sustainability = slide(
  "Sustainability",
  WHITE,
  [
    photo("rolling-fields", 0, 0, X(6) - 24, 1080, { fx: 0.45, name: "Sustainability photo", alt: "Green farmland under a pale sky" }),
    R(0, 940, X(6) - 24, 140, "rgba(11,42,85,0.78)", { name: "Caption bar" }),
    T("Solar fields supplying our Lyon campus", X(0), atBase(TEXT, 28, 1.2, 1032), 700, 28, { fontFamily: TEXT, fontWeight: 600, color: WHITE, name: "Caption" }),
    LBL("Sustainability", X(6), 96, 700, ROYAL),
    D("Net zero\nby 2035", X(6), 170, SPAN(6), 96, { lineHeight: 1.0, name: "Title" }),
    ...climate.flatMap(([big, text], i) => {
      const y = 470 + i * 150;
      return [
        hrule(X(6), y, SPAN(6), RULE, 2),
        T(big, X(6), atBase(DISPLAY, 64, 1.0, y + 96), 250, 64, { fontFamily: DISPLAY, color: ROYAL, lineHeight: 1.0 }),
        B(text, X(6) + 290, y + 30, SPAN(6) - 290, INK, { lineHeight: 1.4 }),
      ];
    }),
    T(num(6), RIGHT - 200, atBase(TEXT, 26, 1.2, BOTTOM), 200, 26, { fontFamily: TEXT, fontWeight: 700, color: NAVY, align: "right", name: "Page number" }),
  ],
  "Three commitments, three proof points. Swap in your own photograph if you have one.",
);

/* ---------------------------------------------------------------- 7 outlook */
const milestones: Array<[string, string]> = [
  ["Q1", "Launch Calder Pay in Spain"],
  ["Q2", "Open the Warsaw engineering hub"],
  ["Q3", "Issue our second green bond to investors"],
  ["Q4", "Welcome our 2.2 millionth customer to the group"],
];
const outlook = slide(
  "Outlook",
  NAVY,
  [
    O("ellipse", 1300, -420, 1000, 1000, "#1c427a", 3, { name: "Ring" }),
    LBL("Outlook for 2026", X(0), 96, 700, AMBER),
    D("Looking ahead\nto 2026", X(0), 170, SPAN(11), 96, { color: WHITE, lineHeight: 1.0 }),
    L(X(0), 500, RIGHT, 500, "#3d5f93", 3, { name: "Timeline" }),
    ...milestones.flatMap(([q, text], i) => {
      const x = X(i * 3);
      const first = i === 0;
      return [
        C(x + 18, 500, 18, first ? AMBER : NAVY, { stroke: { color: first ? AMBER : SKY, width: 4, style: "solid" }, name: "Milestone" }),
        T(q, x, atBase(DISPLAY, 64, 1.0, 650), SPAN(3), 64, { fontFamily: DISPLAY, color: WHITE, lineHeight: 1.0 }),
        B(text, x, 684, SPAN(3) - 40, SKY, { lineHeight: 1.4 }),
      ];
    }),
    hrule(X(0), 850, SPAN(12), "#2a4a80", 2),
    T("Investor relations", X(0), 880, SPAN(4), 26, { fontFamily: TEXT, fontWeight: 700, letterSpacing: 120, textCase: "upper", color: AMBER }),
    T("ir@calderstone.example", X(4), 878, SPAN(4), 28, { fontFamily: TEXT, fontWeight: 600, color: WHITE }),
    T("+44 20 7946 0321", X(8), 878, SPAN(4), 28, { fontFamily: TEXT, fontWeight: 600, color: WHITE }),
    T(num(7), RIGHT - 200, atBase(TEXT, 26, 1.2, BOTTOM + 8), 200, 26, { fontFamily: TEXT, fontWeight: 700, color: SKY, align: "right", name: "Page number" }),
  ],
  "Four milestones, one per quarter. End with the investor relations contact and invite questions.",
);

export const CORPORATE: Template = template(
  {
    slug: "corporate-annual-report-blue",
    category: "presentation",
    size: "presentation",
    tags: ["corporate", "annual report", "business", "finance", "blue", "navy", "investor", "kpi", "report", "company", "quarterly results"],
    accent: ROYAL,
  },
  [cover, contents, letter, glance, chart, sustainability, outlook],
);
