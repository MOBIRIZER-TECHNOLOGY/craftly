/**
 * Two more banners (1920 x 480): a light festival banner with illustrations and a date card, and a dark
 * podcast cover with a photo and a waveform. Same kit and rules as the first four in banners.ts.
 */
import type { Template } from "@/core/types";
import { C, R, RR, T, template } from "./dsl";
import { group } from "./print-kit";
import { atBase, atCap, gfx, hrule, photo, slide, vshade } from "./presentations-kit";

/* ================================================================== 5 reading festival (1920 x 480) */
function festivalBanner(): Template {
  const CREAM = "#f7efe0";
  const RUST = "#a8461f";
  const FOREST = "#23483a";
  const MUSTARD = "#e9b23c";
  const INK = "#26221c";
  const FRAUNCES = "Fraunces";
  const MANROPE = "Manrope";
  const CARD_X = 1540;

  return template(
    {
      slug: "reading-festival",
      category: "banner",
      size: "banner",
      tags: ["festival", "books", "reading", "library", "banner", "event", "autumn", "literature", "header", "cream", "green"],
      accent: FOREST,
    },
    [
      slide(
        "Festival banner",
        CREAM,
        [
          C(266, 250, 196, MUSTARD, { name: "Sun disc" }),
          gfx("objects-books-stack", 120, 150, 250),
          gfx("education-open-book", 318, 292, 150),
          T("THE WRENFIELD LIBRARY PRESENTS", 560, atCap(MANROPE, 26, 1.2, 76), 900, 26, { fontFamily: MANROPE, fontWeight: 800, letterSpacing: 240, color: RUST, name: "Kicker" }),
          T("Autumn Reading\nFestival", 556, atCap(FRAUNCES, 104, 1.0, 132), 940, 104, { fontFamily: FRAUNCES, fontWeight: 600, letterSpacing: -15, color: FOREST, lineHeight: 1.0, name: "Headline" }),
          T("Forty authors, a book swap and stories read aloud under the oak.", 560, 376, 940, 28, { fontFamily: MANROPE, fontWeight: 500, color: INK, lineHeight: 1.4, name: "Subline" }),
          RR(CARD_X, 72, 284, 336, 28, FOREST, { name: "Date card" }),
          T("9–11", CARD_X, atCap(FRAUNCES, 100, 1.0, 118), 284, 100, { fontFamily: FRAUNCES, fontWeight: 700, color: CREAM, align: "center", lineHeight: 1.0, name: "Dates" }),
          T("OCTOBER", CARD_X, atCap(MANROPE, 30, 1.2, 222), 284, 30, { fontFamily: MANROPE, fontWeight: 800, letterSpacing: 300, color: MUSTARD, align: "center", name: "Month" }),
          hrule(CARD_X + 110, 284, 64, MUSTARD, 3),
          T("Free entry", CARD_X, atBase(MANROPE, 28, 1.2, 346), 284, 28, { fontFamily: MANROPE, fontWeight: 600, color: CREAM, align: "center", name: "Note" }),
        ],
        "Change the name, the dates and the line under the headline. Keep the headline to two lines.",
      ),
    ],
  );
}

/* ================================================================== 6 podcast cover (1920 x 480) */
function podcastBanner(): Template {
  const DEEP = "#0c2a2e";
  const ORANGE = "#ff8a3d";
  const CREAM = "#f6efe2";
  const SOFT = "#b9d0cf";
  const BEBAS = "Bebas Neue";
  const INTER = "Inter";
  // heights of the bars of the waveform, in px
  const bars = [18, 34, 52, 30, 64, 44, 72, 38, 56, 24, 46, 68, 36, 58, 28, 50, 70, 40, 22, 54, 32, 62, 26, 44];

  return template(
    {
      slug: "podcast-cover",
      category: "banner",
      size: "banner",
      tags: ["podcast", "channel", "cover", "banner", "audio", "show", "travel", "header", "dark", "teal", "orange"],
      accent: ORANGE,
    },
    [
      slide(
        "Podcast banner",
        DEEP,
        [
          photo("forest-mist", 1080, 0, 840, 480, { fy: 0.35, name: "Photo", alt: "Misty forest" }),
          // starts left of the photo, so that the photo's own edge is under the opaque end of the fade
          R(1060, 0, 720, 480, vshade([[0, 1], [0.3, 0.9], [0.65, 0.5], [1, 0]], "12,42,46", 90), { name: "Fade" }),
          R(1080, 0, 840, 480, "rgba(12,42,46,0.3)", { name: "Tint" }),
          T("A PODCAST ABOUT SLOW TRAVEL", 96, atCap(INTER, 26, 1.2, 66), 900, 26, { fontFamily: INTER, fontWeight: 700, letterSpacing: 280, color: ORANGE, name: "Kicker" }),
          T("FIELD NOTES", 92, atCap(BEBAS, 196, 1.0, 116), 960, 196, { fontFamily: BEBAS, color: CREAM, lineHeight: 1.0, letterSpacing: 10, name: "Show name" }),
          T("New episodes every Thursday, wherever you listen.", 96, 282, 940, 28, { fontFamily: INTER, fontWeight: 500, color: SOFT, lineHeight: 1.4, name: "Subline" }),
          group(
            "Waveform",
            bars.map((h, i) => RR(96 + i * 18, 392 - h / 2, 10, h, 5, ORANGE)),
          ),
          T("fieldnotes.example.com", 560, atBase(INTER, 28, 1.2, 402), 520, 28, { fontFamily: INTER, fontWeight: 600, color: CREAM, name: "Web address" }),
          RR(1580, 60, 244, 64, 32, ORANGE, { name: "Season pill" }),
          T("SEASON 4", 1580, atBase(INTER, 26, 1.2, 60 + 41), 244, 26, { fontFamily: INTER, fontWeight: 800, letterSpacing: 200, color: DEEP, align: "center", name: "Season" }),
        ],
        "Swap the photo, the name of the show and the season. The waveform is a group: move it as one.",
      ),
    ],
  );
}

export const BANNER_TEMPLATES_2: Template[] = [festivalBanner(), podcastBanner()];
