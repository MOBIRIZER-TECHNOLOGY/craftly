/**
 * What Craftly keeps about a problem, and what a report may say. A report is the one thing that can leave the device (and only
 * when the person presses Send), so most of these tests are about what it leaves out.
 */
import { describe, expect, it } from "vitest";
import { buildReport, cleanMessage, cleanStack, describeBrowser, isNoise, kindOfLoadFailure, reportText, routeOf, type Problem } from "./problems";

const problem = (extra: Partial<Problem> = {}): Problem => ({
  id: "p1",
  at: Date.UTC(2026, 10, 9, 7, 30, 0),
  kind: "script",
  message: "Cannot read properties of undefined (reading 'x')",
  stack: "at pick (Editor-CmJy4Uwp.js:1:2345)",
  route: "design",
  count: 1,
  ...extra,
});

describe("cleanMessage", () => {
  it("puts a message on one line", () => {
    expect(cleanMessage("  something\n   went\twrong  ")).toBe("something went wrong");
  });

  it("takes out addresses and e-mail addresses, which can name a person or a place", () => {
    expect(cleanMessage("Failed to load https://example.com/u/priya/logo.png?token=abc and mailto priya@example.com")).toBe("Failed to load [address] and mailto [e-mail]");
    expect(cleanMessage("blob:http://localhost:5173/6f1c-22 is gone")).toBe("[address] is gone");
  });

  it("is at most 300 characters", () => {
    const cut = cleanMessage("x".repeat(1000));
    expect(cut).toHaveLength(300);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("copes with what is not a string", () => {
    expect(cleanMessage(undefined)).toBe("");
    expect(cleanMessage(42 as unknown as string)).toBe("42");
  });
});

describe("cleanStack", () => {
  it("keeps the function, the file and the place, and drops the address and folders that name the host", () => {
    const raw = [
      "Error: boom",
      "    at pick (https://craftly.example.org/assets/Editor-CmJy4Uwp.js:1:2345)",
      "    at https://craftly.example.org/assets/index-D3a_WJOC.js:7:8",
    ].join("\n");
    expect(cleanStack(raw)).toBe("at pick (Editor-CmJy4Uwp.js:1:2345)\nat index-D3a_WJOC.js:7:8");
  });

  it("drops the query of a development address and keeps the place", () => {
    expect(cleanStack("    at store (http://localhost:5173/src/core/store.ts?t=1731111111111:45:6)")).toBe("at store (store.ts:45:6)");
  });

  it("reads the form that Firefox and Safari write", () => {
    expect(cleanStack("pick@https://craftly.example.org/assets/Editor-A1.js:10:20\n@https://craftly.example.org/assets/index-B2.js:3:4")).toBe(
      "pick@Editor-A1.js:10:20\n@index-B2.js:3:4",
    );
  });

  it("leaves out the lines that are not frames (the message), and keeps at most twelve", () => {
    const lines = Array.from({ length: 30 }, (_v, i) => `    at f${i} (https://h.test/a.js:${i}:1)`);
    const cut = cleanStack(["TypeError: bad", ...lines].join("\n"));
    expect(cut.split("\n")).toHaveLength(12);
    expect(cut.split("\n")[0]).toBe("at f0 (a.js:0:1)");
  });

  it("is empty for no stack, and short for a long one", () => {
    expect(cleanStack(undefined)).toBe("");
    expect(cleanStack("    at f (https://h.test/" + "a".repeat(5000) + ".js:1:1)").length).toBeLessThanOrEqual(1500);
  });
});

describe("isNoise", () => {
  it("ignores the errors of browser extensions, which are not Craftly's", () => {
    expect(isNoise("anything", "chrome-extension://abc/content.js")).toBe(true);
    expect(isNoise("anything", "moz-extension://abc/content.js")).toBe(true);
    expect(isNoise("anything", "safari-web-extension://abc/content.js")).toBe(true);
  });

  it("ignores what the browser says when a script from another site fails, and the resize loop notice", () => {
    expect(isNoise("Script error.")).toBe(true);
    expect(isNoise("Script error")).toBe(true);
    expect(isNoise("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isNoise("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
  });

  it("ignores something that was cancelled on purpose", () => {
    expect(isNoise("The user aborted a request.", undefined, "AbortError")).toBe(true);
  });

  it("does not ignore a real error from Craftly's own files", () => {
    expect(isNoise("Cannot read properties of undefined", "https://craftly.example.org/assets/Editor-A1.js")).toBe(false);
    expect(isNoise("Cannot read properties of undefined")).toBe(false);
  });
});

describe("kindOfLoadFailure", () => {
  it("knows the messages that browsers give when a part of the app cannot be fetched", () => {
    expect(kindOfLoadFailure("Failed to fetch dynamically imported module: https://x/a.js")).toBe(true);
    expect(kindOfLoadFailure("error loading dynamically imported module")).toBe(true);
    expect(kindOfLoadFailure("Importing a module script failed.")).toBe(true);
    expect(kindOfLoadFailure("Loading chunk 42 failed.")).toBe(true);
    expect(kindOfLoadFailure("Cannot read properties of undefined")).toBe(false);
  });
});

describe("routeOf", () => {
  it("names the screen and never the design", () => {
    expect(routeOf("#/design/d_3d36m4jdce")).toBe("design");
    expect(routeOf("#/projects")).toBe("projects");
    expect(routeOf("#/templates")).toBe("templates");
    expect(routeOf("#/")).toBe("home");
    expect(routeOf("")).toBe("home");
    expect(routeOf("#/something-else/42")).toBe("other");
  });
});

describe("describeBrowser", () => {
  it("says the browser and its version, and the system, and no more", () => {
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")).toBe("Chrome 152 on Windows");
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0")).toBe(
      "Edge 152 on Windows",
    );
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0")).toBe("Firefox 141 on Windows");
    expect(describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")).toBe("Safari 26 on macOS");
    expect(describeBrowser("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36")).toBe("Chrome 152 on Android");
    expect(describeBrowser("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")).toBe("Chrome 152 on Linux");
  });

  it("does not guess when it does not know", () => {
    expect(describeBrowser("curl/8.0")).toBe("an unknown browser");
    expect(describeBrowser("")).toBe("an unknown browser");
  });
});

describe("buildReport", () => {
  const env = {
    build: "9f3a1c2b7d",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    width: 1440,
    height: 900,
    online: true,
  };

  it("holds the error, where it happened, and the version, browser and window", () => {
    expect(buildReport(problem({ count: 3 }), env)).toEqual({
      format: 1,
      app: "craftly",
      build: "9f3a1c2b7d",
      at: "2026-11-09T07:30:00.000Z",
      kind: "script",
      message: "Cannot read properties of undefined (reading 'x')",
      stack: "at pick (Editor-CmJy4Uwp.js:1:2345)",
      count: 3,
      route: "design",
      browser: "Chrome 152 on Windows",
      window: "1440x900",
      online: true,
    });
  });

  it("has exactly these fields, so that nothing about a design, a person or a file can be added by accident", () => {
    expect(Object.keys(buildReport(problem(), env)).sort()).toEqual(["app", "at", "browser", "build", "count", "format", "kind", "message", "online", "route", "stack", "window"]);
  });

  it("never carries the id, the sent mark or anything else of the stored record", () => {
    const text = reportText(problem({ id: "secret-id-123", sent: true }), env);
    expect(text).not.toContain("secret-id-123");
    expect(text).not.toContain("sent");
  });

  it("is written as indented JSON, which is what the person sees and what is sent", () => {
    const text = reportText(problem(), env);
    expect(JSON.parse(text)).toEqual(buildReport(problem(), env));
    expect(text).toContain('\n  "app": "craftly"');
  });
});
