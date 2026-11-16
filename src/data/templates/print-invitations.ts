/** Four invitations (480 x 672): wedding, birthday party, baby shower, corporate gala. */
import type { DesignElement, Template } from "@/core/types";
import { C, F, RR, S, T, gradientBg, patternBg, pg, template } from "./dsl";
import { diamond, font, frame, gxw, hr, ring } from "./print-kit";


/* ------------------------------------------------------------------ */
/* 1. Wedding with script type                                          */
/* ------------------------------------------------------------------ */

function weddingScript(): Template {
  const IVORY = "#fbf6ec";
  const SAGE = "#728a6e";
  const GREEN = "#374c3f";
  const GOLD = "#b8924f";
  const INK = "#4a4f46";
  const script = font("Great Vibes", { color: GREEN });
  const serif = font("Cormorant Garamond", { color: INK });
  const els: DesignElement[] = [
    frame(18, 18, 444, 636, GOLD, 1.6),
    frame(26, 26, 428, 620, GOLD, 0.8),
    gxw("nature-olive-branch", 32, 32, 88, { flipV: true }),
    gxw("nature-olive-branch", 360, 32, 88, { flipV: true, flipH: true }),
    gxw("nature-olive-branch", 32, 552, 96),
    gxw("nature-olive-branch", 352, 552, 96, { flipH: true }),
    serif("TOGETHER WITH THEIR FAMILIES", 40, 124, 400, 12.5, { align: "center", textCase: "upper", letterSpacing: 260, fontWeight: 600, color: SAGE }),
    script("Eleanor", 40, 152, 400, 70, { align: "center", lineHeight: 1 }),
    serif("&", 40, 206, 400, 34, { align: "center", italic: true, color: GOLD, lineHeight: 1 }),
    script("James", 40, 246, 400, 70, { align: "center", lineHeight: 1 }),
    serif("request the pleasure of your company\nat their wedding celebration", 40, 338, 400, 16.5, { align: "center", italic: true, lineHeight: 1.45 }),
    hr(150, 396, 180, GOLD, 1),
    serif("SATURDAY", 40, 424, 150, 14, { align: "right", textCase: "upper", letterSpacing: 300, fontWeight: 600, color: GREEN }),
    script("12", 190, 392, 100, 74, { align: "center", lineHeight: 1.05, color: GREEN }),
    serif("JUNE 2027", 290, 424, 150, 14, { align: "left", textCase: "upper", letterSpacing: 300, fontWeight: 600, color: GREEN }),
    hr(150, 472, 180, GOLD, 1),
    serif("at four o'clock in the afternoon", 40, 486, 400, 17, { align: "center", italic: true }),
    serif("THE ORCHARD HOUSE AT LINDEN FARM", 40, 520, 400, 13.5, { align: "center", textCase: "upper", letterSpacing: 200, fontWeight: 700, color: GREEN }),
    serif("1420 Meadow Lane\nHudson Valley, New York", 40, 540, 400, 16.5, { align: "center", italic: true, lineHeight: 1.35 }),
    serif("Dinner and dancing to follow", 40, 586, 400, 16, { align: "center", italic: true, color: GOLD, fontWeight: 600 }),
    serif("RSVP BY MAY 1  *  (845) 555-0116", 40, 616, 400, 11.5, { align: "center", textCase: "upper", letterSpacing: 200, fontWeight: 700, color: SAGE }),
  ];
  return template(
    { slug: "wedding-script", category: "invitation", size: "invitation", tags: ["wedding", "invitation", "script", "elegant", "botanical", "olive", "ivory", "romantic"], accent: GOLD },
    [pg(IVORY, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 2. Birthday party                                                    */
/* ------------------------------------------------------------------ */

function birthdayParty(): Template {
  const NAVY = "#1f1a45";
  const YELLOW = "#ffd23f";
  const PINK = "#ff5c9a";
  const AQUA = "#37d3e3";
  const CREAM = "#fff6e6";
  const pop = font("Righteous", { color: YELLOW });
  const sans = font("Poppins", { color: CREAM });
  const els: DesignElement[] = [
    gxw("celebration-bunting", 36, 0, 408),
    sans("YOU'RE INVITED TO", 40, 214, 400, 13, { align: "center", color: AQUA, fontWeight: 700, letterSpacing: 340 }),
    pop("Zoe's", 40, 236, 400, 98, { align: "center", lineHeight: 1.05, effect: { kind: "shadow", color: PINK, offset: 55, direction: 50, blur: 0, transparency: 0 } }),
    pop("8th Birthday Bash", 40, 346, 400, 34, { align: "center", color: PINK, lineHeight: 1.1 }),
    S("star-4", 66, 262, 34, 34, AQUA),
    S("star-4", 392, 292, 26, 26, PINK),
    S("star-4", 360, 226, 18, 18, YELLOW),
    // details card
    RR(34, 412, 412, 166, 22, CREAM),
    gxw("celebration-balloons", 4, 352, 84),
    F(332, 386, 116, 116, "ellipse"),
    ring(390, 444, 61, YELLOW, 6),
    S("star-4", 304, 478, 30, 30, AQUA),
  ];
  const rows: Array<[string, string, string]> = [
    ["WHEN", "Saturday, March 20", "2:00 to 5:00 PM"],
    ["WHERE", "Skyline Trampoline Park", "88 Harbor Road, Portland"],
  ];
  rows.forEach(([k, v, s], i) => {
    const y = 436 + i * 68;
    els.push(
      C(86, y + 20, 5, i === 0 ? PINK : AQUA),
      sans(k, 104, y + 4, 200, 11, { color: "#7a6fb5", fontWeight: 700, letterSpacing: 300 }),
      T(v, 104, y + 22, 250, 21, { fontFamily: "Righteous", color: NAVY, lineHeight: 1.1 }),
      sans(s, 104, y + 46, 250, 13.5, { color: "#4a4375", fontWeight: 500 }),
    );
  });
  els.push(
    sans("Pizza, cake and a whole lot of jumping!", 40, 594, 400, 14.5, { align: "center", color: YELLOW, fontWeight: 600 }),
    sans("RSVP to Dana by March 10: (503) 555-0187", 40, 622, 400, 12.5, { align: "center", color: CREAM, fontWeight: 500 }),
  );
  return template(
    { slug: "birthday-bash", category: "invitation", size: "invitation", tags: ["birthday", "party", "invitation", "kids", "confetti", "fun", "navy", "colorful"], accent: PINK },
    [pg(patternBg("dots", "#2c2660", NAVY, 1.2), els)],
  );
}

/* ------------------------------------------------------------------ */
/* 3. Baby shower                                                       */
/* ------------------------------------------------------------------ */

function babyShower(): Template {
  const CREAM = "#fff7ea";
  const BLUSH = "#f8cfd3";
  const MINT = "#cdeadf";
  const ROSE = "#b95f78";
  const INK = "#55506b";
  const script = font("Dancing Script", { color: ROSE, fontWeight: 700 });
  const sans = font("Nunito", { color: INK });
  const els: DesignElement[] = [
    C(40, 60, 120, BLUSH),
    C(448, 640, 132, MINT),
    C(470, 190, 56, "#ffe9a8"),
    frame(20, 20, 440, 632, "#e9bcc3", 2, { stroke: { color: "#e9bcc3", width: 2, style: "dashed" } }),
    gxw("nature-rainbow", 150, 48, 180),
    gxw("nature-moon-stars", 52, 66, 66),
    sans("A LITTLE ONE IS ON THE WAY", 40, 190, 400, 12.5, { align: "center", letterSpacing: 300, fontWeight: 800, color: "#c0899b" }),
    script("Baby Shower", 40, 214, 400, 78, { align: "center", lineHeight: 1.1 }),
    sans("in honor of", 40, 304, 400, 15, { align: "center", color: "#7a7590" }),
    script("Olivia Martin", 40, 326, 400, 58, { align: "center", lineHeight: 1.1, color: INK }),
    hr(190, 400, 100, "#e9bcc3", 2),
    sans("SUNDAY, APRIL 25  *  2 PM", 40, 420, 400, 14.5, { align: "center", letterSpacing: 240, fontWeight: 800 }),
    sans("The Garden Room\n118 Willow Street, Asheville", 40, 450, 400, 17, { align: "center", lineHeight: 1.5 }),
    sans("Games, cake and a sweet little gift for baby.\nHosted by Aunt Rosa and Grace.", 40, 524, 400, 15, { align: "center", lineHeight: 1.55, color: "#6b6685" }),
    sans("RSVP by April 11  *  (828) 555-0171", 40, 596, 300, 12.5, { align: "left", letterSpacing: 160, fontWeight: 800, color: ROSE }),
    gxw("celebration-balloons", 362, 552, 88),
  ];
  return template(
    { slug: "baby-shower", category: "invitation", size: "invitation", tags: ["baby shower", "invitation", "baby", "pastel", "rainbow", "cute", "girl", "celebration"], accent: ROSE },
    [pg(CREAM, els)],
  );
}

/* ------------------------------------------------------------------ */
/* 4. Corporate gala                                                    */
/* ------------------------------------------------------------------ */

function corporateGala(): Template {
  const GOLD = "#c9a45c";
  const GOLD_L = "#ecd9a8";
  const MIST = "#a9b4cf";
  const cin = font("Cinzel", { color: GOLD_L });
  const sans = font("Josefin Sans", { color: MIST });
  const els: DesignElement[] = [
    frame(20, 20, 440, 632, GOLD, 1.6),
    frame(30, 30, 420, 612, GOLD, 0.8),
    diamond(240, 30, 7, GOLD),
    diamond(240, 642, 7, GOLD),
    diamond(30, 336, 7, GOLD),
    diamond(450, 336, 7, GOLD),
    // monogram ring
    ring(240, 112, 36, GOLD, 1.8),
    ring(240, 112, 30, GOLD, 0.8),
    cin("M", 190, 82, 100, 40, { align: "center", fontWeight: 700, lineHeight: 1.2, color: GOLD }),
    cin("THE MERIDIAN FOUNDATION", 40, 168, 400, 14, { align: "center", letterSpacing: 300, color: MIST }),
    T("ANNUAL", 40, 214, 400, 26, { fontFamily: "Cinzel", align: "center", letterSpacing: 700, color: GOLD_L, lineHeight: 1.2 }),
    T("GALA", 40, 246, 400, 92, {
      fontFamily: "Cinzel",
      fontWeight: 700,
      align: "center",
      letterSpacing: 120,
      lineHeight: 1,
      gradient: { type: "linear", angle: 180, stops: [{ offset: 0, color: "#f6e7bd" }, { offset: 0.55, color: "#d9b46a" }, { offset: 1, color: "#a8803c" }] },
      color: GOLD,
    }),
    hr(120, 372, 100, GOLD, 1),
    diamond(240, 373, 5, GOLD),
    hr(260, 372, 100, GOLD, 1),
    sans("AN EVENING OF GIVING AND MUSIC", 40, 396, 400, 13, { align: "center", letterSpacing: 260, fontWeight: 600, color: GOLD }),
    cin("Saturday, November 13, 2027", 40, 436, 400, 22, { align: "center", color: "#ffffff", lineHeight: 1.2 }),
    sans("RECEPTION 6:30 PM   *   DINNER 7:30 PM", 40, 474, 400, 13, { align: "center", letterSpacing: 220, fontWeight: 600 }),
    cin("The Grand Ballroom", 40, 518, 400, 20, { align: "center", color: GOLD_L, lineHeight: 1.2 }),
    sans("Hotel Aldridge, 400 Park Avenue, Chicago", 40, 548, 400, 14, { align: "center", letterSpacing: 60 }),
    sans("BLACK TIE", 40, 586, 400, 12.5, { align: "center", letterSpacing: 420, fontWeight: 700, color: GOLD }),
    sans("RSVP BY OCTOBER 22  *  events@meridianfoundation.org", 40, 610, 400, 11, { align: "center", letterSpacing: 140, fontWeight: 400 }),
  ];
  return template(
    { slug: "corporate-gala", category: "invitation", size: "invitation", tags: ["gala", "corporate", "invitation", "black tie", "formal", "fundraiser", "navy", "gold"], accent: GOLD },
    [pg(gradientBg(180, "#0b1530", "#101d42", "#0b1530"), els)],
  );
}

export const INVITATION_TEMPLATES: Template[] = [weddingScript(), birthdayParty(), babyShower(), corporateGala()];

