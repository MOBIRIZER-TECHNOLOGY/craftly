import { afterEach, describe, expect, it, vi } from "vitest";
import { ariaShortcut, formatShortcut, isMacPlatform, shortcutKeys } from "./shortcut";

function pretendToBe(platform: string, userAgent?: string): void {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  if (userAgent !== undefined) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as { userAgentData?: unknown }).userAgentData;
});

describe("isMacPlatform", () => {
  it("recognises macOS and iOS platforms", () => {
    pretendToBe("MacIntel");
    expect(isMacPlatform()).toBe(true);
    pretendToBe("iPhone");
    expect(isMacPlatform()).toBe(true);
  });

  it("is false on Windows and Linux", () => {
    pretendToBe("Win32", "Mozilla/5.0 (Windows NT 10.0)");
    expect(isMacPlatform()).toBe(false);
    pretendToBe("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
    expect(isMacPlatform()).toBe(false);
  });

  it("prefers userAgentData.platform when the browser provides it", () => {
    pretendToBe("Win32", "Mozilla/5.0 (Windows NT 10.0)");
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "macOS" } });
    expect(isMacPlatform()).toBe(true);
  });

  it("falls back to the user agent when the platform string is empty", () => {
    pretendToBe("", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)");
    expect(isMacPlatform()).toBe(true);
    pretendToBe("", "Mozilla/5.0 (Windows NT 10.0)");
    expect(isMacPlatform()).toBe(false);
  });

  it("is false when there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isMacPlatform()).toBe(false);
  });
});

describe("shortcutKeys", () => {
  it("splits a shortcut into one label per key cap", () => {
    pretendToBe("Win32");
    expect(shortcutKeys("Ctrl+Shift+Z")).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("shows the primary modifier as Ctrl on PC whatever it is called", () => {
    pretendToBe("Win32");
    for (const name of ["Ctrl", "Cmd", "Command", "Mod", "Control"]) expect(shortcutKeys(`${name}+C`)).toEqual(["Ctrl", "C"]);
  });

  it("shows the primary modifier as the Command key on a Mac, with Mac glyphs for the rest", () => {
    pretendToBe("MacIntel");
    expect(shortcutKeys("Ctrl+Shift+Z")).toEqual(["⌘", "⇧", "Z"]);
    expect(shortcutKeys("Alt+Delete")).toEqual(["⌥", "⌦"]);
    expect(shortcutKeys("Enter")).toEqual(["↵"]);
  });

  it("uses arrows for the arrow keys in every spelling", () => {
    pretendToBe("Win32");
    expect(shortcutKeys("Shift+Arrow Up")).toEqual(["Shift", "↑"]);
    expect(shortcutKeys("ArrowDown")).toEqual(["↓"]);
    expect(shortcutKeys("left")).toEqual(["←"]);
    expect(shortcutKeys("Right")).toEqual(["→"]);
  });

  it("reads a trailing plus as the plus key", () => {
    pretendToBe("Win32");
    expect(shortcutKeys("Ctrl++")).toEqual(["Ctrl", "+"]);
  });

  it("upper-cases single letters and leaves other key names alone", () => {
    pretendToBe("Win32");
    expect(shortcutKeys("ctrl+a")).toEqual(["Ctrl", "A"]);
    expect(shortcutKeys("Ctrl+Home")).toEqual(["Ctrl", "Home"]);
    expect(shortcutKeys("F5")).toEqual(["F5"]);
    expect(shortcutKeys("Ctrl+]")).toEqual(["Ctrl", "]"]);
  });

  it("returns nothing for an empty shortcut and ignores stray spaces", () => {
    expect(shortcutKeys("")).toEqual([]);
    expect(shortcutKeys("   ")).toEqual([]);
    pretendToBe("Win32");
    expect(shortcutKeys(" Ctrl + Z ")).toEqual(["Ctrl", "Z"]);
  });

  it("maps Delete, Backspace, Escape and Tab on PC", () => {
    pretendToBe("Win32");
    expect(shortcutKeys("Delete")).toEqual(["Del"]);
    expect(shortcutKeys("Backspace")).toEqual(["Backspace"]);
    expect(shortcutKeys("Escape")).toEqual(["Esc"]);
    expect(shortcutKeys("Tab")).toEqual(["Tab"]);
    expect(shortcutKeys("Meta+K")).toEqual(["Win", "K"]);
  });
});

describe("formatShortcut", () => {
  it("joins the keys with plus signs on PC", () => {
    pretendToBe("Win32");
    expect(formatShortcut("Ctrl+Shift+Z")).toBe("Ctrl+Shift+Z");
  });

  it("runs the glyphs together on a Mac", () => {
    pretendToBe("MacIntel");
    expect(formatShortcut("Ctrl+Shift+Z")).toBe("⌘⇧Z");
  });
});

describe("ariaShortcut", () => {
  it("lists both the Control and the Meta spelling of the primary modifier", () => {
    expect(ariaShortcut("Ctrl+Z")).toBe("Control+Z Meta+Z");
    expect(ariaShortcut("Mod+Shift+Z")).toBe("Control+Shift+Z Meta+Shift+Z");
  });

  it("uses the DOM key names", () => {
    expect(ariaShortcut("Esc")).toBe("Escape");
    expect(ariaShortcut("Del")).toBe("Delete");
    expect(ariaShortcut("Shift+Arrow Up")).toBe("Shift+ArrowUp");
    expect(ariaShortcut("Arrow Down")).toBe("ArrowDown");
    expect(ariaShortcut("Alt+left")).toBe("Alt+ArrowLeft");
    expect(ariaShortcut("right")).toBe("ArrowRight");
  });

  it("capitalises single letters and longer names", () => {
    expect(ariaShortcut("alt+k")).toBe("Alt+K");
    expect(ariaShortcut("shift+enter")).toBe("Shift+Enter");
    expect(ariaShortcut("Ctrl+]")).toBe("Control+] Meta+]");
  });

  it("has no alternatives when there is no primary modifier", () => {
    expect(ariaShortcut("Delete")).toBe("Delete");
  });
});
