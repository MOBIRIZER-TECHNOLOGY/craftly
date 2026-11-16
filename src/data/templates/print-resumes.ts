/** Four resumes (816 x 1056): modern sidebar, minimalist, creative color header, executive classic. */
import type { DesignElement, Template } from "@/core/types";
import { C, F, R, RR, S, pg, template } from "./dsl";
import { est, font, hr, ring, vr } from "./print-kit";

const W = 816;
const H = 1056;

/* ------------------------------------------------------------------ */
/* 1. Modern two-column resume with a sidebar                           */
/* ------------------------------------------------------------------ */

function modernSidebar(): Template {
  const NAVY = "#15233b";
  const TEAL = "#1fb5a8";
  const TEAL_D = "#12857b";
  const INK = "#1b2433";
  const GREY = "#5c6677";
  const LIGHT = "#d9e3f0";
  const PAPER = "#fdfdfc";
  const head = font("Outfit", { color: INK });
  const sans = font("DM Sans", { color: INK });
  const SB = 264;
  const sx = 34;
  const sw = SB - sx * 2;
  const els: DesignElement[] = [R(0, 0, SB, H, NAVY), F(66, 48, 132, 132, "ellipse"), ring(132, 114, 68, TEAL, 4)];
  const sideHead = (t: string, y: number) => head(t, sx, y, sw, 13.5, { color: TEAL, fontWeight: 600, letterSpacing: 280 });

  els.push(sideHead("CONTACT", 224));
  ["amara.okafor@email.com", "(415) 555-0178", "San Francisco, California", "amaraokafor.design"].forEach((c, i) => els.push(sans(c, sx, 254 + i * 28, sw, 15, { color: LIGHT })));

  els.push(sideHead("SKILLS", 396));
  const skills: Array<[string, number]> = [
    ["Product strategy", 0.95],
    ["UX research", 0.9],
    ["Prototyping in Figma", 0.95],
    ["Design systems", 0.85],
    ["HTML and CSS", 0.7],
  ];
  skills.forEach(([s, p], i) => {
    const y = 428 + i * 50;
    els.push(sans(s, sx, y, sw, 15, { color: LIGHT }), RR(sx, y + 28, sw, 5, 2.5, "rgba(255,255,255,0.16)"), RR(sx, y + 28, Math.round(sw * p), 5, 2.5, TEAL));
  });

  els.push(
    sideHead("EDUCATION", 706),
    sans("B.Des, Interaction Design", sx, 736, sw, 15.5, { fontWeight: 700, color: "#ffffff" }),
    sans("California College\nof the Arts", sx, 760, sw, 15, { color: LIGHT, lineHeight: 1.35 }),
    sans("2012 - 2016", sx, 812, sw, 15, { color: TEAL }),
    sideHead("LANGUAGES", 868),
    sans("English, native\nIgbo, fluent\nSpanish, conversational", sx, 898, sw, 15, { color: LIGHT, lineHeight: 1.7 }),
  );

  // main column
  const X = 304;
  const MW = W - X - 40;
  const profile = "Product designer with nine years of experience shaping fintech and health apps used by millions. I turn messy problems into simple, accessible interfaces and lead small teams that ship thoughtfully and often.";
  els.push(
    head("Amara Okafor", X, 44, MW, 52, { fontWeight: 700, lineHeight: 1.1 }),
    head("Senior Product Designer", X, 106, MW, 22, { fontWeight: 500, color: TEAL_D, lineHeight: 1.2 }),
    sans(profile, X, 158, MW, 16.5, { lineHeight: 1.55, color: INK }),
  );
  let y = 158 + est(profile, MW, 16.5, 1.55, 0.5) + 38;
  const section = (title: string) => {
    els.push(head(title, X, y, MW, 14.5, { fontWeight: 600, letterSpacing: 280, color: NAVY }), hr(X, y + 28, MW, NAVY, 2));
    y += 50;
  };
  const job = (role: string, org: string, dates: string, bullets: string[]) => {
    els.push(sans(role, X, y, MW - 130, 17.5, { fontWeight: 700 }), sans(dates, X + MW - 130, y + 1, 130, 15, { align: "right", color: GREY }), sans(org, X, y + 26, MW, 15.5, { color: TEAL_D, fontWeight: 600 }));
    const text = bullets.join("\n");
    els.push(sans(text, X, y + 58, MW, 15.5, { list: "bullet", lineHeight: 1.5, color: "#2a3445" }));
    y += 58 + est(text, MW - 20, 15.5, 1.5, 0.5) + 40;
  };
  section("EXPERIENCE");
  job("Senior Product Designer", "Lumen Health, San Francisco", "2021 - Present", [
    "Led the redesign of the patient portal, raising task completion from 71% to 93%.",
    "Built a design system of 140 components now used by six product teams.",
    "Mentored four designers and started weekly critiques.",
  ]);
  job("Product Designer", "Brightpath Finance, Oakland", "2018 - 2021", [
    "Redesigned onboarding, cutting sign-up drop-off by 38%.",
    "Ran 60+ usability sessions to shape the savings roadmap.",
  ]);
  job("UX Designer", "Studio Fenn, San Francisco", "2016 - 2018", ["Shipped web and mobile projects for 12 retail clients."]);
  section("RECOGNITION");
  els.push(sans("Webby Honoree 2023, Health and Wellness category\nSpeaker, Config 2022: Designing for accessibility at scale", X, y, MW, 15.5, { list: "bullet", lineHeight: 1.6, color: "#2a3445" }));
  return template(
    { slug: "modern-sidebar", category: "resume", size: "resume", tags: ["resume", "cv", "modern", "two column", "sidebar", "designer", "navy", "teal"], accent: TEAL },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Minimalist single-column resume                                   */
/* ------------------------------------------------------------------ */

function minimalist(): Template {
  const INK = "#111111";
  const GREY = "#6b6b6b";
  const RULE = "#dcdcdc";
  const ACC = "#d9480f";
  const sans = font("Inter", { color: INK });
  const mono = font("JetBrains Mono", { color: GREY });
  const X = 64;
  const LW = 136;
  const CX = 216;
  const CW = W - CX - 64;
  const els: DesignElement[] = [
    sans("Daniel Reyes", X, 54, 520, 46, { fontWeight: 600, letterSpacing: -20, lineHeight: 1.1 }),
    mono("Software engineer, backend and data", X, 110, 480, 14, { color: ACC }),
    mono("daniel@reyes.dev\n+1 (206) 555-0134\nSeattle, Washington\ngithub.com/dreyes", 512, 58, 240, 13.5, { align: "right", lineHeight: 1.6 }),
    hr(X, 172, W - X * 2, INK, 1.5),
  ];
  let y = 198;
  const label = (t: string) => els.push(mono(t, X, y + 4, LW, 12.5, { letterSpacing: 160, fontWeight: 600, color: INK }));
  const sep = () => {
    els.push(hr(X, y, W - X * 2, RULE, 1));
    y += 30;
  };
  // summary
  const summary = "Backend engineer with seven years of experience building reliable data platforms and APIs. I enjoy untangling legacy systems, writing clear docs and keeping the on-call rota quiet.";
  label("SUMMARY");
  els.push(sans(summary, CX, y, CW, 16.5, { lineHeight: 1.6 }));
  y += est(summary, CW, 16.5, 1.6, 0.5) + 22;
  sep();
  // experience
  label("EXPERIENCE");
  const jobs: Array<[string, string, string[]]> = [
    ["Staff Engineer, Northwind Logistics", "2022 - NOW", ["Own the event pipeline behind shipment tracking, processing 1.2 billion events a month.", "Cut p99 API latency from 900 ms to 140 ms by moving hot paths to Go.", "Lead a team of six and run the architecture review group."]],
    ["Senior Engineer, Cobalt Payments", "2019 - 2022", ["Designed the ledger service that settles $4B in payments each year.", "Introduced contract testing, halving integration bugs in two quarters."]],
    ["Software Engineer, Tidewater Labs", "2017 - 2019", ["Built internal tools and data pipelines for a 40-person research team."]],
  ];
  jobs.forEach(([t, d, bl], i) => {
    els.push(sans(t, CX, y, CW - 110, 16.5, { fontWeight: 600 }), mono(d, CX + CW - 110, y + 3, 110, 13, { align: "right", color: GREY }));
    const text = bl.join("\n");
    els.push(sans(text, CX, y + 28, CW, 15, { lineHeight: 1.5, list: "bullet", color: "#2d2d2d" }));
    y += 28 + est(text, CW - 19, 15, 1.5, 0.5) + (i < jobs.length - 1 ? 26 : 28);
  });
  sep();
  // education
  label("EDUCATION");
  els.push(
    sans("B.S. Computer Science, University of Washington", CX, y, CW - 110, 16.5, { fontWeight: 600 }),
    mono("2013 - 2017", CX + CW - 110, y + 3, 110, 13, { align: "right", color: GREY }),
    sans("Graduated with honors; teaching assistant for Operating Systems", CX, y + 28, CW, 15, { color: "#2d2d2d" }),
  );
  y += 28 + 22 + 22;
  sep();
  // skills
  label("SKILLS");
  const skills: Array<[string, string]> = [
    ["Languages", "Go, Python, TypeScript, SQL, Bash"],
    ["Data", "Postgres, Kafka, Redis, dbt, BigQuery"],
    ["Platform", "Kubernetes, Terraform, AWS, OpenTelemetry"],
  ];
  skills.forEach(([k, v], i) => els.push(sans(k, CX, y + i * 27, 110, 15, { fontWeight: 600 }), sans(v, CX + 112, y + i * 27, CW - 112, 15, { color: "#2d2d2d" })));
  y += skills.length * 27 + 10;
  sep();
  // open source
  label("OPEN SOURCE");
  els.push(
    sans("pgwatch", CX, y, 110, 15, { fontWeight: 600 }),
    sans("A Postgres query-monitoring CLI with 2.1k stars on GitHub.", CX + 112, y, CW - 112, 15, { color: "#2d2d2d" }),
    sans("logtail-go", CX, y + 27, 110, 15, { fontWeight: 600 }),
    sans("Structured log shipping library used by 300+ projects.", CX + 112, y + 27, CW - 112, 15, { color: "#2d2d2d" }),
  );
  return template(
    { slug: "minimal-engineer", category: "resume", size: "resume", tags: ["resume", "cv", "minimalist", "clean", "software", "engineer", "single column", "mono"], accent: ACC },
    [pg("#ffffff", els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Creative resume with a color header                              */
/* ------------------------------------------------------------------ */

function creativeHeader(): Template {
  const CORAL = "#ff6b57";
  const CORAL_L = "#ff8a78";
  const PLUM = "#2a1740";
  const LEMON = "#ffd166";
  const MINT = "#9de0d0";
  const LILAC = "#cdbfff";
  const GREY = "#5d526b";
  const BODY = "#3a2f4a";
  const PAPER = "#fffaf6";
  const head = font("Syne", { color: PLUM });
  const sans = font("Work Sans", { color: PLUM });
  const els: DesignElement[] = [
    R(0, 0, W, 268, CORAL),
    C(752, 30, 124, CORAL_L),
    S("star-4", 612, 38, 46, 46, LEMON),
    head("Priya Nair", 48, 52, 560, 70, { fontWeight: 800, lineHeight: 1.05 }),
    sans("Illustrator and Art Director", 52, 140, 520, 23, { fontWeight: 600 }),
    sans("priya@nairstudio.co     (646) 555-0122     Brooklyn, New York", 52, 204, 540, 15.5, { fontWeight: 500 }),
    F(610, 164, 156, 156, "ellipse"),
    ring(688, 242, 82.5, PAPER, 9),
  ];
  const LX = 48;
  const LW = 448;
  let y = 312;
  const sec = (t: string) => {
    els.push(head(t, LX, y, LW, 19, { fontWeight: 700 }), R(LX, y + 30, 36, 4, CORAL));
    y += 52;
  };
  const about = "Illustrator and art director with eight years of experience building playful, story-led visual identities for publishers, food brands and children's media. I love turning a rough brief into a world people want to live in.";
  sec("About me");
  els.push(sans(about, LX, y, LW, 15.5, { lineHeight: 1.55, color: BODY }));
  y += est(about, LW, 15.5, 1.55, 0.5) + 34;
  sec("Experience");
  const top = y;
  const jobs: Array<[string, string, string, string[]]> = [
    ["Art Director", "Fable & Fern Publishing", "2020 - Now", ["Lead a team of five illustrators and designers on 40+ picture books a year.", "Developed a signature color system that lifted reorder rates by 22%."]],
    ["Senior Illustrator", "Pinwheel Kids Media", "2017 - 2020", ["Created characters and storyboards for an animated series seen by 3M viewers.", "Illustrated packaging for six national snack brands."]],
    ["Freelance Illustrator", "Self-employed, Brooklyn", "2014 - 2017", ["Clients included The Marlowe Review, Common Table Foods and the Brooklyn Botanic Garden."]],
  ];
  jobs.forEach(([role, org, dates, bl], i) => {
    els.push(
      C(LX + 7, y + 11, 7, i === 0 ? CORAL : i === 1 ? "#7b5cff" : "#2ec4b6"),
      head(role, LX + 28, y, 260, 17, { fontWeight: 700, lineHeight: 1.2 }),
      sans(dates, LX + LW - 120, y + 2, 120, 14, { align: "right", color: GREY, fontWeight: 600 }),
      sans(org, LX + 28, y + 27, LW - 28, 15, { color: "#e5473a", fontWeight: 700 }),
    );
    const text = bl.join("\n");
    els.push(sans(text, LX + 28, y + 54, LW - 28, 15, { list: "bullet", lineHeight: 1.5, color: BODY }));
    y += 54 + est(text, LW - 28 - 19, 15, 1.5, 0.5) + 28;
  });
  els.push(vr(LX + 6, top + 18, y - top - 52, LILAC, 3));
  // right column
  const RX = 536;
  const RW = 232;
  let ry = 340;
  const rsec = (t: string) => {
    els.push(head(t, RX, ry, RW, 19, { fontWeight: 700 }), R(RX, ry + 30, 36, 4, CORAL));
    ry += 48;
  };
  rsec("Skills");
  const chipRows: Array<Array<[string, number, string]>> = [
    [["Character design", 117, LEMON], ["Lettering", 62, MINT]],
    [["Brand identity", 98, MINT], ["Packaging", 69, LILAC]],
    [["Art direction", 87, LILAC], ["Storyboarding", 97, LEMON]],
  ];
  chipRows.forEach((row, r) => {
    let cx = RX;
    row.forEach(([t, tw, col]) => {
      const w = tw + 21;
      els.push(RR(cx, ry + r * 40, w, 31, 15.5, col), sans(t, cx, ry + r * 40 + 7, w, 14, { align: "center", fontWeight: 600 }));
      cx += w + 6;
    });
  });
  ry += chipRows.length * 40 + 18;
  rsec("Tools");
  els.push(sans("Procreate, Illustrator, Photoshop, After Effects and Figma", RX, ry, RW, 15.5, { lineHeight: 1.55, color: BODY }));
  ry += est("Procreate, Illustrator, Photoshop, After Effects and Figma", RW, 15.5, 1.55, 0.5) + 22;
  rsec("Education");
  els.push(
    sans("BFA Illustration", RX, ry, RW, 15.5, { fontWeight: 700 }),
    sans("Rhode Island School of Design", RX, ry + 24, RW, 15, { color: BODY, lineHeight: 1.35 }),
    sans("2010 - 2014", RX, ry + 64, RW, 15, { color: "#e5473a", fontWeight: 700 }),
  );
  ry += 96;
  rsec("Recognition");
  els.push(sans("Society of Illustrators Gold Medal, 2022\nCommunication Arts Award of Excellence, 2021", RX, ry, RW, 15, { lineHeight: 1.5, color: BODY }));
  return template(
    { slug: "creative-header", category: "resume", size: "resume", tags: ["resume", "cv", "creative", "colorful", "illustrator", "portfolio", "coral", "artist"], accent: CORAL },
    [pg(PAPER, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Executive classic                                                 */
/* ------------------------------------------------------------------ */

function executiveClassic(): Template {
  const NAVY = "#1b2a4a";
  const INK = "#1f2430";
  const GREY = "#5a6070";
  const head = font("Playfair Display", { color: NAVY });
  const body = font("Lora", { color: INK });
  const X = 64;
  const CW = W - X * 2;
  const els: DesignElement[] = [
    head("CATHERINE WHITMORE", X, 40, CW, 38, { align: "center", fontWeight: 700, letterSpacing: 140, lineHeight: 1.1 }),
    body("Chief Financial Officer  |  CPA, MBA", X, 90, CW, 18, { align: "center", italic: true, color: GREY }),
    hr(X, 124, CW, NAVY, 3),
    hr(X, 131, CW, NAVY, 1),
    body("Chicago, Illinois   |   (312) 555-0149   |   c.whitmore@email.com   |   linkedin.com/in/cwhitmore", X, 144, CW, 14.5, { align: "center", color: GREY }),
  ];
  let y = 184;
  const sec = (t: string) => {
    els.push(head(t, X, y, CW, 14.5, { fontWeight: 700, letterSpacing: 220 }), hr(X, y + 24, CW, "#b8bfce", 1));
    y += 36;
  };
  sec("PROFESSIONAL SUMMARY");
  const summary = "Finance executive with 18 years of experience leading planning, treasury and investor relations for growth-stage and public companies. Delivered $240M in cumulative cost savings, guided two IPO preparations and built finance teams known for clear numbers and calm decisions.";
  els.push(body(summary, X, y, CW, 15, { lineHeight: 1.55, align: "justify" }));
  y += est(summary, CW, 15, 1.55, 0.5) + 20;

  sec("CORE COMPETENCIES");
  const comps = ["FP&A and forecasting", "Capital markets and IPOs", "M&A integration", "Treasury and risk", "SEC reporting and SOX", "Investor relations"];
  comps.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = X + col * (CW / 3);
    els.push(S("diamond", x, y + row * 26 + 6, 8, 8, NAVY), body(c, x + 18, y + row * 26, CW / 3 - 22, 15, { lineHeight: 1.3 }));
  });
  y += 2 * 26 + 12;

  sec("PROFESSIONAL EXPERIENCE");
  const jobs: Array<[string, string, string, string[]]> = [
    ["Chief Financial Officer", "Halvorsen Industrial Group, $1.4B manufacturer, Chicago, IL", "2019 - Present", ["Lead a 65-person finance team across FP&A, accounting, tax and treasury.", "Directed the 2022 refinancing of $380M in debt, reducing annual interest expense by $9.6M.", "Introduced driver-based budgeting and rolling forecasts, improving forecast accuracy to within 2 percent."]],
    ["Vice President, Finance", "Lakeshore Medical Devices, Evanston, IL", "2013 - 2019", ["Prepared the company for its 2017 IPO, from audit remediation to roadshow materials.", "Integrated three acquisitions totaling $210M, delivering $18M in synergies within two years."]],
    ["Senior Finance Manager", "Midwest Grain & Foods, Chicago, IL", "2007 - 2013", ["Built the first global treasury function, cutting foreign-exchange losses by 40 percent."]],
  ];
  jobs.forEach(([role, org, dates, bl]) => {
    els.push(body(role, X, y, 420, 16, { fontWeight: 700 }), body(dates, X + CW - 160, y + 1, 160, 15, { align: "right", color: GREY }), body(org, X, y + 23, CW, 15, { italic: true, color: GREY }));
    const text = bl.join("\n");
    els.push(body(text, X, y + 48, CW, 15, { list: "bullet", lineHeight: 1.45 }));
    y += 48 + est(text, CW - 19, 15, 1.45, 0.5) + 14;
  });

  sec("EDUCATION AND AFFILIATIONS");
  const half = CW / 2;
  els.push(
    body("MBA, Finance", X, y, half - 20, 15, { fontWeight: 700 }),
    body("Kellogg School of Management, 2007", X, y + 22, half - 20, 15, { color: GREY }),
    body("B.S., Accounting", X, y + 50, half - 20, 15, { fontWeight: 700 }),
    body("University of Illinois, 2002", X, y + 72, half - 20, 15, { color: GREY }),
    body("Certified Public Accountant", X + half, y, half, 15, { fontWeight: 700 }),
    body("Illinois, licensed since 2004", X + half, y + 22, half, 15, { color: GREY }),
    body("Board Treasurer", X + half, y + 50, half, 15, { fontWeight: 700 }),
    body("Chicago Youth Symphony, 2018 - Present", X + half, y + 72, half, 15, { color: GREY }),
  );
  return template(
    { slug: "executive-classic", category: "resume", size: "resume", tags: ["resume", "cv", "executive", "classic", "traditional", "finance", "navy", "serif"], accent: NAVY },
    [pg("#fefefe", els)],
  );
}

export const RESUME_TEMPLATES: Template[] = [modernSidebar(), minimalist(), creativeHeader(), executiveClassic()];
