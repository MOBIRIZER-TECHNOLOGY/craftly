import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextElement } from "@/core/types";
import { lg, uniqueIds } from "./backgrounds";
import { folio } from "./templates/presentations-corporate";

afterEach(() => {
  vi.doUnmock("./photos");
  vi.resetModules();
});

describe("gradients of the background presets", () => {
  it("spreads the stops evenly from the first colour to the last", () => {
    expect(lg(135, "#000000", "#888888", "#ffffff")).toEqual({
      type: "linear",
      angle: 135,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#888888" },
        { offset: 1, color: "#ffffff" },
      ],
    });
  });

  it("puts a single colour at the start", () => {
    expect(lg(0, "#123456").stops).toEqual([{ offset: 0, color: "#123456" }]);
  });
});

describe("preset ids", () => {
  it("builds an id from a prefix and the lower case, dashed name", () => {
    expect(uniqueIds("bg-solid", ["Warm Sand", "Ink & Oil"])).toEqual(["bg-solid-warm-sand", "bg-solid-ink-oil"]);
  });

  it("numbers a name that comes up again, starting from 2", () => {
    expect(uniqueIds("p", ["Sky", "Sky", "Sea", "sky", "SKY!"])).toEqual(["p-sky", "p-sky-2", "p-sea", "p-sky-3", "p-sky-4"]);
  });

  it("gives nothing for no names", () => {
    expect(uniqueIds("p", [])).toEqual([]);
  });
});

describe("photo backgrounds", () => {
  it("name themselves after the photo, or after its id when the photo is not known", async () => {
    const real = await import("./backgrounds");
    const photoGroup = real.BACKGROUND_GROUPS.find((g) => g.id === "photo")!;
    expect(photoGroup.presets.length).toBeGreaterThan(0);
    expect(photoGroup.presets[0].name).not.toBe(photoGroup.presets[0].id.replace("bg-photo-", ""));

    vi.resetModules();
    vi.doMock("./photos", async (importOriginal) => ({ ...(await importOriginal<typeof import("./photos")>()), getPhotoDef: () => undefined }));
    const without = await import("./backgrounds");
    const nameless = without.BACKGROUND_GROUPS.find((g) => g.id === "photo")!;
    for (const preset of nameless.presets) expect(preset.name).toBe(preset.id.replace("bg-photo-", ""));
  });
});

describe("the footer of the annual report deck", () => {
  const texts = (els: ReturnType<typeof folio>) => els as unknown as TextElement[];

  it("puts the report name and the page number at the bottom, in dark ink on a light page", () => {
    const [name, number] = texts(folio(3));
    expect(name.paragraphs[0].runs[0].text).toContain("Annual Report 2025");
    expect(number.paragraphs[0].runs[0].text).toBe("03");
    expect(number.align).toBe("right");
    expect(number.color).toBe("#0b2a55");
    expect(name.color).toBe("#465470");
  });

  it("turns light on a dark page", () => {
    const [name, number] = texts(folio(5, true));
    expect(name.color).toBe("#bcd6ff");
    expect(number.color).toBe("#ffffff");
  });
});
