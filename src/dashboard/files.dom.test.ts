import { describe, expect, it, vi } from "vitest";
import { imageFile, stubFilePicker } from "@/test/dashuiUtils";
import { pickFiles } from "./files";

const fileInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]"));

/** A file dialog that stays open until the test answers it. */
function openDialog() {
  let current: HTMLInputElement | null = null;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the stand-in records the input it was called on
    current = this;
  });
  return {
    choose(files: File[] | null) {
      Object.defineProperty(current, "files", { configurable: true, value: files });
      current?.dispatchEvent(new Event("change"));
    },
    cancel() {
      current?.dispatchEvent(new Event("cancel"));
    },
  };
}

describe("pickFiles", () => {
  it("resolves with the files the user chose", async () => {
    const picker = stubFilePicker([imageFile("a.png"), imageFile("b.jpg", "image/jpeg")]);
    const files = await pickFiles({ multiple: true });
    expect(files.map((file) => file.name)).toEqual(["a.png", "b.jpg"]);
    expect(picker.opened()).toBe(1);
  });

  it("resolves with nothing when the dialog is cancelled", async () => {
    stubFilePicker([]);
    await expect(pickFiles()).resolves.toEqual([]);
  });

  it("tells the dialog what to accept and whether to allow several files", async () => {
    const picker = stubFilePicker([imageFile()]);
    await pickFiles({ accept: "image/png,image/jpeg", multiple: true });
    expect(picker.lastAccept()).toBe("image/png,image/jpeg");
    expect(picker.lastMultiple()).toBe(true);
    await pickFiles();
    expect(picker.lastAccept()).toBe("");
    expect(picker.lastMultiple()).toBe(false);
  });

  it("keeps one hidden input in the overlay root and reuses it for every dialog", async () => {
    // the input lives as long as the page: load the module afresh so this test sees it being made
    vi.resetModules();
    const fresh = await import("./files");
    stubFilePicker([imageFile()]);
    expect(fileInputs()).toHaveLength(0);
    await fresh.pickFiles();
    const [input] = fileInputs();
    expect(input.closest("#cf-overlay-root")).toBeTruthy();
    expect(input.hidden).toBe(true);
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
    await fresh.pickFiles();
    expect(fileInputs()).toEqual([input]);
  });

  it("cancels the dialog that is still open when another one starts", async () => {
    const dialog = openDialog();
    const first = pickFiles();
    const second = pickFiles();
    await expect(first).resolves.toEqual([]);
    dialog.choose([imageFile("late.png")]);
    expect((await second).map((file) => file.name)).toEqual(["late.png"]);
  });

  it("answers a dialog only once", async () => {
    const dialog = openDialog();
    const pending = pickFiles();
    dialog.choose([imageFile("one.png")]);
    expect((await pending).map((file) => file.name)).toEqual(["one.png"]);
    dialog.choose([imageFile("two.png")]);
    dialog.cancel();
    const next = pickFiles();
    dialog.cancel();
    await expect(next).resolves.toEqual([]);
  });

  it("resolves with nothing when the change event carries no files", async () => {
    const dialog = openDialog();
    const pending = pickFiles();
    dialog.choose([]);
    await expect(pending).resolves.toEqual([]);
    const next = pickFiles();
    dialog.choose(null);
    await expect(next).resolves.toEqual([]);
  });
});
