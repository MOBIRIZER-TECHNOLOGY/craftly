/** Three multi-page documents (794 x 1123): annual report, proposal, one-page newsletter. */
import type { DesignElement, Template } from "@/core/types";
import { C, R, RR, pg, template } from "./dsl";
import { fade, font, hr, ph, vr } from "./print-kit";

const W = 794;
const M = 56;

/* ------------------------------------------------------------------ */
/* 1. Annual impact report: cover + inner page                          */
/* ------------------------------------------------------------------ */

function impactReport(): Template {
  const FOREST = "#123c2f";
  const LIME = "#c9e265";
  const CREAM = "#f6f4ec";
  const MIST = "#a9c4b8";
  const INK = "#17231e";
  const GREY = "#4a5a52";

  const serifC = font("DM Serif Display", { color: CREAM });
  const sansC = font("DM Sans", { color: CREAM });
  const serif = font("DM Serif Display", { color: INK });
  const sans = font("DM Sans", { color: INK });

  const cover: DesignElement[] = [
    C(M + 11, 66, 11, LIME),
    sansC("GREENWAY FOUNDATION", M + 32, 58, 360, 13, { letterSpacing: 300, fontWeight: 700, color: LIME }),
    sansC("ANNUAL IMPACT REPORT", 438, 58, 300, 13, { align: "right", letterSpacing: 300, fontWeight: 500, color: MIST }),
    hr(M, 96, W - M * 2, "#2f6552", 1.5),
    serifC("Growing greener,\ntogether.", M, 150, W - M * 2, 84, { lineHeight: 1.04 }),
    sansC("Our 2026 impact report: 12,480 trees, 17 community gardens and 42 new green careers across the Pacific Northwest.", M, 352, 500, 20, { color: MIST, lineHeight: 1.55 }),
    ph("rolling-fields", M, 520, W - M * 2, 440, { radius: 26, fx: 0.5, fy: 0.6 }),
    C(668, 520, 70, LIME),
    serifC("2026", 598, 492, 140, 46, { align: "center", color: FOREST, lineHeight: 1.1 }),
    sansC("REPORT", 598, 542, 140, 12, { align: "center", color: FOREST, letterSpacing: 300, fontWeight: 700 }),
    hr(M, 1018, W - M * 2, "#2f6552", 1.5),
    sansC("Published March 2027", M, 1040, 300, 14, { color: MIST }),
    sansC("greenwayfoundation.org", 438, 1040, 300, 14, { align: "right", color: LIME, fontWeight: 700 }),
  ];

  const bars: Array<[string, number, string]> = [
    ["2022", 2900, "2.9k"],
    ["2023", 4600, "4.6k"],
    ["2024", 7200, "7.2k"],
    ["2025", 9850, "9.9k"],
    ["2026", 12480, "12.5k"],
  ];
  const chartBase = 872;
  const inner: DesignElement[] = [
    R(0, 0, W, 10, FOREST),
    sans("01  /  OUR YEAR", M, 46, 300, 12, { letterSpacing: 300, fontWeight: 700, color: "#5a7a1a" }),
    serif("Our year in review", M, 68, W - M * 2, 46, { lineHeight: 1.1 }),
    sans("In 2026 Greenway planted more trees, opened more gardens and trained more neighbors than in any year since our founding. None of it happened alone.", M, 134, 640, 19, { lineHeight: 1.5, color: FOREST }),
    sans(
      "This year we set out to make green space a normal part of every block, not a destination. With 214 volunteers and 38 partner schools, we planted 12,480 trees across 19 neighborhoods, from the hillside streets of Eastbank to the industrial edge of the river district. Survival rates held at 91 percent after the first summer, up from 84 percent in 2025, thanks to watering crews who adopted every sapling on their route.",
      M,
      252,
      326,
      13.5,
      { lineHeight: 1.6, color: GREY },
    ),
    sans(
      "Our community gardens grew from 11 to 17 sites, and for the first time more than half of the produce was donated to local pantries. The Roots apprenticeship, our paid training program for young adults, welcomed 42 graduates, 31 of whom now work in landscaping, urban forestry or the parks department. We are grateful to every donor, volunteer and partner who made the year possible.",
      412,
      252,
      326,
      13.5,
      { lineHeight: 1.6, color: GREY },
    ),
    // key figures
  ];
  const figs: Array<[string, string]> = [
    ["12,480", "trees planted across 19 neighborhoods"],
    ["17", "community gardens, up from eleven sites"],
    ["42", "apprentices trained and placed in jobs"],
  ];
  figs.forEach(([n, l], i) => {
    const x = M + i * 232;
    inner.push(
      RR(x, 520, 218, 112, 16, FOREST),
      serifC(n, x + 22, 536, 180, 46, { color: LIME, lineHeight: 1.1 }),
      sansC(l, x + 22, 590, 176, 13, { color: MIST, lineHeight: 1.35 }),
    );
  });
  // chart
  inner.push(sans("Trees planted per year", M, 668, 320, 15, { fontWeight: 700 }), hr(M, chartBase, 400, INK, 1.5));
  bars.forEach(([yr, v, lab], i) => {
    const h = Math.round((v / 12480) * 150);
    const x = M + 8 + i * 78;
    inner.push(
      RR(x, chartBase - h, 52, h, 6, i === 4 ? FOREST : "#9cc2ac"),
      sans(lab, x - 10, chartBase - h - 22, 72, 12, { align: "center", fontWeight: 700 }),
      sans(yr, x - 10, chartBase + 10, 72, 12, { align: "center", color: GREY }),
    );
  });
  // pull quote
  inner.push(
    vr(498, 676, 190, LIME, 5),
    serif("“Every tree on this street has a name, and a neighbor who checks in.”", 520, 672, 218, 20, { lineHeight: 1.35, italic: true, color: FOREST }),
    sans("Amina Hassan", 520, 810, 218, 13, { fontWeight: 700 }),
    sans("Eastbank volunteer since 2019", 520, 828, 218, 12, { color: GREY }),
    // call to action
    RR(M, 934, W - M * 2, 92, 18, LIME),
    serif("Grow with us in 2027", M + 28, 950, 380, 26, { color: FOREST, lineHeight: 1.1 }),
    sans("Volunteer, donate or host a planting day on your street.", M + 28, 986, 380, 14, { color: FOREST }),
    sans("greenwayfoundation.org/join", 430, 970, 276, 16, { align: "right", fontWeight: 700, color: FOREST }),
    hr(M, 1062, W - M * 2, "#cfd6cb", 1),
    sans("Greenway Foundation  |  Annual Impact Report 2026", M, 1074, 460, 11, { color: GREY }),
    sans("02", W - M - 60, 1074, 60, 11, { align: "right", fontWeight: 700 }),
  );
  return template(
    { slug: "impact-report", name: "Greenway Annual Impact Report", category: "document", size: "document", tags: ["report", "annual report", "nonprofit", "document", "impact", "a4", "green", "summary"], accent: FOREST },
    [pg(FOREST, cover), pg(CREAM, inner)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Proposal: cover + scope and investment page                       */
/* ------------------------------------------------------------------ */

function brandProposal(): Template {
  const NAVY = "#101a2e";
  const TERRA = "#d9623f";
  const CREAM = "#f7f3ec";
  const MIST = "#aab4c8";
  const SAND = "#e6ddcf";
  const INK = "#18202f";
  const GREY = "#566074";
  const head = font("Syne", { color: INK });
  const headC = font("Syne", { color: CREAM });
  const sans = font("Inter", { color: INK });
  const sansC = font("Inter", { color: CREAM });

  const cover: DesignElement[] = [
    ph("mountain-lake", 0, 0, W, 600, { fx: 0.5, fy: 0.5 }),
    R(0, 380, W, 222, fade(180, "rgba(16,26,46,0)", NAVY)),
    sansC("NORTHBOUND STUDIO", M, 56, 360, 13, { letterSpacing: 360, fontWeight: 700 }),
    sansC("PROPOSAL NO. 2026-041", 400, 56, 338, 13, { align: "right", letterSpacing: 300, fontWeight: 500 }),
    R(M, 604, 72, 6, TERRA),
    headC("Brand Refresh\n& Website Redesign", M, 634, W - M * 2, 56, { fontWeight: 700, lineHeight: 1.1 }),
    sansC("A proposal for Harbor & Pine Outfitters, covering brand strategy, a new identity system and an eight-page website.", M, 770, 520, 18, { color: MIST, lineHeight: 1.55 }),
    hr(M, 944, W - M * 2, "#2b3855", 1.5),
  ];
  const meta: Array<[string, string, string]> = [
    ["PREPARED FOR", "Harbor & Pine Outfitters", "Tacoma, Washington"],
    ["PREPARED BY", "Northbound Studio", "hello@northbound.studio"],
    ["VALID UNTIL", "December 15, 2026", "Issued November 4, 2026"],
  ];
  meta.forEach(([k, v, s], i) => {
    const x = M + i * 232;
    cover.push(
      sansC(k, x, 972, 210, 11, { letterSpacing: 300, fontWeight: 700, color: TERRA }),
      sansC(v, x, 996, 214, 15.5, { fontWeight: 600, lineHeight: 1.3 }),
      sansC(s, x, 1020, 214, 13, { color: MIST }),
    );
  });

  const phases: Array<[string, string, string, string]> = [
    ["01", "Discover", "Weeks 1 - 2", "Stakeholder interviews, a competitor audit and a half-day brand workshop to agree the strategy."],
    ["02", "Design", "Weeks 3 - 6", "Logo, color, typography and a modular identity system, with two rounds of review."],
    ["03", "Build", "Weeks 7 - 11", "A fast, accessible eight-page website with CMS training and two weeks of launch support."],
  ];
  const page: DesignElement[] = [
    sans("01  /  SCOPE AND INVESTMENT", M, 52, 400, 11, { letterSpacing: 300, fontWeight: 700, color: TERRA }),
    sans("Harbor & Pine Outfitters", 438, 52, 300, 11, { align: "right", color: GREY }),
    head("Scope of work", M, 82, W - M * 2, 38, { fontWeight: 700, lineHeight: 1.1 }),
    sans("We propose three phases over eleven weeks. Each ends with a review, so you always know where the project stands and what comes next.", M, 140, 600, 15, { lineHeight: 1.6, color: GREY }),
  ];
  phases.forEach(([n, t, w, d], i) => {
    const x = M + i * 232;
    page.push(
      RR(x, 218, 218, 214, 16, "#ffffff", { stroke: { color: SAND, width: 1.5, style: "solid" } }),
      head(n, x + 20, 234, 60, 14, { fontWeight: 700, color: TERRA, letterSpacing: 100 }),
      head(t, x + 20, 258, 180, 26, { fontWeight: 700, lineHeight: 1.1 }),
      sans(w.toUpperCase(), x + 20, 296, 180, 10.5, { letterSpacing: 200, fontWeight: 600, color: GREY }),
      sans(d, x + 20, 322, 180, 13, { lineHeight: 1.55, color: INK }),
    );
  });
  // timeline
  const unit = (W - M * 2) / 11;
  page.push(
    sans("Timeline, 11 weeks", M, 468, 300, 13, { fontWeight: 700 }),
    RR(M, 494, unit * 2 - 3, 30, 15, NAVY),
    RR(M + unit * 2, 494, unit * 4 - 3, 30, 15, TERRA),
    RR(M + unit * 6, 494, unit * 5, 30, 15, "#8d9ab4"),
    sansC("Discover", M, 503, unit * 2 - 3, 11, { align: "center", fontWeight: 700 }),
    sansC("Design", M + unit * 2, 503, unit * 4 - 3, 11, { align: "center", fontWeight: 700 }),
    sansC("Build and launch", M + unit * 6, 503, unit * 5, 11, { align: "center", fontWeight: 700 }),
    // investment
    head("Investment", M, 568, 400, 30, { fontWeight: 700, lineHeight: 1.1 }),
    hr(M, 616, W - M * 2, INK, 2),
  );
  const rows: Array<[string, string, string]> = [
    ["Brand strategy workshop", "Half-day session, positioning brief", "$4,500"],
    ["Logo and identity system", "Primary and secondary marks, palette, type", "$9,800"],
    ["Website design and build", "Eight pages, CMS, analytics setup", "$14,200"],
    ["Brand guidelines", "32-page PDF with usage examples", "$2,400"],
  ];
  rows.forEach(([t, d, p], i) => {
    const y = 630 + i * 56;
    page.push(
      sans(t, M, y, 400, 15, { fontWeight: 600 }),
      sans(d, M, y + 22, 420, 12.5, { color: GREY }),
      sans(p, 560, y + 4, 178, 15, { align: "right", fontWeight: 600 }),
      hr(M, y + 48, W - M * 2, SAND, 1),
    );
  });
  page.push(
    RR(M, 868, W - M * 2, 56, 12, NAVY),
    sansC("Total investment", M + 22, 886, 300, 15, { fontWeight: 600 }),
    headC("$30,900", 500, 880, 216, 24, { align: "right", fontWeight: 700 }),
    sans("Payment: 50 percent on signing, 25 percent at design approval, 25 percent at launch. Prices exclude sales tax. Stock photography and font licenses are billed at cost.", M, 944, W - M * 2, 12, { lineHeight: 1.6, color: GREY }),
    hr(M, 1048, 300, INK, 1.2),
    hr(M + 340, 1048, 342, INK, 1.2),
    sans("Harbor & Pine Outfitters  /  date", M, 1056, 300, 11, { color: GREY }),
    sans("Nadia Okonkwo, Northbound Studio  /  date", M + 340, 1056, 342, 11, { color: GREY }),
  );
  return template(
    { slug: "brand-proposal", name: "Northbound Brand Proposal", category: "document", size: "document", tags: ["proposal", "business", "document", "agency", "quote", "pricing", "a4", "navy"], accent: TERRA },
    [pg(NAVY, cover), pg(CREAM, page)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. One-page newsletter                                               */
/* ------------------------------------------------------------------ */

function courierNewsletter(): Template {
  const PAPER = "#f6efe1";
  const INK = "#211b15";
  const RED = "#b3382c";
  const SAGE = "#e0e6d4";
  const GREY = "#5b5247";
  const head = font("Playfair Display", { color: INK });
  const body = font("Lora", { color: INK });
  const els: DesignElement[] = [
    hr(M - 8, 42, W - (M - 8) * 2, INK, 4),
    hr(M - 8, 50, W - (M - 8) * 2, INK, 1.2),
    head("The Maple Street Courier", M - 8, 66, W - (M - 8) * 2, 58, { align: "center", fontWeight: 900, lineHeight: 1.05 }),
    hr(M - 8, 138, W - (M - 8) * 2, INK, 1.2),
    body("VOL. 16  *  ISSUE 11", M - 8, 148, 230, 11, { letterSpacing: 200, fontWeight: 700 }),
    body("Your neighborhood news since 2011", 230, 148, 334, 12, { align: "center", italic: true, color: GREY }),
    body("NOVEMBER 2026", 520, 148, 226, 11, { align: "right", letterSpacing: 200, fontWeight: 700 }),
    hr(M - 8, 170, W - (M - 8) * 2, INK, 4),
    // lead story
    body("COMMUNITY", M, 196, 300, 11, { letterSpacing: 300, fontWeight: 700, color: RED }),
    head("Holiday Market Returns to Linden Park", M, 216, 440, 36, { fontWeight: 700, lineHeight: 1.12 }),
    body("By Rosa Delgado", M, 330, 300, 12, { italic: true, color: GREY }),
    body(
      "After two quiet years, the Maple Street Holiday Market is coming back to Linden Park on Saturday, December 5, with more than 60 stalls, a hot cider contest and live music from the Eastside Brass Band.",
      M,
      358,
      440,
      13.5,
      { lineHeight: 1.6 },
    ),
    body(
      "Organizers say this is the biggest line-up yet. Gardeners from the Ninth Avenue allotments will sell wreaths, dried flowers and winter greens, and the library is hosting a free book swap from noon. Gates open at 10 a.m.; entry is free and everyone is welcome.",
      M,
      440,
      440,
      13.5,
      { lineHeight: 1.6 },
    ),
    body(
      "Parking will be tight, so organizers are asking visitors to walk, bike or take the number 9 bus, which will run every 15 minutes from the Oak Street stop until 5 p.m.",
      M,
      542,
      440,
      13.5,
      { lineHeight: 1.6 },
    ),
    ph("wildflowers", 528, 196, 210, 262, { fx: 0.5, fy: 0.55 }),
    body("Blooms from the Ninth Avenue gardeners' stall, a market favorite.", 528, 464, 210, 11, { italic: true, color: GREY, lineHeight: 1.4 }),
    vr(M + 456, 196, 400, "#cfc4ae", 1),
  ];
  // briefs row
  els.push(hr(M - 8, 616, W - (M - 8) * 2, INK, 1.2));
  const briefs: Array<[string, string, string]> = [
    ["ROADS", "Ninth Avenue repairs begin", "Crews will repair the water main on Ninth Avenue between Linden and Oak starting November 30. Expect one-lane traffic from 8 a.m. to 4 p.m. and temporary parking on Oak Street until mid-December."],
    ["LIBRARY", "Longer evening hours at the branch", "Starting this month the branch library stays open until 8 p.m. on Tuesdays and Thursdays. Homework help for grades 3 to 8 starts at 4 p.m."],
    ["KITCHEN", "Apple butter, slow and simple", "Core and chop six pounds of apples, add a cup of cider and a cinnamon stick, and let it bubble on low for four hours. Jar it warm; it keeps for a month."],
  ];
  briefs.forEach(([k, t, b], i) => {
    const x = M + i * 236;
    els.push(
      body(k, x, 634, 200, 10.5, { letterSpacing: 300, fontWeight: 700, color: RED }),
      head(t, x, 652, 212, 19, { fontWeight: 700, lineHeight: 1.18 }),
      body(b, x, 724, 212, 12.5, { lineHeight: 1.6 }),
    );
    if (i > 0) els.push(vr(x - 12, 634, 260, "#cfc4ae", 1));
  });
  // events box
  els.push(
    RR(M - 8, 908, W - (M - 8) * 2, 118, 6, SAGE),
    head("Coming up", M + 12, 922, 160, 22, { fontWeight: 700, lineHeight: 1.1 }),
  );
  const events: Array<[string, string]> = [
    ["Nov 14", "Neighborhood clean-up, fire hall, 9 a.m."],
    ["Nov 19", "Town hall on the Oak Street bike lane, 7 p.m."],
    ["Nov 26", "Thanksgiving potluck at the library, 4 p.m."],
    ["Dec 5", "Holiday Market, Linden Park, 10 a.m."],
  ];
  events.forEach(([d, t], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + 12 + col * 350;
    const y = 960 + row * 32;
    els.push(body(d, x, y, 60, 12.5, { fontWeight: 700, color: RED }), body(t, x + 62, y, 270, 12.5, { lineHeight: 1.3 }));
  });
  els.push(
    hr(M - 8, 1056, W - (M - 8) * 2, INK, 1.2),
    body("Send your news to courier@maplestreet.example or drop it at the library front desk.", M - 8, 1068, 520, 11, { italic: true, color: GREY }),
    body("Printed on recycled paper", 520, 1068, 226, 11, { align: "right", italic: true, color: GREY }),
  );
  return template(
    { slug: "maple-street-newsletter", name: "Maple Street Courier Newsletter", category: "document", size: "document", tags: ["newsletter", "community", "document", "news", "newspaper", "a4", "neighborhood", "one page"], accent: RED },
    [pg(PAPER, els)],
  );
}

export const DOCUMENT_TEMPLATES: Template[] = [impactReport(), brandProposal(), courierNewsletter()];

