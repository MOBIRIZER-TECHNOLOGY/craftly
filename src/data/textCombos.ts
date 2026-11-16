/**
 * Font combinations for the Text panel: ready-made groups of two to four text
 * boxes, each pairing typefaces, sizes, case, tracking and one accent colour.
 *
 * A combination is declared as parts stacked from top to bottom. Every length is
 * in thousandths of the design's shorter side, so a combination looks the same
 * on a slide, a poster or a story. Part heights are exact because each line of
 * copy is its own paragraph, wide enough never to wrap (the text layout uses
 * `fontSize * lineHeight` per line), which is what lets parts be stacked without
 * measuring text.
 *
 * Colours are dark or mid tones that read on a light page: near-black ink, a
 * softer grey for supporting copy and at most one accent colour per combination.
 */
import { createText } from "@/core/factory";
import type { TextAlign, TextCase, TextEffect, TextElement } from "@/core/types";
import { m } from "@/i18n";
import { nameIn } from "./names";

export interface TextCombo {
  id: string;
  name: string;
  /** Font families used, the display face first, for the panel's preview label. */
  fonts: string[];
  /** Text boxes laid out in a box whose top-left corner is (0, 0); the panel centres them on the page. */
  build(size: { width: number; height: number }): TextElement[];
}

interface Part {
  /** Copy; each "\n" starts a new line. */
  text: string;
  font: string;
  size: number;
  color: string;
  weight?: number;
  italic?: boolean;
  /** Default 1.2. */
  lineHeight?: number;
  /** Thousandths of an em. */
  spacing?: number;
  textCase?: TextCase;
  /** Defaults to the combination's alignment. */
  align?: TextAlign;
  /** Space above this part; negative values overlap the part before it. */
  gap?: number;
  /** Offset from the left edge of the box; the part's width shrinks accordingly. */
  x?: number;
  rotation?: number;
  /** Paint after the other parts, whatever its place in the stack. */
  onTop?: boolean;
  effect?: TextEffect;
}

const INK = "#111318";
const SOFT = "#4b5160";

/** The name of a combination is the catalog's, by id (`m.data.textCombos`); its copy is design content and stays as written. */
function combo(id: string, layout: { width: number; align: TextAlign }, parts: Part[]): TextCombo {
  const largestSize = (font: string) => Math.max(...parts.filter((part) => part.font === font).map((part) => part.size));
  return {
    id,
    name: nameIn(m.data.textCombos, id),
    fonts: [...new Set(parts.map((part) => part.font))].sort((a, b) => largestSize(b) - largestSize(a)),
    build({ width, height }) {
      const unit = Math.min(width, height) / 1000;
      const px = (length: number) => Math.round(length * unit);
      let y = 0;
      const placed = parts.map((part) => {
        y += px(part.gap ?? 0);
        const x = px(part.x ?? 0);
        const element = createText({
          text: part.text,
          fontFamily: part.font,
          fontWeight: part.weight ?? 400,
          italic: part.italic ?? false,
          fontSize: px(part.size),
          color: part.color,
          lineHeight: part.lineHeight ?? 1.2,
          letterSpacing: part.spacing ?? 0,
          textCase: part.textCase ?? "none",
          align: part.align ?? layout.align,
          x,
          y,
          width: px(layout.width) - x,
          autoWidth: false,
          rotation: part.rotation ?? 0,
          ...(part.effect && { effect: part.effect }),
        });
        y += element.height;
        return { element, onTop: part.onTop === true };
      });
      return [...placed.filter((p) => !p.onTop), ...placed.filter((p) => p.onTop)].map((p) => p.element);
    },
  };
}

export const TEXT_COMBOS: TextCombo[] = [
  combo("editorial", { width: 820, align: "left" }, [
    { text: "The Journal  ·  Issue 08", font: "Inter", weight: 600, size: 24, color: "#c2410c", spacing: 200, textCase: "upper" },
    { text: "Slow mornings,\nbetter days", font: "Playfair Display", weight: 700, size: 112, color: INK, lineHeight: 1.04, spacing: -12, gap: 28 },
    { text: "Notes on design, craft and the quiet\njoy of making things by hand.", font: "Inter", size: 30, color: SOFT, lineHeight: 1.5, gap: 34 },
  ]),

  combo("summer-sale", { width: 760, align: "center" }, [
    { text: "Summer", font: "Pacifico", size: 190, color: "#e11d48", align: "left", rotation: -8, onTop: true },
    { text: "Sale", font: "Anton", size: 400, color: INK, lineHeight: 0.95, spacing: 10, textCase: "upper", gap: -95 },
    { text: "Up to 50% off  ·  this weekend", font: "Anton", size: 42, color: SOFT, spacing: 160, textCase: "upper", gap: 10 },
  ]),

  combo("wedding-script", { width: 780, align: "center" }, [
    { text: "Together with their families", font: "Cormorant Garamond", weight: 600, size: 28, color: SOFT, spacing: 300, textCase: "upper" },
    { text: "Eleanor\n& James", font: "Great Vibes", size: 200, color: INK, lineHeight: 0.95, gap: 40 },
    { text: "Saturday  ·  June 14th  ·  2026", font: "Cormorant Garamond", weight: 600, size: 32, color: "#8a6a3b", spacing: 300, textCase: "upper", gap: 44 },
  ]),

  combo("poster-stack", { width: 490, align: "left" }, [
    { text: "Open\nMic", font: "Anton", size: 220, color: INK, lineHeight: 0.92, textCase: "upper" },
    { text: "Night", font: "Anton", size: 220, color: "#dc2626", lineHeight: 0.92, textCase: "upper" },
    { text: "Friday  ·  8 PM  ·  The Loft", font: "Poppins", weight: 700, size: 24, color: SOFT, spacing: 200, textCase: "upper", gap: 28 },
  ]),

  combo("luxury-caps", { width: 800, align: "center" }, [
    { text: "Maison", font: "Cormorant Garamond", weight: 500, size: 150, color: INK, lineHeight: 1, spacing: 200, textCase: "upper" },
    { text: "Parfumeur  ·  Paris", font: "Montserrat", weight: 500, size: 22, color: "#8a6a3b", spacing: 500, textCase: "upper", gap: 12 },
  ]),

  combo("big-quote", { width: 730, align: "center" }, [
    { text: "“", font: "Playfair Display", weight: 900, size: 320, color: "#c2410c", lineHeight: 0.7 },
    { text: "Make something\npeople love.", font: "Playfair Display", italic: true, size: 100, color: INK, lineHeight: 1.12, gap: -50 },
    { text: "Author name  ·  Title", font: "Inter", weight: 600, size: 24, color: SOFT, spacing: 300, textCase: "upper", gap: 44 },
  ]),

  combo("handwritten-note", { width: 670, align: "left" }, [
    { text: "Thank you,\nfriend!", font: "Caveat", weight: 700, size: 170, color: INK, lineHeight: 0.92 },
    { text: "For being part of our story this year.\nWe couldn’t have done it without you.", font: "Lato", size: 30, color: SOFT, lineHeight: 1.55, gap: 26 },
    { text: "with love, the team", font: "Caveat", weight: 600, size: 56, color: "#c2410c", gap: 20 },
  ]),

  combo("tech-grotesk", { width: 780, align: "left" }, [
    { text: "// now in beta", font: "JetBrains Mono", weight: 500, size: 24, color: "#4f46e5", spacing: 80 },
    { text: "Build the\nfuture, faster.", font: "Space Grotesk", weight: 700, size: 120, color: INK, lineHeight: 1, spacing: -40, gap: 26 },
    { text: "Tooling for modern teams.", font: "Space Grotesk", size: 34, color: SOFT, gap: 32 },
  ]),

  combo("retro-disco", { width: 720, align: "center" }, [
    { text: "Roller\ndisco", font: "Bungee", size: 160, color: "#3b2314", lineHeight: 0.98, textCase: "upper" },
    { text: "Fridays  ·  8pm till late", font: "Righteous", size: 44, color: "#c2410c", spacing: 150, gap: 30 },
  ]),

  combo("vintage-bakery", { width: 740, align: "center" }, [
    { text: "Est. 1952", font: "Lato", weight: 700, size: 24, color: "#9b1c1c", spacing: 500, textCase: "upper" },
    { text: "Hartley’s\nBakery", font: "Abril Fatface", size: 170, color: "#2b1b12", lineHeight: 0.98, gap: 18 },
    { text: "fresh bread, baked every morning", font: "Libre Baskerville", italic: true, size: 32, color: SOFT, gap: 30 },
  ]),

  combo("minimal-lowercase", { width: 620, align: "left" }, [
    { text: "01 / principles", font: "Outfit", weight: 500, size: 26, color: "#0f766e", spacing: 80, textCase: "lower" },
    { text: "less, but\nbetter.", font: "Outfit", weight: 300, size: 180, color: INK, lineHeight: 0.98, spacing: -30, textCase: "lower", gap: 30 },
    { text: "a quiet manifesto on simple design", font: "Outfit", size: 28, color: SOFT, spacing: 30, textCase: "lower", gap: 36 },
  ]),

  combo("magazine-masthead", { width: 720, align: "center" }, [
    { text: "Atelier", font: "Playfair Display", weight: 900, size: 160, color: INK, lineHeight: 1, spacing: -10, textCase: "upper" },
    { text: "Fashion  ·  Art  ·  Culture", font: "Josefin Sans", weight: 600, size: 26, color: SOFT, spacing: 450, textCase: "upper", gap: 10 },
    { text: "Issue 24  —  Autumn 2026", font: "Josefin Sans", weight: 400, size: 22, color: "#be185d", spacing: 300, textCase: "upper", gap: 22 },
  ]),

  combo("playful-rounded", { width: 780, align: "center" }, [
    { text: "Hello,\nlittle explorers!", font: "Fredoka", weight: 600, size: 108, color: "#7c3aed", lineHeight: 1 },
    { text: "Story time  ·  Saturdays at 10am", font: "Nunito", weight: 700, size: 36, color: SOFT, gap: 26 },
  ]),

  combo("brutalist-mono", { width: 690, align: "left" }, [
    { text: "[ 001 ]  Studio", font: "JetBrains Mono", weight: 500, size: 24, color: "#dc2626", spacing: 60, textCase: "upper" },
    { text: "Raw.\nUnfiltered.\nHonest.", font: "Space Mono", weight: 700, size: 104, color: INK, lineHeight: 1.02, spacing: -40, textCase: "upper", gap: 24 },
    { text: "Branding / Web / Print", font: "JetBrains Mono", weight: 500, size: 28, color: SOFT, spacing: 60, textCase: "upper", gap: 30 },
  ]),

  combo("tag-label", { width: 700, align: "left" }, [
    {
      text: "New collection",
      font: "Montserrat",
      weight: 700,
      size: 26,
      color: "#4c1d95",
      spacing: 200,
      textCase: "upper",
      x: 11,
      effect: { kind: "background", color: "#ddd6fe", roundness: 100, spread: 100 },
    },
    { text: "Autumn\nEssentials", font: "DM Serif Display", size: 150, color: INK, lineHeight: 1, gap: 36 },
    { text: "Shop the season’s softest knits", font: "Montserrat", size: 30, color: SOFT, gap: 28 },
  ]),

  combo("modern-serif", { width: 770, align: "left" }, [
    { text: "Beautiful things\ntake time.", font: "DM Serif Display", size: 104, color: INK, lineHeight: 1.04 },
    { text: "A studio for brand, packaging\nand print design.", font: "DM Sans", size: 32, color: SOFT, lineHeight: 1.5, gap: 34 },
    { text: "hello@studio.com", font: "DM Sans", weight: 600, size: 26, color: "#be185d", gap: 24 },
  ]),

  combo("statement", { width: 690, align: "left" }, [
    { text: "Make it\nyours.", font: "Bricolage Grotesque", weight: 800, size: 200, color: INK, lineHeight: 0.92, spacing: -50 },
    { text: "Custom designs, made in minutes.", font: "Manrope", weight: 500, size: 34, color: SOFT, gap: 52 },
  ]),

  combo("cosy-cafe", { width: 740, align: "center" }, [
    { text: "Cosy Corner\nCafé", font: "Fraunces", weight: 600, size: 116, color: "#3b2417", lineHeight: 1 },
    { text: "Coffee  ·  Tea  ·  Pastries", font: "Work Sans", weight: 600, size: 26, color: "#b45309", spacing: 350, textCase: "upper", gap: 26 },
  ]),

  combo("roman-caps", { width: 710, align: "center" }, [
    { text: "The grand\nopening", font: "Cinzel", weight: 700, size: 98, color: INK, lineHeight: 1.12, spacing: 60, textCase: "upper" },
    { text: "join us for an evening of music and wine", font: "Lora", italic: true, size: 34, color: SOFT, gap: 24 },
    { text: "Saturday  ·  7 PM", font: "Cinzel", size: 26, color: "#7f1d1d", spacing: 400, textCase: "upper", gap: 38 },
  ]),

  combo("marker-energy", { width: 680, align: "left" }, [
    { text: "This Saturday", font: "Open Sans", weight: 800, size: 24, color: "#2563eb", spacing: 200, textCase: "upper" },
    { text: "Let’s get\ncreative!", font: "Permanent Marker", size: 150, color: INK, lineHeight: 1, rotation: -3, gap: 16 },
    { text: "Free workshops every Saturday.\nBring a friend, bring your ideas.", font: "Open Sans", weight: 600, size: 30, color: SOFT, lineHeight: 1.5, gap: 30 },
  ]),

  combo("gallery-wide", { width: 760, align: "left" }, [
    { text: "Open\nstudio", font: "Syne", weight: 800, size: 112, color: INK, lineHeight: 1, spacing: -20, textCase: "upper" },
    { text: "12.04 — 18.05  /  Gallery Nord", font: "Space Mono", size: 26, color: "#dc2626", spacing: 40, gap: 28 },
  ]),

  combo("signature-script", { width: 720, align: "center" }, [
    { text: "Handmade\nwith love", font: "Satisfy", size: 170, color: INK, lineHeight: 1 },
    { text: "Small-batch candles  ·  est. 2021", font: "Josefin Sans", size: 24, color: "#b45309", spacing: 300, textCase: "upper", gap: 24 },
  ]),

  combo("news-headline", { width: 790, align: "left" }, [
    { text: "Breaking  ·  Local", font: "Roboto", weight: 700, size: 22, color: "#c81e1e", spacing: 250, textCase: "upper" },
    { text: "Local bakery wins\nnational award", font: "Merriweather", weight: 900, size: 84, color: INK, lineHeight: 1.12, spacing: -10, gap: 22 },
    { text: "By Staff Reporter  ·  3 min read", font: "Roboto", size: 26, color: SOFT, gap: 24 },
  ]),

  combo("beauty-spa", { width: 660, align: "center" }, [
    { text: "Glow\nSkin Studio", font: "Yeseva One", size: 108, color: INK, lineHeight: 1.02 },
    { text: "Facials  ·  Massage  ·  Wellness", font: "Raleway", weight: 600, size: 22, color: "#be185d", spacing: 330, textCase: "upper", gap: 26 },
  ]),

  combo("diner", { width: 700, align: "center" }, [
    { text: "Fresh & tasty", font: "Lobster", size: 130, color: "#c81e1e", lineHeight: 1 },
    { text: "Burgers  ·  Shakes  ·  Fries", font: "Bebas Neue", size: 46, color: INK, spacing: 200, textCase: "upper", gap: 30 },
  ]),
];
