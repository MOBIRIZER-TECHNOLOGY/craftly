import { describe, expect, it } from "vitest";
import { createShape, createText, paragraphsToText, solid } from "@/core/factory";
import { buildPptxParts } from "./pptx";
import { importPptx } from "./pptxImport";
import { createZip } from "./zip";

async function fileOf(parts: ReturnType<typeof buildPptxParts>): Promise<File> {
  return new File([await createZip(parts)], "Imported deck.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

describe("basic PPTX import", () => {
  it("reads slide size, editable text, rectangles and pictures", async () => {
    const text = createText({ x: 100, y: 50, width: 400, height: 100, rotation: 15, text: "Editable", fontSize: 32 });
    const rectangle = createShape("rect", { x: 600, y: 100, width: 200, height: 150, fill: solid("#112233") });
    const parts = buildPptxParts({
      title: "Deck",
      width: 1280,
      height: 720,
      slides: [
        { image: new Uint8Array([0xff, 0xd8, 1]), type: "image/jpeg", name: "First", alt: "Background", objects: [text, rectangle] },
        { image: new Uint8Array([0xff, 0xd8, 2]), type: "image/jpeg" },
      ],
    });
    const design = await importPptx(await fileOf(parts));
    expect([design.width, design.height]).toEqual([1280, 720]);
    expect(design.pages).toHaveLength(2);
    expect(design.pages[0].name).toBe("First");
    const importedText = design.pages[0].elements.find((el) => el.type === "text");
    expect(importedText?.type).toBe("text");
    if (importedText?.type === "text") {
      expect(paragraphsToText(importedText.paragraphs)).toBe("Editable");
      expect(importedText.rotation).toBe(15);
      expect(importedText.fontSize).toBe(32);
    }
    const importedRect = design.pages[0].elements.find((el) => el.type === "shape");
    expect(importedRect).toMatchObject({ type: "shape", shape: "rect", fill: { type: "solid", color: "#112233" } });
    expect(design.pages[0].elements.some((el) => el.type === "image" && el.src?.startsWith("asset:"))).toBe(true);
  });

  it("refuses a ZIP that is not a presentation", async () => {
    const file = new File([await createZip([{ name: "hello.txt", data: new TextEncoder().encode("hello") }])], "notes.pptx");
    await expect(importPptx(file)).rejects.toThrow(/not a PowerPoint/);
  });
});
