/** Four more flyers (816 x 1056): class schedule with a table, street clean-up, tech meetup, lessons with tear-off tabs. */
import type { DesignElement, Template } from "@/core/types";
import { C, L, O, R, RR, S, T, patternBg, pg, template } from "./dsl";
import { font, group, hr, table, vr } from "./print-kit";

const W = 816;
const H = 1056;
const M = 48;

/* ------------------------------------------------------------------ */
/* 5. Yoga studio - autumn class schedule                               */
/* ------------------------------------------------------------------ */

function yogaSchedule(): Template {
  const SAND = "#f3ecdf";
  const SAGE = "#4e6853";
  const DEEP = "#2f4636";
  const CLAY = "#a04e2c";
  const INK = "#2b332c";
  const serif = font("Cormorant Garamond", { color: DEEP });
  const sans = font("Work Sans", { color: INK });
  const els: DesignElement[] = [
    group("Arches", [S("arch", 548, 56, 220, 262, "#dcc9a6"), S("arch", 584, 104, 148, 214, SAGE), S("arch", 620, 152, 76, 166, SAND)]),
    sans("STILLWATER YOGA", M, 64, 400, 14, { fontWeight: 700, letterSpacing: 360, color: SAGE }),
    serif("Autumn\nClass Schedule", M - 4, 92, 500, 80, { fontWeight: 600, lineHeight: 0.98 }),
    sans("Slow mornings, strong lunch breaks and quiet evenings. Every class is open to all levels unless it says otherwise.", M, 276, 470, 17, { lineHeight: 1.5 }),
    table(
      M,
      388,
      [96, 104, 104, 104, 104, 104, 104],
      50,
      [
        ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        ["7:00 am", "Sunrise Flow", "", "Sunrise Flow", "", "Sunrise Flow", ""],
        ["9:30 am", "", "Gentle Hatha", "", "Gentle Hatha", "", "Family Yoga"],
        ["12:15 pm", "Lunch Reset", "Lunch Reset", "Lunch Reset", "Lunch Reset", "Lunch Reset", ""],
        ["5:45 pm", "Vinyasa", "Yin", "Vinyasa", "Yin", "Restore", ""],
        ["7:30 pm", "Beginners", "", "Meditation", "", "", ""],
      ],
      { name: "Weekly schedule", alt: "Weekly class schedule, Monday to Saturday", fontFamily: "Work Sans", fontSize: 13, color: INK, headerFill: DEEP, headerColor: SAND, stripeFill: "#ece3d0", borderColor: "#d8ccb4", borderWidth: 1, align: "center" },
    ),
  ];
  const prices: Array<[string, string, string]> = [
    ["DROP IN", "$18", "One class, any time"],
    ["FIVE CLASSES", "$75", "Use them within two months"],
    ["MONTHLY", "$120", "As many classes as you like"],
  ];
  prices.forEach(([k, v, s], i) => {
    const x = M + i * 248;
    els.push(
      sans(k, x, 724, 224, 12, { fontWeight: 700, letterSpacing: 300, color: CLAY }),
      serif(v, x, 742, 224, 50, { fontWeight: 600, lineHeight: 1.1 }),
      sans(s, x, 802, 224, 14.5, { lineHeight: 1.35 }),
    );
    if (i > 0) els.push(vr(x - 16, 724, 100, "#d8ccb4", 1.5));
  });
  els.push(
    RR(M, 868, W - M * 2, 124, 20, DEEP),
    serif("First class is on us.", M + 28, 886, 400, 34, { italic: true, fontWeight: 500, color: SAND, lineHeight: 1.2 }),
    sans("Mats, blocks and tea are provided. Please arrive ten minutes early.", M + 28, 934, 380, 14.5, { color: "#d5e0d3", lineHeight: 1.45 }),
    sans("stillwateryoga.example.com\n3 Mill Row, Alderbrook\n555-0139", 480, 890, 260, 14.5, { color: SAND, fontWeight: 600, align: "right", lineHeight: 1.6 }),
  );
  return template(
    { slug: "yoga-class-schedule", category: "flyer", size: "flyer", tags: ["yoga", "schedule", "timetable", "class", "wellness", "studio", "flyer", "calm", "table", "sage"], accent: SAGE },
    [pg(SAND, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 6. Neighborhood clean-up day                                         */
/* ------------------------------------------------------------------ */

function cleanupDay(): Template {
  const BLUE = "#1553c7";
  const YELLOW = "#ffd84d";
  const WHITE = "#ffffff";
  const INK = "#0c2350";
  const BODY = "#33415c";
  const head = font("Bricolage Grotesque", { color: WHITE, fontWeight: 800 });
  const sans = font("Inter", { color: INK });
  const els: DesignElement[] = [
    R(0, 0, W, 640, BLUE),
    O("ellipse", 610, 300, 300, 300, WHITE, 3, { opacity: 0.28 }),
    O("ellipse", 660, 350, 200, 200, WHITE, 3, { opacity: 0.28 }),
    S("star-4", 690, 196, 48, 48, YELLOW),
    S("star-4", 640, 250, 22, 22, WHITE),
    RR(M, M, 176, 176, 24, YELLOW),
    sans("SAT", M, 64, 176, 19, { align: "center", fontWeight: 800, letterSpacing: 320 }),
    head("24", M, 86, 176, 96, { align: "center", color: INK, lineHeight: 1 }),
    sans("APRIL", M, 186, 176, 19, { align: "center", fontWeight: 800, letterSpacing: 320 }),
    sans("GREENWAY BLOCK ASSOCIATION", 380, 60, 388, 13, { align: "right", fontWeight: 700, letterSpacing: 300, color: WHITE }),
    sans("9 AM TO NOON", 380, 86, 388, 22, { align: "right", fontWeight: 800, color: YELLOW, letterSpacing: 60 }),
    head("Clean up\nour streets.", M - 4, 258, 640, 108, { lineHeight: 0.96, letterSpacing: -10 }),
    sans("Two hours, four blocks and one very satisfying before-and-after. Gloves, bags and coffee are on us.", M, 498, 560, 21, { color: "#e3ecff", lineHeight: 1.45, fontWeight: 500 }),
  ];
  const cols: Array<[string, string]> = [
    ["Meet", "At the corner of Larch Lane and Mill Row, by the blue mailbox."],
    ["Bring", "Closed shoes, a water bottle and a neighbor. Kids are welcome."],
    ["Stay", "Lunch is free at noon in Greenway Park for everyone who helps."],
  ];
  cols.forEach(([t, d], i) => {
    const x = M + i * 248;
    els.push(
      C(x + 18, 694, 18, BLUE),
      sans(String(i + 1), x, 684, 36, 16, { align: "center", fontWeight: 800, color: WHITE }),
      head(t, x, 726, 224, 26, { color: INK, fontWeight: 700, lineHeight: 1.15 }),
      sans(d, x, 764, 220, 15.5, { color: BODY, lineHeight: 1.5 }),
    );
  });
  els.push(
    RR(M, 892, W - M * 2, 104, 20, YELLOW),
    head("Sign up, so we bring enough gloves", M + 28, 910, 660, 27, { color: INK, fontWeight: 700, lineHeight: 1.2 }),
    sans("cleanup.example.com   /   or text HELP to 555-0164", M + 28, 954, 660, 16.5, { fontWeight: 600 }),
  );
  return template(
    { slug: "street-cleanup-day", category: "flyer", size: "flyer", tags: ["volunteer", "community", "cleanup", "neighborhood", "flyer", "event", "blue", "yellow", "bold"], accent: BLUE },
    [pg(WHITE, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Tech meetup - dark, monospace                                     */
/* ------------------------------------------------------------------ */

function localFirstMeetup(): Template {
  const BG = "#0b0f14";
  const LIME = "#c6f432";
  const WHITE = "#f2f5f7";
  const GREY = "#a3afbb";
  const PANEL = "#151c25";
  const LINE = "#2a3542";
  const grot = font("Space Grotesk", { color: WHITE });
  const mono = font("JetBrains Mono", { color: GREY });
  const agenda: Array<[string, string, string]> = [
    ["18:30", "Doors, pizza and name tags", "Say hello, find a seat"],
    ["19:00", "Sync without a server", "Mara Okonjo"],
    ["19:25", "Merging edits for people in a hurry", "Devin Aalto"],
    ["19:50", "Shipping a notes app that works offline", "Rui Castellanos"],
  ];
  const els: DesignElement[] = [
    mono("$ meetup --city alderbrook --no 14", M, 56, 480, 13.5, { color: LIME }),
    RR(620, 46, 148, 34, 17, LIME),
    mono("FREE ENTRY", 620, 56, 148, 12.5, { align: "center", fontWeight: 700, color: BG, letterSpacing: 120 }),
    grot("Local-first\nsoftware\nnight", M - 4, 116, 700, 104, { fontWeight: 700, lineHeight: 0.98, letterSpacing: -20 }),
    R(338, 338, 40, 78, LIME),
    grot("Three short talks on apps that keep working offline, sync when they can and leave your data on your own machine.", M, 448, 640, 21, { color: GREY, lineHeight: 1.45 }),
    RR(M, 576, W - M * 2, 300, 16, PANEL, { stroke: { color: LINE, width: 1.5, style: "solid" } }),
  ];
  agenda.forEach(([time, title, who], i) => {
    const y = 596 + i * 68;
    els.push(mono(time, M + 28, y + 12, 90, 16, { fontWeight: 700, color: LIME }), grot(title, M + 136, y + 4, 540, 20, { fontWeight: 600, lineHeight: 1.2 }), mono(who, M + 136, y + 34, 540, 13));
    if (i > 0) els.push(hr(M + 28, y - 6, W - M * 2 - 56, LINE, 1));
  });
  const meta: Array<[string, string, number, number]> = [
    ["WHEN", "Thu 11 March, 18:30", M, 210],
    ["WHERE", "The Workshop, 5 Mill Row", 268, 240],
    ["RSVP", "localfirst.example.com", 524, 244],
  ];
  meta.forEach(([k, v, x, w]) => els.push(mono(k, x, 908, w, 12, { color: LIME, letterSpacing: 220, fontWeight: 700 }), grot(v, x, 930, w, 18.5, { fontWeight: 600, lineHeight: 1.25 })));
  els.push(R(0, H - 14, W, 14, LIME));
  return template(
    { slug: "local-first-meetup", category: "flyer", size: "flyer", tags: ["meetup", "tech", "developer", "talks", "agenda", "flyer", "dark", "monospace", "event", "lime"], accent: LIME },
    [pg(patternBg("grid", "#121922", BG, 1.6), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 8. Guitar lessons with tear-off tabs                                 */
/* ------------------------------------------------------------------ */

function guitarLessons(): Template {
  const CREAM = "#fff6e3";
  const MUSTARD = "#f2b233";
  const TEAL = "#0f6b6b";
  const INK = "#1f2a2a";
  const cond = font("Bebas Neue", { color: INK, lineHeight: 0.92 });
  const sans = font("Open Sans", { color: INK });
  const TABS = 8;
  const TAB_W = (W - M * 2) / TABS;
  const TEAR = 776;
  const els: DesignElement[] = [
    R(0, 0, W, 360, TEAL),
    group("Sound hole and strings", [C(610, 196, 150, MUSTARD), C(610, 196, 78, INK), ...[0, 1, 2, 3, 4, 5].map((i) => R(450, 154 + i * 17, W - 450, 2.5, CREAM, { opacity: 0.9 }))]),
    sans("LESSONS FOR EVERY AGE AND EVERY LEVEL", M, 50, 560, 13, { fontWeight: 800, letterSpacing: 280, color: CREAM }),
    cond("GUITAR\nLESSONS", M, 78, 390, 132, { color: CREAM }),
    sans("with Theo Ashdown, teaching since 2011", M, 324, 420, 16, { fontWeight: 600, color: CREAM }),
    cond("WHAT YOU GET", M, 396, 390, 40, { color: TEAL, lineHeight: 1.1 }),
    sans("A first lesson that is free\nSongs you choose, from week one\nAcoustic, electric or ukulele\nEvenings and weekends", M, 446, 400, 17, { list: "bullet", lineHeight: 1.6 }),
    RR(476, 396, 292, 172, 18, MUSTARD),
    sans("HALF-HOUR LESSON", 502, 416, 240, 13, { fontWeight: 800, letterSpacing: 260 }),
    cond("$28", 500, 438, 240, 96, { lineHeight: 1 }),
    sans("or five lessons for $120", 502, 532, 240, 15, { fontWeight: 600 }),
    hr(M, 604, W - M * 2, TEAL, 3),
    sans("“I played my first whole song within a month.”  Jo, age 52", M, 624, W - M * 2, 19, { italic: true, fontWeight: 600, color: TEAL, align: "center" }),
    hr(M, 670, W - M * 2, TEAL, 3),
    cond("TAKE A TAB, OR WRITE TO THEO@EXAMPLE.COM", M, 700, W - M * 2, 40, { align: "center", lineHeight: 1.1 }),
    L(M, TEAR, W - M, TEAR, INK, 2, { stroke: { color: INK, width: 2, style: "dashed", cap: "butt" } }),
  ];
  for (let i = 0; i < TABS; i++) {
    const cx = M + TAB_W * i + TAB_W / 2;
    const cy = (TEAR + H) / 2;
    if (i > 0) els.push(L(M + TAB_W * i, TEAR, M + TAB_W * i, H, INK, 1.5, { stroke: { color: INK, width: 1.5, style: "dashed", cap: "butt" } }));
    // two lines of 15px at line height 1.4 = 42px high, turned to read from the bottom up
    els.push(T("Guitar lessons with Theo\n555-0118  theo@example.com", cx - 125, cy - 21, 250, 15, { fontFamily: "Open Sans", fontWeight: 700, color: INK, align: "center", lineHeight: 1.4, rotation: -90 }));
  }
  return template(
    { slug: "guitar-lessons-tear-off", category: "flyer", size: "flyer", tags: ["lessons", "music", "guitar", "tutor", "tear off", "notice board", "flyer", "retro", "teal", "mustard"], accent: TEAL },
    [pg(CREAM, els)],
  );
}

export const FLYER_TEMPLATES_2: Template[] = [yogaSchedule(), cleanupDay(), localFirstMeetup(), guitarLessons()];
