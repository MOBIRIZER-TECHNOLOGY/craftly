import { useMemo } from "react";
import { createPage, createShape, createText, createImage, createLine, createGraphic, solid } from "@/core/factory";
import type { DesignElement, Page, PatternKind, TextEffectKind } from "@/core/types";
import { PageThumb } from "@/components/PageThumb";
import { FILTER_PRESETS } from "@/data/filters";
import { GRAPHICS } from "@/data/graphics";
import { SHAPES } from "@/render/shapePaths";

/** Developer gallery: every shape, text effect, filter and pattern through the real renderer. */
const W = 1600;

function shapesSheet(): Page {
  const els: DesignElement[] = [];
  SHAPES.forEach((s, i) => {
    const col = i % 8;
    const row = Math.floor(i / 8);
    const x = 40 + col * 190;
    const y = 40 + row * 190;
    els.push(
      createShape(s.id, {
        x,
        y,
        width: 150,
        height: Math.round(150 / (s.aspect ?? 1)) > 170 ? 170 : Math.round(150 / (s.aspect ?? 1)),
        radius: s.hasRadius ? 30 : 0,
        fill:
          i % 3 === 0
            ? {
                type: "linear",
                angle: 135,
                stops: [
                  { offset: 0, color: "#7c3aed" },
                  { offset: 1, color: "#14b8a6" },
                ],
              }
            : solid(["#ef4444", "#f59e0b", "#0ea5e9", "#10b981"][i % 4]),
        stroke: i % 5 === 0 ? { color: "#0e1318", width: 6, style: "dashed" } : null,
        params: s.params ? ({ ...s.params } as Record<string, number>) : undefined,
      }),
    );
  });
  return createPage({ background: solid("#f6f7f9"), elements: els });
}

function effectsSheet(): Page {
  const kinds: TextEffectKind[] = ["none", "shadow", "lift", "hollow", "splice", "outline", "echo", "glitch", "neon", "background"];
  const els: DesignElement[] = [];
  kinds.forEach((kind, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const dark = kind === "neon" || kind === "glitch";
    els.push(
      createShape("rect", { x: 20 + col * 310, y: 20 + row * 220, width: 290, height: 200, radius: 18, fill: solid(dark ? "#0e1318" : "#ffffff") }),
      createText({
        text: "Ag Text",
        x: 40 + col * 310,
        y: 70 + row * 220,
        fontSize: 72,
        fontWeight: 800,
        fontFamily: "Poppins",
        color: kind === "neon" ? "#ffffff" : kind === "hollow" || kind === "splice" ? "#7c3aed" : dark ? "#ffffff" : "#1b1233",
        effect: { kind, color: kind === "outline" ? "#7c3aed" : undefined },
      }),
      createText({ text: kind, x: 40 + col * 310, y: 180 + row * 220, fontSize: 20, color: dark ? "#9aa1ad" : "#666d7a" }),
    );
  });
  return createPage({ background: solid("#eef0f4"), elements: els });
}

function textSheet(): Page {
  const els: DesignElement[] = [
    createText({
      text: "Left aligned paragraph that wraps across several lines to test the layout engine properly.",
      x: 40,
      y: 40,
      width: 440,
      autoWidth: false,
      fontSize: 28,
      align: "left",
      lineHeight: 1.4,
    }),
    createText({
      text: "Centre aligned paragraph that wraps across several lines to test the layout engine properly.",
      x: 540,
      y: 40,
      width: 440,
      autoWidth: false,
      fontSize: 28,
      align: "center",
      lineHeight: 1.4,
    }),
    createText({
      text: "Justified paragraph that wraps across several lines to test the layout engine properly, again.",
      x: 1040,
      y: 40,
      width: 520,
      autoWidth: false,
      fontSize: 28,
      align: "justify",
      lineHeight: 1.4,
    }),
    createText({
      text: "Bullet one\nBullet two is longer and wraps onto another line for sure\nBullet three",
      x: 40,
      y: 320,
      width: 440,
      autoWidth: false,
      fontSize: 28,
      list: "bullet",
      lineHeight: 1.35,
    }),
    createText({
      text: "First step\nSecond step is a bit longer and wraps around\nThird step",
      x: 540,
      y: 320,
      width: 440,
      autoWidth: false,
      fontSize: 28,
      list: "number",
      lineHeight: 1.35,
    }),
    createText({
      paragraphs: [
        {
          runs: [
            { text: "Mixed " },
            { text: "bold", bold: true },
            { text: " and " },
            { text: "italic", italic: true },
            { text: " and " },
            { text: "colour", color: "#e11d48" },
            { text: " and " },
            { text: "BIG", size: 54, color: "#7c3aed", bold: true },
            { text: " with " },
            { text: "underline", underline: true },
            { text: " and " },
            { text: "strike", strike: true },
          ],
        },
      ],
      x: 1040,
      y: 320,
      width: 520,
      autoWidth: false,
      fontSize: 30,
      lineHeight: 1.4,
    }),
    createText({
      text: "Gradient headline",
      x: 40,
      y: 560,
      fontSize: 96,
      fontWeight: 800,
      fontFamily: "Montserrat",
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#7c3aed" },
          { offset: 1, color: "#f43f5e" },
        ],
      },
    }),
    createText({ text: "tracked caps", x: 40, y: 700, fontSize: 40, fontWeight: 700, letterSpacing: 300, textCase: "upper", align: "center", autoWidth: false, width: 520 }),
    createText({ text: "Arch up", x: 600, y: 660, fontSize: 56, fontWeight: 800, curve: 70, color: "#0ea5e9" }),
    createText({ text: "Bow down", x: 1000, y: 640, fontSize: 56, fontWeight: 800, curve: -70, color: "#10b981" }),
    createText({ text: "Rotated", x: 1350, y: 700, fontSize: 56, fontWeight: 800, rotation: -12, color: "#f59e0b", fontFamily: "Bebas Neue" }),
  ];
  return createPage({ background: solid("#ffffff"), elements: els });
}

function filtersSheet(): Page {
  const els: DesignElement[] = [];
  FILTER_PRESETS.slice(0, 15).forEach((f, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    els.push(
      createImage({
        src: "builtin:sunset-hills",
        naturalWidth: 1600,
        naturalHeight: 1067,
        x: 20 + col * 310,
        y: 20 + row * 210,
        width: 290,
        height: 190,
        radius: 14,
        filter: { preset: f.id, intensity: 100, brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, blur: 0, hue: 0, duotone: null },
      }),
      createText({ text: f.name, x: 30 + col * 310, y: 30 + row * 210, fontSize: 22, color: "#ffffff", fontWeight: 700, effect: { kind: "shadow", offset: 30, blur: 40 } }),
    );
  });
  return createPage({ background: solid("#111111"), elements: els });
}

function patternsSheet(): Page {
  const kinds: PatternKind[] = ["dots", "grid", "lines", "diagonal", "checker", "waves", "zigzag", "plus", "bubbles", "noise"];
  const els: DesignElement[] = kinds.map((k, i) =>
    createShape("rect", {
      x: 20 + (i % 5) * 310,
      y: 20 + Math.floor(i / 5) * 230,
      width: 290,
      height: 210,
      radius: 16,
      fill: { type: "pattern", pattern: k, color: i % 2 ? "#7c3aed" : "#0e1318", background: i % 2 ? "#f1ebff" : "#fde68a", scale: 1 },
    }),
  );
  const g = GRAPHICS.slice(0, 5);
  g.forEach((def, i) => els.push(createGraphic({ svg: def.svg, x: 20 + i * 310, y: 500, width: 290, height: 200, colors: i === 2 ? { "#7c3aed": "#e11d48" } : {} })));
  els.push(createLine({ x: 40, y: 760, width: 400, stroke: { color: "#0e1318", width: 8, style: "dotted", cap: "round" }, endArrow: "open-arrow", startArrow: "circle" }));
  return createPage({ background: solid("#ffffff"), elements: els });
}

export function Gallery() {
  const design = { width: W, height: 800 };
  const sheets = useMemo(
    () =>
      [
        ["Shapes", shapesSheet()],
        ["Text effects", effectsSheet()],
        ["Text layout", textSheet()],
        ["Image filters", filtersSheet()],
        ["Patterns, graphics, lines", patternsSheet()],
      ] as const,
    [],
  );
  return (
    <div style={{ padding: 16, background: "#d9dce3", minHeight: "100%", overflow: "auto", height: "100%" }}>
      {sheets.map(([name, page]) => (
        <section key={name} style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 6px", font: "700 14px var(--font-ui)" }}>{name}</h3>
          <PageThumb design={design} page={page} width={1280} sharp={false} />
        </section>
      ))}
    </div>
  );
}
