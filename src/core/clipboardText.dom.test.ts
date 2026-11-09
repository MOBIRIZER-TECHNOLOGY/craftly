/** Putting text on the clipboard, with the old way as a second chance for a browser that will not do it the new way. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboardText";

const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });
const setExec = (value: unknown) => Object.defineProperty(document, "execCommand", { value, configurable: true });

afterEach(() => {
  setClipboard(undefined);
  setExec(undefined);
  document.body.innerHTML = "";
});

describe("copyText", () => {
  it("writes to the clipboard when the browser lets it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    expect(await copyText("the report")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("the report");
  });

  it("tries the old way when the new one is refused, and says so when that works", async () => {
    setClipboard({ writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) });
    let copied = "";
    setExec(
      vi.fn((command: string) => {
        copied = document.querySelector("textarea")?.value ?? "";
        return command === "copy";
      }),
    );
    expect(await copyText("the report")).toBe(true);
    expect(copied).toBe("the report");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("tries the old way when there is no clipboard object", async () => {
    setClipboard(undefined);
    setExec(vi.fn(() => true));
    expect(await copyText("text")).toBe(true);
  });

  it("says no when neither way works", async () => {
    setClipboard({ writeText: () => Promise.reject(new Error("no")) });
    setExec(vi.fn(() => false));
    expect(await copyText("text")).toBe(false);
    setExec(
      vi.fn(() => {
        throw new Error("not supported");
      }),
    );
    expect(await copyText("text")).toBe(false);
    setExec(undefined);
    expect(await copyText("text")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
