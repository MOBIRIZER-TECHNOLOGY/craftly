import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImage } from "@/core/factory";
import { getAsset } from "@/core/assets";
import type { ImageElement } from "@/core/types";
import { toast } from "@/ui";
import { live, openElements } from "@/test/ctxUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { pickImageFor, replaceImageWithFile } from "./imageFile";

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

const photo = () => createImage({ src: "https://example.test/old.jpg", x: 10, y: 10, width: 320, height: 240, naturalWidth: 640, naturalHeight: 480 });
const png = (name = "new.png") => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

describe("replaceImageWithFile", () => {
  it("stores the file as an upload and swaps it into the image, keeping the box", async () => {
    const el = photo();
    openElements([el], { selected: [el] });
    const ok = await replaceImageWithFile(el.id, png());
    expect(ok).toBe(true);
    const now = live<ImageElement>(el);
    expect(now.src).toMatch(/^asset:/);
    expect(now).toMatchObject({ x: 10, y: 10, width: 320, height: 240, naturalWidth: 64, naturalHeight: 48 });
    const asset = await getAsset(now.src!.slice("asset:".length));
    expect(asset).toMatchObject({ name: "new", kind: "image", mime: "image/png" });
  });

  it("refuses a file that is not a picture and says so", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const el = photo();
    openElements([el], { selected: [el] });
    const ok = await replaceImageWithFile(el.id, new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(ok).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("not a picture"));
    expect(live<ImageElement>(el).src).toBe("https://example.test/old.jpg");
  });

  it("recognises a picture by its extension when the browser gives no type", async () => {
    const el = photo();
    openElements([el], { selected: [el] });
    expect(await replaceImageWithFile(el.id, new File([new Uint8Array([1])], "scan.JPG", { type: "" }))).toBe(true);
    expect(live<ImageElement>(el).src).toMatch(/^asset:/);
  });

  it("reports a picture that cannot be read", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("broken picture"));
    const el = photo();
    openElements([el], { selected: [el] });
    const ok = await replaceImageWithFile(el.id, png("broken.png"));
    expect(ok).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Could not read"));
    expect(live<ImageElement>(el).src).toBe("https://example.test/old.jpg");
  });
});

describe("pickImageFor", () => {
  const chooser = () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    return { click, input: () => click.mock.contexts.at(-1) as HTMLInputElement };
  };
  const choose = (input: HTMLInputElement, files: File[]) => {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
  };

  it("opens a file chooser for pictures", () => {
    const { click, input } = chooser();
    pickImageFor("any");
    expect(click).toHaveBeenCalledTimes(1);
    expect(input().type).toBe("file");
    expect(input().accept).toBe("image/*");
  });

  it("replaces the picture with the file that was chosen", async () => {
    const el = photo();
    openElements([el], { selected: [el] });
    const { input } = chooser();
    pickImageFor(el.id);
    choose(input(), [png("chosen.png")]);
    await waitFor(() => expect(live<ImageElement>(el).src).toMatch(/^asset:/));
  });

  it("does nothing when the chooser is closed without a file, or cancelled", async () => {
    const el = photo();
    openElements([el], { selected: [el] });
    const { input } = chooser();
    pickImageFor(el.id);
    choose(input(), []);
    pickImageFor(el.id);
    input().dispatchEvent(new Event("cancel"));
    await new Promise((r) => setTimeout(r, 20));
    expect(live<ImageElement>(el).src).toBe("https://example.test/old.jpg");
  });
});
