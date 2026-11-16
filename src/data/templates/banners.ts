/**
 * Banners and wallpapers: a sale hero and an event banner (1920 x 480), a minimalist quote wallpaper
 * and a gradient abstract wallpaper (1920 x 1080). Same kit and rules as the presentation decks.
 */
import type { Template } from "@/core/types";
import { C, gradientBg, O, patternBg, R, RR, S, T, template } from "./dsl";
import { atBase, atCap, frame, gfx, glow, hrule, slide } from "./presentations-kit";

/* ================================================================== 1 sale hero (1920 x 480) */
function saleBanner(): Template {
  const NAVY = "#14213d";
  const YELLOW = "#ffd23f";
  const CREAM = "#fff8e8";
  const SOFT = "#d7e0f5";
  const ANTON = "Anton";
  const POP = "Poppins";

  return template(
    {
      slug: "summer-sale-hero",
      category: "banner",
      size: "banner",
      tags: ["sale", "banner", "hero", "discount", "shop", "retail", "summer", "promotion", "ecommerce", "offer", "navy", "yellow"],
      accent: YELLOW,
    },
    [
      slide(
        "Sale banner",
        gradientBg(100, NAVY, "#1f3566"),
        [
          C(1560, 240, 330, YELLOW, { name: "Sun disc" }),
          O("ellipse", 1560 - 292, 240 - 292, 584, 584, NAVY, 3, { opacity: 0.25, name: "Ring" }),
          T("UP TO", 1560 - 200, atCap(POP, 34, 1.2, 78), 400, 34, { fontFamily: POP, fontWeight: 700, letterSpacing: 300, color: NAVY, align: "center", lineHeight: 1.2, name: "Offer kicker" }),
          T("50%", 1560 - 270, atCap(ANTON, 224, 1.0, 140), 540, 224, { fontFamily: ANTON, color: NAVY, align: "center", lineHeight: 1.0, letterSpacing: -6, name: "Offer number" }),
          T("OFF", 1560 - 200, atCap(POP, 56, 1.2, 372), 400, 56, { fontFamily: POP, fontWeight: 800, letterSpacing: 360, color: NAVY, align: "center", lineHeight: 1.2, name: "Offer word" }),
          gfx("badges-starburst-sale", 1130, 250, 210, { rotation: -12 }),
          T("FREE\nRETURNS", 1130 + 15, 250 + 74, 180, 26, { fontFamily: POP, fontWeight: 800, letterSpacing: 40, color: "#ffffff", align: "center", lineHeight: 1.15, rotation: -12, name: "Sticker text" }),
          gfx("decor-sparkles", 1030, 60, 130),
          T("SUMMER SALE  /  3 TO 17 JULY", 96, atCap(POP, 26, 1.2, 62), 900, 26, { fontFamily: POP, fontWeight: 700, letterSpacing: 240, color: YELLOW, name: "Kicker" }),
          T("SUMMER SALE", 96, atCap(ANTON, 170, 1.0, 106), 1000, 170, { fontFamily: ANTON, color: CREAM, lineHeight: 1.0, letterSpacing: 4, name: "Headline" }),
          R(96, 274, 150, 8, YELLOW, { name: "Accent bar" }),
          T("Hundreds of styles. Free returns. Ends midnight Sunday.", 96, 304, 940, 28, { fontFamily: POP, fontWeight: 500, color: SOFT, lineHeight: 1.4, name: "Subline" }),
          RR(96, 366, 330, 78, 39, YELLOW, { name: "Button" }),
          T("Shop the sale", 96 + 40, atBase(POP, 28, 1.2, 366 + 50), 220, 28, { fontFamily: POP, fontWeight: 700, color: NAVY, lineHeight: 1.2, name: "Button text" }),
          S("arrow-right", 96 + 262, 366 + 25, 40, 28, NAVY, { name: "Arrow" }),
        ],
        "Change the dates, the discount and the button label. Keep the headline to two words.",
      ),
    ],
  );
}

/* ================================================================== 2 event (1920 x 480) */
function eventBanner(): Template {
  const INK = "#0e1633";
  const ORANGE = "#ff6b35";
  const CREAM = "#fdf3e7";
  const SOFT = "#cfd3ee";
  const SYNE = "Syne";
  const INTER = "Inter";

  return template(
    {
      slug: "design-summit-event",
      category: "banner",
      size: "banner",
      tags: ["event", "conference", "summit", "banner", "speakers", "tickets", "festival", "webinar", "violet", "orange", "save the date"],
      accent: ORANGE,
    },
    [
      slide(
        "Event banner",
        gradientBg(110, INK, "#2b1a63", "#5a2a8f"),
        [
          glow(1700, 80, 440, ORANGE, 0.4),
          glow(260, 520, 420, "#6a5cff", 0.45),
          T("14–16", 96, atCap(SYNE, 120, 1.0, 140), 600, 120, { fontFamily: SYNE, fontWeight: 800, letterSpacing: -20, color: CREAM, lineHeight: 1.0, name: "Dates" }),
          T("OCTOBER 2026", 96, atCap(INTER, 28, 1.2, 304), 560, 28, { fontFamily: INTER, fontWeight: 700, letterSpacing: 280, color: ORANGE, name: "Month" }),
          R(700, 120, 2, 240, "rgba(253,243,231,0.28)", { name: "Divider" }),
          T("Design\nFutures\nSummit", 756, atCap(SYNE, 60, 1.03, 112), 560, 60, { fontFamily: SYNE, fontWeight: 800, letterSpacing: -10, color: CREAM, lineHeight: 1.03, name: "Event name" }),
          T("Lisbon  /  60 speakers  /  3 days", 756, atCap(INTER, 28, 1.2, 352), 700, 28, { fontFamily: INTER, fontWeight: 500, color: SOFT, name: "Details" }),
          ...[0, 1, 2].flatMap((i) => [
            C(1384 + i * 84 + 60, 168, 66, INK, { name: "Ring" }),
            frame(1384 + i * 84, 108, 120, 120, { mask: "ellipse", name: `Speaker photo ${i + 1}` }),
          ]),
          T("+57 more", 1384 + 2 * 84 + 150, atBase(INTER, 28, 1.2, 180), 190, 28, { fontFamily: INTER, fontWeight: 600, color: CREAM, name: "More speakers" }),
          RR(1384, 276, 440, 84, 42, ORANGE, { name: "Button" }),
          T("Reserve your seat", 1384, atBase(INTER, 30, 1.2, 276 + 54), 440, 30, { fontFamily: INTER, fontWeight: 700, color: INK, align: "center", lineHeight: 1.2, name: "Button text" }),
          T("Early-bird tickets until 31 July", 1384, atBase(INTER, 26, 1.2, 408), 440, 26, { fontFamily: INTER, fontWeight: 500, color: SOFT, align: "center", name: "Note" }),
        ],
        "Swap the dates, the name and the three speaker photos. Keep the button label under four words.",
      ),
    ],
  );
}

/* ================================================================== 3 minimalist quote wallpaper (1920 x 1080) */
function quoteWallpaper(): Template {
  const PAPER = "#ece7dd";
  const INK = "#2b2a27";
  const SAGE = "#56644b";
  const FRAUNCES = "Fraunces";
  const MANROPE = "Manrope";

  return template(
    {
      slug: "minimal-quote-wallpaper",
      category: "banner",
      size: "wallpaper",
      tags: ["wallpaper", "quote", "minimal", "desktop", "background", "calm", "motivation", "beige", "serif", "mindful", "aesthetic"],
      accent: SAGE,
    },
    [
      slide(
        "Quote wallpaper",
        PAPER,
        [
          C(1500, 540, 430, "#e3dccd", { name: "Pale disc" }),
          C(1500, 540, 250, "#dcd4c1", { name: "Pale disc" }),
          C(1186, 800, 18, SAGE, { name: "Dot" }),
          T("A SMALL REMINDER", 144, atCap(MANROPE, 26, 1.2, 150), 700, 26, { fontFamily: MANROPE, fontWeight: 700, letterSpacing: 320, color: SAGE, name: "Label" }),
          T("Do less, but\nmake it count.", 144, atCap(FRAUNCES, 128, 1.04, 420), 1300, 128, { fontFamily: FRAUNCES, fontWeight: 300, italic: true, letterSpacing: -20, color: INK, lineHeight: 1.04, name: "Quote" }),
          hrule(144, 790, 96, SAGE, 3),
          T("No. 14  /  Monday", 144, atBase(MANROPE, 26, 1.2, 880), 700, 26, { fontFamily: MANROPE, fontWeight: 600, letterSpacing: 200, textCase: "upper", color: "#55604a", name: "Caption" }),
        ],
        "Edit the quote, keep it under eight words. Export at 1920 x 1080 for a desktop background.",
      ),
    ],
  );
}

/* ================================================================== 4 gradient abstract wallpaper (1920 x 1080) */
function auroraWallpaper(): Template {
  const INTER = "Inter";
  const rings = [150, 250, 350, 450];

  return template(
    {
      slug: "aurora-gradient-wallpaper",
      category: "banner",
      size: "wallpaper",
      tags: ["wallpaper", "gradient", "abstract", "aurora", "background", "desktop", "purple", "pink", "mesh", "glow", "modern"],
      accent: "#c2307d",
    },
    [
      slide(
        "Gradient wallpaper",
        gradientBg(160, "#12103a", "#3b1f7a", "#b02c80", "#ff8a5b"),
        [
          glow(300, 240, 560, "#35d4ff", 0.6),
          glow(1560, 800, 700, "#ff3d9a", 0.62),
          glow(1050, 130, 460, "#ffb347", 0.5),
          glow(860, 720, 600, "#8a5cff", 0.46),
          ...rings.map((r) => O("ellipse", 1400 - r, 400 - r, r * 2, r * 2, "#ffffff", 2, { opacity: 0.2, name: "Ring" })),
          C(1400, 400, 8, "#ffffff", { opacity: 0.85, name: "Dot" }),
          R(0, 0, 1920, 1080, patternBg("noise", "#ffffff", "#000000", 1), { opacity: 0.07, name: "Grain" }),
          T("AURORA  /  NO. 04", 96, atBase(INTER, 26, 1.2, 984), 700, 26, { fontFamily: INTER, fontWeight: 600, letterSpacing: 260, color: "#ffffff", opacity: 0.85, name: "Caption" }),
        ],
        "A calm background for a desk or a title slide. Move the glows to change the mood.",
      ),
    ],
  );
}

export const BANNER_TEMPLATES: Template[] = [saleBanner(), eventBanner(), quoteWallpaper(), auroraWallpaper()];
