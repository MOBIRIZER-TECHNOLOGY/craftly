/**
 * Tech dark-mode deck: near-black blue, neon cyan and magenta, mono labels.
 * Space Grotesk for display and text, JetBrains Mono for labels and code. A fictional edge platform ("Kernel Labs").
 */
import type { Template, TextRun } from "@/core/types";
import { C, L, O, patternBg, R, RR, S, T, template, type TextOpts } from "./dsl";
import { atBase, BOTTOM, frame, glow, hrule, makeType, num, RIGHT, rich, slide, SPAN, X } from "./presentations-kit";

const BG = "#070a12";
const PANEL = "#0e1422";
const PANEL2 = "#121a2d";
const LINE = "#222c46";
const CYAN = "#19e6ff";
const MAGENTA = "#ff2fb3";
const VIOLET = "#7b5cff";
const WHITE = "#eaf1ff";
const MUTED = "#8fa0c0";
const DIM = "#46568a";
const VIOLET_T = "#a592ff";

const SANS = "Space Grotesk";
const MONO = "JetBrains Mono";

const { D, LBL } = makeType({
  display: SANS,
  text: MONO,
  ink: WHITE,
  displayWeight: 700,
  tracking: (s) => (s >= 100 ? -30 : -16),
  labelWeight: 600,
  labelTracking: 140,
});

/** Running text in the sans face. */
const B = (text: string, x: number, y: number, w: number, color = MUTED, o: TextOpts = {}) =>
  T(text, x, y, w, 28, { fontFamily: SANS, fontWeight: 400, lineHeight: 1.5, color, ...o });
/** Mono line (not caps). */
const MN = (text: string, x: number, y: number, w: number, size = 26, color = MUTED, o: TextOpts = {}) =>
  T(text, x, y, w, size, { fontFamily: MONO, fontWeight: 500, lineHeight: 1.5, color, ...o });

const grid = () => patternBg("dots", "#17203a", BG, 1.3);

const folio = (n: number) => [
  T("KERNEL LABS  //  PLATFORM OVERVIEW 2026", X(0), atBase(MONO, 26, 1.2, BOTTOM), 1000, 26, { fontFamily: MONO, fontWeight: 500, letterSpacing: 60, color: MUTED, name: "Footer" }),
  T(`${num(n)}/07`, RIGHT - 200, atBase(MONO, 26, 1.2, BOTTOM), 200, 26, { fontFamily: MONO, fontWeight: 600, color: CYAN, align: "right", name: "Page number" }),
];

/** A window with three dots and a file name. */
const windowChrome = (x: number, y: number, w: number, h: number, name: string) => [
  RR(x, y, w, h, 28, PANEL, { stroke: { color: LINE, width: 2, style: "solid" }, name: "Window" }),
  C(x + 44, y + 44, 9, "#ff5f6d", { name: "Dot" }),
  C(x + 76, y + 44, 9, "#ffbd2e", { name: "Dot" }),
  C(x + 108, y + 44, 9, "#27d17f", { name: "Dot" }),
  T(name, x + 150, atBase(MONO, 26, 1.2, y + 53), 400, 26, { fontFamily: MONO, fontWeight: 500, color: MUTED }),
  hrule(x + 2, y + 88, w - 4, LINE, 2),
];

const t = (text: string, color?: string): TextRun => ({ text, color });

/* ---------------------------------------------------------------- 1 cover */
const CX = 1500;
const CY = 520;
const ring = (r: number, a: number): [number, number] => [CX + r * Math.cos((a * Math.PI) / 180), CY + r * Math.sin((a * Math.PI) / 180)];
const nodes: Array<[number, number, string]> = [
  [380, 200, CYAN],
  [380, 300, MAGENTA],
  [380, 20, CYAN],
  [260, 250, CYAN],
  [260, 340, MAGENTA],
  [260, 80, CYAN],
  [140, 130, CYAN],
  [140, 330, MAGENTA],
];
const links: Array<[number, number]> = [
  [0, 3],
  [3, 6],
  [1, 4],
  [4, 7],
  [2, 4],
  [5, 6],
  [5, 2],
  [3, 1],
];
const cover = slide(
  "Cover",
  grid(),
  [
    glow(CX, CY, 640, VIOLET, 0.38),
    glow(1220, 800, 420, MAGENTA, 0.2),
    glow(1760, 250, 360, CYAN, 0.16),
    ...[380, 260, 140].map((r) => O("ellipse", CX - r, CY - r, r * 2, r * 2, "#2a3b69", 2, { name: "Ring" })),
    ...links.map(([a, b]) => {
      const p = ring(nodes[a][0], nodes[a][1]);
      const q = ring(nodes[b][0], nodes[b][1]);
      return L(p[0], p[1], q[0], q[1], "#2f8fb0", 2, { opacity: 0.8, name: "Link" });
    }),
    ...nodes.flatMap(([r, a, color]) => {
      const [x, y] = ring(r, a);
      return [glow(x, y, 46, color, 0.5), C(x, y, 11, color, { name: "Node" })];
    }),
    glow(CX, CY, 120, CYAN, 0.55),
    C(CX, CY, 26, CYAN, { name: "Core" }),
    C(CX, CY, 10, BG, { name: "Core" }),
    LBL("Kernel Labs  /  Platform overview 2026", X(0), 96, 1000, CYAN),
    D("Compute at", X(0), 330, SPAN(9), 120, { name: "Title" }),
    rich(D(" ", X(0), 450, SPAN(9), 120, { effect: { kind: "neon", color: CYAN, intensity: 30 }, name: "Title (neon)" }), [["the ", { text: "edge.", color: CYAN }]]),
    B("Run your code in 300 cities,\nwith cold starts under 10 ms.", X(0), 690, SPAN(6), MUTED, { fontSize: 32, name: "Subtitle" }),
    MN("$ kernel deploy --global", X(0), atBase(MONO, 28, 1.2, BOTTOM), 800, 28, MAGENTA, { fontWeight: 600, name: "Prompt" }),
  ],
  "Open with the one-line promise: your code, near everyone, with no cold start. Then go to the agenda.",
);

/* ---------------------------------------------------------------- 2 agenda (terminal) */
const items: Array<[string, string, string]> = [
  ["01", "architecture", "12 min"],
  ["02", "benchmarks", "8 min"],
  ["03", "security model", "6 min"],
  ["04", "roadmap", "4 min"],
];
const dots = (name: string, time: string) => ".".repeat(Math.max(2, 27 - name.length - time.length));
const agenda = slide(
  "Agenda",
  BG,
  [
    glow(1700, 120, 420, VIOLET, 0.3),
    LBL("// agenda", X(0), 96, 600, CYAN),
    D("Four stops,\nthirty minutes.", X(0), 190, SPAN(5), 64, { name: "Title" }),
    B("Questions are welcome at any point. We keep the last five minutes free.", X(0), 440, SPAN(4) + 40, MUTED),
    ...windowChrome(X(5), 150, SPAN(7), 620, "agenda.sh"),
    rich(MN(" ", X(5) + 48, 290, SPAN(7) - 96, 32, WHITE, { lineHeight: 1.75, name: "Terminal" }), [
      [t("$ ", MAGENTA), t("kernel agenda --list", WHITE)],
      [t(" ")],
      ...items.map(([n, name, time]) => [t(n + "  ", CYAN), t(name + " ", WHITE), t(dots(name, time) + " ", DIM), t(time, MUTED)]),
      [t(" ")],
      [t("$ ", MAGENTA)],
    ]),
    R(X(5) + 48 + 2 * 19.2, 290 + 7 * 56 + 10, 20, 38, MAGENTA, { name: "Cursor" }),
    ...folio(2),
  ],
  "A terminal-style agenda: four stops with times. Ask the room to hold questions on the benchmarks until stop two.",
);

/* ---------------------------------------------------------------- 3 divider */
const divider = slide(
  "Section 02",
  grid(),
  [
    glow(1500, 560, 640, CYAN, 0.2),
    T("02", X(4), atBase(SANS, 700, 1.0, 880), SPAN(8), 700, { fontFamily: SANS, fontWeight: 700, color: CYAN, align: "right", lineHeight: 1.0, letterSpacing: -40, effect: { kind: "hollow", thickness: 0 }, name: "bleed Numeral" }),
    LBL("// section 02", X(0), 96, 600, CYAN),
    D("Performance", X(0), 400, SPAN(8), 120, { name: "Title" }),
    MN("p99 latency, cold starts and throughput", X(0), 580, SPAN(7), 28, MUTED),
    ...folio(3),
  ],
  "Section break: from here on it is numbers.",
);

/* ---------------------------------------------------------------- 4 three cards */
const features: Array<[string, string, string, string, string]> = [
  ["Zero cold starts", "Isolates boot in under four milliseconds, so there is nothing to keep warm.", "4 ms boot", CYAN, "lightning"],
  ["Anycast everywhere", "One address, 312 cities. Requests land at the nearest healthy node.", "312 cities", MAGENTA, "hexagon"],
  ["Billed per request", "No idle servers, no reserved capacity. You pay for the work, never the wait.", "$0.20 / 1M", VIOLET_T, "star-4"],
];
const cards = slide(
  "Why it's fast",
  BG,
  [
    LBL("// architecture", X(0), 96, 600, CYAN),
    D("Why it's fast", X(0), 170, SPAN(10), 64, { name: "Title" }),
    ...features.flatMap(([name, text, tag, color, icon], i) => {
      const x = X(i * 4);
      const y = 320;
      return [
        glow(x + SPAN(4) / 2, y + 30, 300, color, 0.16),
        RR(x, y, SPAN(4), 560, 32, PANEL, { stroke: { color, width: 2, style: "solid" }, name: "Card" }),
        C(x + 36 + 44, y + 40 + 44, 44, BG, { stroke: { color, width: 2, style: "solid" }, name: "Icon disc" }),
        S(icon, x + 36 + 44 - 24, y + 40 + 44 - 28, 48, 56, color, { name: "Icon" }),
        D(name, x + 36, y + 190, SPAN(4) - 72, 40, { fontWeight: 600, lineHeight: 1.1, letterSpacing: -8 }),
        B(text, x + 36, y + 256, SPAN(4) - 72, MUTED),
        RR(x + 36, y + 560 - 36 - 58, 250, 58, 29, null, { stroke: { color, width: 2, style: "solid" }, name: "Tag" }),
        T(tag, x + 36, y + 560 - 36 - 58 + 15, 250, 26, { fontFamily: MONO, fontWeight: 600, color, align: "center" }),
      ];
    }),
    ...folio(4),
  ],
  "Three reasons it is fast. The tags at the bottom are the numbers to remember.",
);

/* ---------------------------------------------------------------- 5 code + text */
const bullets = ["Deploy from your terminal or CI", "Preview URL for every pull request", "Roll back in a single click"];
const code: TextRun[][] = [
  [t("import", MAGENTA), t(" { serve } ", WHITE), t("from", MAGENTA), t(' "kernel"', CYAN), t(";", MUTED)],
  [t(" ")],
  [t("serve", WHITE), t("(", MUTED), t("async", MAGENTA), t(" (req) => {", WHITE)],
  [t("  const", MAGENTA), t(" city = req.geo.city;", WHITE)],
  [t("  const", MAGENTA), t(" body = ", WHITE), t("`Hello from ${city}`", CYAN), t(";", MUTED)],
  [t(" ")],
  [t("  return new", MAGENTA), t(" Response(body, {", WHITE)],
  [t("    headers: { ", WHITE), t('"cache-control"', CYAN), t(": ", MUTED), t('"max-age=60"', CYAN), t(" },", WHITE)],
  [t("  });", WHITE)],
  [t("});", WHITE)],
];
const developer = slide(
  "Developer experience",
  BG,
  [
    glow(1500, 540, 560, VIOLET, 0.28),
    LBL("// developer experience", X(0), 96, 800, CYAN),
    D("Ship in one\ncommand.", X(0), 190, SPAN(5), 64, { name: "Title" }),
    ...bullets.flatMap((text, i) => {
      const y = 470 + i * 100;
      return [R(X(0), y + 14, 18, 18, i === 1 ? MAGENTA : CYAN, { rotation: 45, name: "Bullet" }), B(text, X(0) + 52, y, SPAN(5), WHITE, { fontSize: 32, lineHeight: 1.3 })];
    }),
    ...windowChrome(X(6), 130, SPAN(6), 740, "edge.ts"),
    rich(MN(" ", X(6) + 48, 250, SPAN(6) - 96, 26, WHITE, { lineHeight: 1.6, name: "Code" }), code),
    RR(X(6) + 32, 760, SPAN(6) - 64, 84, 20, "#0a2a33", { name: "Terminal strip" }),
    rich(MN(" ", X(6) + 56, 760 + 24, SPAN(6) - 112, 26, WHITE, { lineHeight: 1.3, name: "Deploy line" }), [[t("$ ", MAGENTA), t("kernel deploy", WHITE), t("   live in 312 cities (4.1 s)", CYAN)]]),
    ...folio(5),
  ],
  "Walk through the five lines of code, then run the deploy command live if you can.",
);

/* ---------------------------------------------------------------- 6 benchmark */
const bench: Array<[string, number, string, string]> = [
  ["Kernel", 4, "4 ms", CYAN],
  ["Provider A", 180, "180 ms", DIM],
  ["Provider B", 420, "420 ms", DIM],
];
const benchmark = slide(
  "Benchmark",
  grid(),
  [
    glow(560, 520, 460, CYAN, 0.16),
    LBL("// benchmark  /  p99 cold start", X(0), 96, 900, CYAN),
    D("Cold starts,\nmeasured.", X(0), 190, SPAN(6), 64, { name: "Title" }),
    D("4 ms", X(0), 520, SPAN(6), 200, { color: WHITE, effect: { kind: "neon", color: CYAN, intensity: 30 }, name: "Big number" }),
    B("p99 cold start on Kernel, measured across 10 million invocations in June.", X(0), 720, SPAN(5), MUTED),
    ...bench.flatMap(([name, ms, value, color], i) => {
      const y = 330 + i * 190;
      const w = Math.max(14, Math.round(ms * 1.2));
      return [
        MN(name.toUpperCase(), X(7), y, SPAN(5), 26, WHITE, { fontWeight: 600, letterSpacing: 100 }),
        RR(X(7), y + 56, SPAN(5), 56, 28, PANEL2, { name: "Track" }),
        i === 0 ? glow(X(7) + 40, y + 84, 70, CYAN, 0.4) : null,
        RR(X(7), y + 56, w, 56, 28, i === 0 ? CYAN : color, { name: "Bar" }),
        MN(value, X(7) + SPAN(5) - 32 - 160, y + 70, 160, 28, i === 0 ? CYAN : WHITE, { fontWeight: 700, align: "right" }),
      ];
    }).filter((e): e is NonNullable<typeof e> => e !== null),
    ...folio(6),
  ],
  "One number and one comparison. The bars are drawn to scale, which is why Kernel's is so small.",
);

/* ---------------------------------------------------------------- 7 team + contact */
const team: Array<[string, string]> = [
  ["Priya Raman", "CTO and co-founder"],
  ["Marcus Webb", "Head of infrastructure"],
  ["Aiko Tanaka", "Security lead"],
];
const closing = slide(
  "Team and contact",
  BG,
  [
    glow(1700, 160, 520, MAGENTA, 0.2),
    glow(300, 900, 420, VIOLET, 0.22),
    LBL("// questions", X(0), 96, 600, CYAN),
    D("Let's build", X(0), 190, SPAN(10), 96, { name: "Title" }),
    rich(D(" ", X(0), 300, SPAN(10), 96, { effect: { kind: "neon", color: CYAN, intensity: 30 }, name: "Title (neon)" }), [["on the ", { text: "edge.", color: CYAN }]]),
    ...team.flatMap(([name, role], i) => {
      const x = X(i * 4);
      return [
        frame(x, 540, 200, 200, { mask: "ellipse", name: `Team photo ${i + 1}` }),
        O("ellipse", x - 6, 534, 212, 212, i === 1 ? MAGENTA : CYAN, 3, { name: "Photo ring" }),
        D(name, x + 232, 570, SPAN(4) - 232, 40, { fontWeight: 600, lineHeight: 1.1, letterSpacing: -8 }),
        B(role, x + 232, 630, SPAN(4) - 232, MUTED, { lineHeight: 1.35 }),
      ];
    }),
    hrule(X(0), 820, SPAN(12), LINE, 2),
    MN("hello@kernel.example", X(0), 850, SPAN(4), 28, WHITE, { fontWeight: 600 }),
    MN("kernel.example/docs", X(4), 850, SPAN(4), 28, CYAN, { fontWeight: 600 }),
    MN("@kernellabs", X(8), 850, SPAN(4), 28, MAGENTA, { fontWeight: 600 }),
    T(`${num(7)}/07`, RIGHT - 200, atBase(MONO, 26, 1.2, BOTTOM + 14), 200, 26, { fontFamily: MONO, fontWeight: 600, color: CYAN, align: "right", name: "Page number" }),
  ],
  "Introduce the three people who will answer questions. Replace the frames with their photos.",
);

export const NEON: Template = template(
  {
    slug: "tech-dark-neon-platform",
    name: "Neon Tech Platform",
    category: "presentation",
    size: "presentation",
    tags: ["tech", "dark", "neon", "developer", "platform", "cloud", "saas", "cyber", "code", "startup", "futuristic", "api"],
    accent: CYAN,
  },
  [cover, agenda, divider, cards, developer, benchmark, closing],
);
