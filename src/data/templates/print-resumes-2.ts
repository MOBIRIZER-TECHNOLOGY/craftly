/** Three more resumes (816 x 1056): editorial serif, banded header with a monogram, a grid of cards for a student. */
import type { DesignElement, Template } from "@/core/types";
import { C, F, R, RR, pg, template } from "./dsl";
import { est, font, hr, ring, vr } from "./print-kit";

const W = 816;

/* ------------------------------------------------------------------ */
/* 5. Editorial serif resume                                            */
/* ------------------------------------------------------------------ */

function editorialSerif(): Template {
  const PAPER = "#faf6ee";
  const INK = "#23201b";
  const RUST = "#9c4a2f";
  const RULE = "#d9cfbc";
  const GREY = "#5f584d";
  const serif = font("Fraunces", { color: INK });
  const sans = font("Manrope", { color: INK });
  const X = 56;
  const LW = 436;
  const RX = 540;
  const RW = 220;
  const els: DesignElement[] = [
    serif("Imogen\nCastellane", X - 4, 40, 520, 92, { fontWeight: 400, lineHeight: 0.96, letterSpacing: -15 }),
    sans("imogen@example.com\n555-0127\nAlderbrook\nimogen.example.com", RX, 56, RW, 13, { align: "right", color: GREY, fontWeight: 600, lineHeight: 1.7 }),
    sans("SECONDARY SCHOOL ENGLISH TEACHER", X, 236, 500, 13, { fontWeight: 700, letterSpacing: 300, color: RUST }),
    hr(X, 276, W - X * 2, INK, 1.5),
    vr(516, 304, 690, RULE, 1.5),
  ];
  // Manrope sets about 0.45 em per character here; est() with that width matches the measured line counts
  const EM = 0.45;
  let y = 300;
  const section = (title: string) => {
    els.push(serif(title, X, y, LW, 23, { italic: true, fontWeight: 500, lineHeight: 1.2 }));
    y += 42;
  };
  const bullets = (lines: string[]) => {
    const text = lines.join("\n");
    els.push(sans(text, X, y, LW, 14, { list: "bullet", lineHeight: 1.55 }));
    y += est(text, LW - 19, 14, 1.55, EM);
  };
  const profile = "English teacher with eleven years in state secondary schools. I build reading cultures: classroom libraries, a review magazine run by students and exam results that have risen five years in a row.";
  section("Profile");
  els.push(sans(profile, X, y, LW, 14.5, { lineHeight: 1.6 }));
  y += est(profile, LW, 14.5, 1.6, EM) + 34;
  section("Experience");
  const jobs: Array<[string, string, string, string[]]> = [
    ["Head of English", "Wrenfield Academy", "2021 - Now", ["Lead a department of nine teachers and two assistants.", "Raised the share of top grades in literature from 24% to 37%.", "Started a lunchtime reading club that now has 140 members."]],
    ["English Teacher", "Mill Row High School", "2016 - 2021", ["Taught ages 11 to 18, with two exam classes each year.", "Founded Margins, a magazine written and edited by students."]],
    ["Teaching Assistant", "Larch Lane Primary School", "2014 - 2016", ["Supported reading groups for 60 pupils in years 5 and 6."]],
  ];
  jobs.forEach(([role, org, dates, lines]) => {
    els.push(sans(role, X, y, LW - 110, 15.5, { fontWeight: 700 }), sans(dates, X + LW - 110, y + 2, 110, 12.5, { align: "right", color: GREY, fontWeight: 600 }), serif(org, X, y + 25, LW, 15.5, { italic: true, color: RUST }));
    y += 56;
    bullets(lines);
    y += 28;
  });
  y += 6;
  section("Training and talks");
  bullets(["Speaker at the county Reading for Pleasure day, 2025", "Examiner for the regional exam board since 2019", "Mentor on the new-teacher programme, four trainees so far"]);

  let ry = 304;
  const side = (title: string) => {
    els.push(sans(title, RX, ry, RW, 12, { fontWeight: 700, letterSpacing: 280, color: RUST }));
    ry += 28;
  };
  side("EDUCATION");
  els.push(
    sans("PGCE, Secondary English", RX, ry, RW, 14, { fontWeight: 700 }),
    sans("Port Merrow University, 2014", RX, ry + 22, RW, 13, { color: GREY }),
    sans("BA English Literature", RX, ry + 54, RW, 14, { fontWeight: 700 }),
    sans("Alder College, 2013", RX, ry + 76, RW, 13, { color: GREY }),
  );
  ry += 136;
  side("SKILLS");
  els.push(sans("Curriculum design\nExam preparation\nMentoring new teachers\nSafeguarding lead, level 3\nDebate coaching", RX, ry, RW, 13.5, { lineHeight: 1.85 }));
  ry += 5 * 25 + 36;
  side("LANGUAGES");
  els.push(sans("English, native\nItalian, fluent\nFrench, classroom level", RX, ry, RW, 13.5, { lineHeight: 1.85 }));
  ry += 3 * 25 + 36;
  side("OUTSIDE SCHOOL");
  els.push(sans("Fell running, letterpress printing and a very slow novel.", RX, ry, RW, 13.5, { lineHeight: 1.6 }));
  ry += 44 + 36;
  side("REFERENCES");
  els.push(sans("From my current head teacher and a former colleague, on request.", RX, ry, RW, 13.5, { lineHeight: 1.6 }));
  return template(
    { slug: "editorial-serif", category: "resume", size: "resume", tags: ["resume", "cv", "editorial", "serif", "teacher", "education", "elegant", "two column", "warm"], accent: RUST },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 6. Banded header with a monogram                                     */
/* ------------------------------------------------------------------ */

function bandedMonogram(): Template {
  const TEAL = "#0f5e63";
  const MINT = "#dff3ef";
  const INK = "#17282a";
  const GREY = "#4d6466";
  const CORAL = "#e9684d";
  const WHITE = "#ffffff";
  const sans = font("Plus Jakarta Sans", { color: INK });
  const X = 48;
  const LW = 452;
  const RX = 540;
  const RW = 228;
  const els: DesignElement[] = [
    R(0, 0, W, 190, TEAL),
    C(116, 95, 56, MINT),
    sans("RO", 60, 70, 112, 40, { align: "center", fontWeight: 800, color: TEAL, lineHeight: 1.2 }),
    sans("Rosalind Okoye", 200, 42, 568, 44, { fontWeight: 800, color: WHITE, lineHeight: 1.15 }),
    sans("Registered Nurse, Emergency Care", 200, 100, 568, 18, { fontWeight: 500, color: MINT }),
    sans("rosalind@example.com   ·   555-0152   ·   Port Merrow", 200, 142, 568, 13, { fontWeight: 600, color: WHITE }),
    RR(X, 214, W - X * 2, 80, 14, MINT),
    sans("Emergency nurse with eight years in a 40-bed department. Calm in a full waiting room, exact with handovers, and the person new starters are sent to shadow.", X + 24, 231, W - X * 2 - 48, 15, { lineHeight: 1.55 }),
  ];
  const tab = (title: string, x: number, y: number, w: number) => els.push(RR(x, y, w, 26, 13, TEAL), sans(title, x, y + 6, w, 11.5, { align: "center", fontWeight: 700, letterSpacing: 220, color: WHITE }));

  // Plus Jakarta Sans sets about 0.46 em per character at this size
  const EM = 0.46;
  let y = 326;
  tab("EXPERIENCE", X, y, 132);
  y += 48;
  const jobs: Array<[string, string, string, string[]]> = [
    ["Senior Staff Nurse", "Port Merrow General Hospital", "2022 - Now", ["Run triage on nights for a department that sees 190 patients a day.", "Cut the average handover from 14 minutes to 8.", "Train and sign off six newly qualified nurses each year."]],
    ["Staff Nurse, Emergency", "Alderbrook Infirmary", "2018 - 2022", ["Cared for adults and children across minors, majors and resus.", "Led the ward's move to electronic observations.", "Joined the winter surge team three years running."]],
    ["Healthcare Assistant", "Wrenfield Community Hospital", "2016 - 2018", ["Supported a 28-bed rehabilitation ward on rotating shifts.", "Finished the care certificate in my first twelve weeks."]],
  ];
  const bullets = (lines: string[]) => {
    const text = lines.join("\n");
    els.push(sans(text, X, y, LW, 14, { list: "bullet", lineHeight: 1.6 }));
    y += est(text, LW - 19, 14, 1.6, EM);
  };
  jobs.forEach(([role, org, dates, lines]) => {
    els.push(sans(role, X, y, LW - 110, 15.5, { fontWeight: 700 }), sans(dates, X + LW - 110, y + 2, 110, 12.5, { align: "right", color: GREY, fontWeight: 600 }), sans(org, X, y + 25, LW, 14, { fontWeight: 600, color: TEAL }));
    y += 54;
    bullets(lines);
    y += 30;
  });
  y += 4;
  tab("TRAINING", X, y, 112);
  y += 44;
  bullets(["Major incident response, Port Merrow General, 2026", "Teaching and assessing in practice, 2024"]);

  let ry = 326;
  tab("LICENCES", RX, ry, 112);
  els.push(sans("Registered Nurse, adult\nImmediate Life Support\nPaediatric Life Support\nManual handling trainer", RX, ry + 44, RW, 13.5, { lineHeight: 1.8 }));
  ry += 44 + 4 * 24.3 + 36;
  tab("SKILLS", RX, ry, 88);
  ["Triage", "IV therapy", "Wound care", "Mentoring", "Rota planning"].forEach((s, i) => {
    const sy = ry + 46 + i * 27;
    els.push(R(RX, sy + 5, 8, 8, CORAL), sans(s, RX + 20, sy, RW - 20, 13.5, { lineHeight: 1.3 }));
  });
  ry += 46 + 5 * 27 + 32;
  tab("EDUCATION", RX, ry, 120);
  els.push(sans("BSc Adult Nursing", RX, ry + 44, RW, 14, { fontWeight: 700 }), sans("Port Merrow University, 2016", RX, ry + 66, RW, 13, { color: GREY }));
  ry += 66 + 20 + 36;
  tab("VOLUNTEERING", RX, ry, 150);
  els.push(sans("First aider for the Alderbrook Harriers running club", RX, ry + 44, RW, 13.5, { lineHeight: 1.55 }));
  ry += 44 + 42 + 36;
  tab("LANGUAGES", RX, ry, 124);
  els.push(sans("English and Igbo", RX, ry + 44, RW, 13.5));
  els.push(R(0, 1040, W, 16, TEAL));
  return template(
    { slug: "banded-monogram", category: "resume", size: "resume", tags: ["resume", "cv", "nurse", "healthcare", "monogram", "header", "teal", "clean", "two column"], accent: TEAL },
    [pg("#ffffff", els)],
  );
}

/* ------------------------------------------------------------------ */
/* 7. Card grid resume for a student                                    */
/* ------------------------------------------------------------------ */

function cardGrid(): Template {
  const BG = "#eceefb";
  const CARD = "#ffffff";
  const INK = "#1b1d3a";
  const INDIGO = "#4338ca";
  const BODY = "#3d4060";
  const GREY = "#585b7a";
  const PEACH = "#ffd9c7";
  const LIME = "#d9f2c4";
  const SKY = "#cfe3ff";
  const head = font("Poppins", { color: INK });
  const body = font("Nunito", { color: INK });
  const els: DesignElement[] = [];
  const card = (x: number, y: number, w: number, h: number, title: string) => els.push(RR(x, y, w, h, 22, CARD), head(title, x + 24, y + 22, w - 48, 12, { fontWeight: 700, letterSpacing: 260, color: INDIGO }));

  els.push(
    RR(40, 40, 736, 150, 24, INDIGO),
    F(64, 64, 102, 102, "ellipse", { name: "Portrait", alt: "Placeholder: drop a portrait here" }),
    ring(115, 115, 53, CARD, 4),
    head("Kai Lindqvist", 190, 58, 560, 40, { fontWeight: 700, color: CARD, lineHeight: 1.15 }),
    body("Final-year student, BSc Computer Science", 190, 112, 560, 17, { fontWeight: 700, color: "#dcd9ff" }),
    body("kai@example.com   ·   555-0109   ·   kai.example.com", 190, 146, 560, 13.5, { fontWeight: 600, color: CARD }),
  );

  card(40, 206, 440, 160, "ABOUT");
  els.push(body("I like small, useful software and the people who use it. I want a graduate role where I can ship features, pair with seniors and learn how good teams work.", 64, 252, 392, 15, { lineHeight: 1.5 }));
  card(496, 206, 280, 160, "EDUCATION");
  els.push(head("BSc Computer Science", 520, 252, 232, 15, { fontWeight: 600 }), body("Port Merrow University\n2024 - 2027, on track for a first", 520, 278, 232, 14, { color: GREY, lineHeight: 1.5 }));

  card(40, 382, 736, 262, "PROJECTS");
  const projects: Array<[string, string, string, string]> = [
    ["Bus Buddy", "A campus bus timetable that works with no signal. 900 students open it every week.", "REACT NATIVE, SQLITE", PEACH],
    ["Lab Booker", "Replaced a paper sign-up sheet for the 3D printers with a booking page and reminder emails.", "PYTHON, POSTGRES", LIME],
    ["Tiny Compiler", "A compiler for a toy language, written to understand parsing. Used in two first-year tutorials.", "RUST", SKY],
  ];
  projects.forEach(([name, text, tech, tint], i) => {
    const x = 64 + i * 236;
    els.push(RR(x, 430, 212, 8, 4, tint), head(name, x, 452, 212, 16, { fontWeight: 600 }), body(text, x, 482, 212, 14, { color: BODY, lineHeight: 1.5 }), body(tech, x, 584, 212, 12, { fontWeight: 800, letterSpacing: 140, color: INDIGO }));
  });

  card(40, 660, 328, 356, "EXPERIENCE");
  els.push(
    head("Software Intern", 64, 708, 280, 15, { fontWeight: 600 }),
    body("Fieldwork Research, summer 2026", 64, 732, 280, 13, { fontWeight: 700, color: INDIGO }),
    body("Built an export used by 40 teams.\nWrote the tests the old code never had.\nDemoed my work to the whole company.", 64, 758, 280, 14, { list: "bullet", color: BODY, lineHeight: 1.5 }),
    head("Peer Tutor", 64, 872, 280, 15, { fontWeight: 600 }),
    body("Intro to Programming, 2025 to now", 64, 896, 280, 13, { fontWeight: 700, color: INDIGO }),
    body("Run a weekly drop-in for 30 first-years.\nWrote ten new practice problems.", 64, 922, 280, 14, { list: "bullet", color: BODY, lineHeight: 1.5 }),
  );
  card(384, 660, 168, 356, "SKILLS");
  ["TypeScript", "Python", "SQL", "Git", "Testing", "Figma"].forEach((s, i) => {
    const y = 708 + i * 46;
    els.push(RR(404, y, 128, 32, 16, [PEACH, LIME, SKY][i % 3]), body(s, 404, y + 7, 128, 13, { align: "center", fontWeight: 700 }));
  });
  card(568, 660, 208, 356, "ALSO");
  const also: Array<[string, string]> = [
    ["Sport", "Captain of the university ultimate frisbee team"],
    ["Volunteering", "A weekend code club for ages 9 to 12"],
    ["Languages", "Swedish and English"],
  ];
  also.forEach(([k, v], i) => {
    const y = 708 + i * 96;
    els.push(head(k, 592, y, 160, 14.5, { fontWeight: 600 }), body(v, 592, y + 24, 160, 13.5, { color: BODY, lineHeight: 1.5 }));
  });
  return template(
    { slug: "card-grid-student", category: "resume", size: "resume", tags: ["resume", "cv", "student", "graduate", "entry level", "cards", "modern", "projects", "indigo", "friendly"], accent: INDIGO },
    [pg(BG, els)],
  );
}

export const RESUME_TEMPLATES_2: Template[] = [editorialSerif(), bandedMonogram(), cardGrid()];
