import { createChart, createDesign, createGraphic, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import { GRAPHICS_A } from "@/data/graphicsA";

/** A design with every element type; used by the sandbox and by teammates' dev harnesses. */
export function sampleDesign() {
  const page = createPage({
    background: {
      type: "linear",
      angle: 160,
      stops: [
        { offset: 0, color: "#fff7ed" },
        { offset: 1, color: "#fde2e4" },
      ],
    },
  });
  page.elements.push(
    createImage({
      src: "builtin:sunset-hills",
      naturalWidth: 1600,
      naturalHeight: 1067,
      x: 1120,
      y: 90,
      width: 640,
      height: 780,
      mask: "rect",
      radius: 40,
      shadow: { color: "rgba(14,19,24,.3)", blur: 40, x: 0, y: 20 },
    }),
    createShape("ellipse", {
      x: 80,
      y: 700,
      width: 260,
      height: 260,
      fill: {
        type: "linear",
        angle: 135,
        stops: [
          { offset: 0, color: "#7c3aed" },
          { offset: 1, color: "#14b8a6" },
        ],
      },
    }),
    createText({
      id: "title",
      text: "Design anything,\nbeautifully.",
      x: 120,
      y: 150,
      width: 960,
      autoWidth: false,
      fontSize: 118,
      fontWeight: 800,
      fontFamily: "Playfair Display",
      color: "#1b1233",
      lineHeight: 1.05,
      letterSpacing: -10,
    }),
    createText({
      text: "A standalone studio for presentations, posters and social posts.",
      x: 124,
      y: 440,
      width: 760,
      autoWidth: false,
      fontSize: 36,
      color: "#4a4160",
      lineHeight: 1.4,
    }),
    createShape("rect", { x: 124, y: 580, width: 320, height: 92, radius: 46, fill: solid("#7c3aed") }),
    createText({ text: "Start creating", x: 164, y: 604, fontSize: 34, fontWeight: 700, color: "#ffffff", effect: { kind: "none" } }),
    createLine({ x: 520, y: 626, width: 260, stroke: { color: "#7c3aed", width: 8, style: "dashed", cap: "round" }, endArrow: "arrow" }),
    createText({ text: "CURVED TEXT", x: 520, y: 700, fontSize: 56, fontWeight: 800, color: "#e11d48", curve: 60, letterSpacing: 120, fontFamily: "Montserrat" }),
    createShape("star", { x: 930, y: 640, width: 150, height: 150, fill: solid("#f59e0b"), stroke: { color: "#b45309", width: 6, style: "solid" }, rotation: 12 }),
    createText({
      text: "Neon",
      x: 1180,
      y: 920,
      fontSize: 90,
      fontWeight: 800,
      color: "#ffffff",
      effect: { kind: "neon", color: "#ec4899", intensity: 70 },
      fontFamily: "Bebas Neue",
    }),
    createChart({ x: 1230, y: 560, width: 460, height: 300, chart: "column" }),
  );
  const g = GRAPHICS_A[0];
  if (g) page.elements.push(createGraphic({ svg: g.svg, x: 760, y: 720, width: 180, height: 180 }));
  const page2 = createPage({ background: solid("#0e1318") });
  page2.elements.push(createText({ text: "Page two", x: 120, y: 120, fontSize: 96, color: "#fff", fontWeight: 800 }), createTable({ x: 120, y: 360, width: 900, height: 330 }));
  return createDesign({ title: "Sandbox", typeId: "presentation", width: 1920, height: 1080, pages: [page, page2] });
}
