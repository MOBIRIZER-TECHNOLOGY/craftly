import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroup, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { MAX_WEB_PAGE_BYTES, WEB_PAGE_SCRIPT, WEB_PAGE_SCRIPT_HASH, buildWebPage, escapeHtml, pageAltText, type WebPageInput } from "./webPage";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPG = "data:image/jpeg;base64,/9j/4AAQ";

const input = (patch: Partial<WebPageInput> = {}): WebPageInput => ({
  title: "Menu",
  width: 400,
  height: 300,
  slides: [{ src: PNG, alt: "A plate of pasta", name: "Starters" }, { src: JPG }, { src: PNG, name: "Desserts" }],
  ...patch,
});

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const csp = (doc: Document) => doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";

/** Puts the file into the test's own document and runs its script, as a browser would on opening it. */
function open(html: string) {
  const parsed = parse(html);
  document.documentElement.lang = parsed.documentElement.lang;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const script = document.querySelector("script")?.textContent ?? "";
  // what the script listens to on the document itself is taken off again after the test: the document outlives the file
  const listen = vi.spyOn(document, "addEventListener");
  new Function(script)();
  for (const [type, listener] of listen.mock.calls) onDocument.push([type, listener as EventListener]);
  listen.mockRestore();
  const slides = [...document.querySelectorAll<HTMLElement>(".slide")];
  return {
    slides,
    shown: () => slides.map((s) => s.classList.contains("is-on")),
    index: () => slides.findIndex((s) => s.classList.contains("is-on")),
    count: () => document.getElementById("count")?.textContent,
    button: (name: string) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name) as HTMLButtonElement,
    key: (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })),
  };
}

const onDocument: Array<[string, EventListener]> = [];

/** Replaces properties of the document for one test, and gives back a function that puts the old ones back. */
function replace(target: object, values: Record<string, PropertyDescriptor>) {
  const old = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const);
  for (const [key, descriptor] of Object.entries(values)) Object.defineProperty(target, key, { ...descriptor, configurable: true });
  return () => {
    for (const [key, descriptor] of old) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  };
}

afterEach(() => {
  for (const [type, listener] of onDocument.splice(0)) document.removeEventListener(type, listener);
  document.documentElement.className = "";
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("escapeHtml", () => {
  it("leaves nothing that could end a tag, an attribute or a comment", () => {
    expect(escapeHtml(`</title><script>alert(1)</script>`)).toBe("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`"double" 'single' & -->`)).toBe("&quot;double&quot; &#39;single&#39; &amp; --&gt;");
  });

  it("drops characters that are not text, and keeps line breaks", () => {
    expect(escapeHtml("a\u0000b\u0007c\u007fd\ne\tf")).toBe("abcd\ne\tf");
  });
});

describe("buildWebPage: the document", () => {
  it("is a whole HTML document with the title of the design and a language", () => {
    const html = buildWebPage(input({ lang: "pt-BR" }));
    expect(html.startsWith('<!doctype html>\n<html lang="pt-BR">')).toBe(true);
    const doc = parse(html);
    expect(doc.title).toBe("Menu");
    expect(doc.documentElement.lang).toBe("pt-BR");
    expect(doc.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
    expect(doc.querySelector('meta[name="viewport"]')).toBeTruthy();
  });

  it("falls back on English when the language is missing or is not a language tag", () => {
    expect(parse(buildWebPage(input())).documentElement.lang).toBe("en");
    expect(parse(buildWebPage(input({ lang: '"><script>' }))).documentElement.lang).toBe("en");
    expect(parse(buildWebPage(input({ lang: "" }))).documentElement.lang).toBe("en");
  });

  it("calls a design without a title an untitled design", () => {
    expect(parse(buildWebPage(input({ title: "  " }))).title).toBe("Untitled design");
  });

  it("holds every page as a picture with its proportions, in order", () => {
    const doc = parse(buildWebPage(input()));
    const images = [...doc.querySelectorAll<HTMLImageElement>(".slide img")];
    expect(images.map((i) => i.getAttribute("src"))).toEqual([PNG, JPG, PNG]);
    expect(images.every((i) => i.getAttribute("width") === "400" && i.getAttribute("height") === "300")).toBe(true);
  });

  it("describes every picture: with the alt text of the page where there is one, with its number and name otherwise", () => {
    const doc = parse(buildWebPage(input()));
    expect([...doc.querySelectorAll(".slide img")].map((i) => i.getAttribute("alt"))).toEqual(["A plate of pasta", "Page 2", "Page 3: Desserts"]);
    expect([...doc.querySelectorAll(".slide")].map((s) => s.getAttribute("aria-label"))).toEqual(["Page 1 of 3: Starters", "Page 2 of 3", "Page 3 of 3: Desserts"]);
  });

  it("has named buttons for the page before, the page after and the full screen, and a page counter", () => {
    const doc = parse(buildWebPage(input()));
    expect([...doc.querySelectorAll("button")].map((b) => [b.getAttribute("type"), b.getAttribute("aria-label")])).toEqual([
      ["button", "Previous page"],
      ["button", "Next page"],
      ["button", "Full screen"],
    ]);
    expect(doc.getElementById("count")?.getAttribute("aria-live")).toBe("polite");
    expect(doc.getElementById("count")?.textContent).toBe("Page 1 of 3");
  });

  it("shows where the keyboard is, and does not move for someone who asked for less motion", () => {
    const style = parse(buildWebPage(input())).querySelector("style")?.textContent ?? "";
    expect(style).toContain(":focus-visible");
    expect(style).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*transition: none/);
  });
});

describe("buildWebPage: what comes from the design cannot become markup", () => {
  const hostile = [
    "</title><script>window.hacked = 1</script>",
    `"><img src=x onerror="window.hacked = 1">`,
    "--><script>window.hacked = 1</script><!--",
    "'onload='window.hacked=1",
  ];

  it.each(hostile)("keeps a title of %j as text", (title) => {
    const html = buildWebPage(input({ title }));
    const doc = parse(html);
    expect(doc.title).toBe(title);
    expect(doc.querySelector("main")?.getAttribute("aria-label")).toBe(title);
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.querySelectorAll("img")).toHaveLength(3);
    expect(doc.querySelector("[onerror], [onload]")).toBeNull();
  });

  it.each(hostile)("keeps an alt text, a page name and a note of %j as text", (text) => {
    const html = buildWebPage(input({ slides: [{ src: PNG, alt: text, name: text, notes: text }], notes: true }));
    const doc = parse(html);
    expect(doc.querySelector("img")?.getAttribute("alt")).toBe(text);
    expect(doc.querySelector(".slide")?.getAttribute("aria-label")).toBe(`Page 1 of 1: ${text}`);
    expect(doc.querySelector(".notes p")?.textContent).toBe(text);
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.querySelectorAll("img")).toHaveLength(1);
    expect(doc.querySelector("[onerror], [onload]")).toBeNull();
  });

  it("takes a picture only as a PNG or JPEG data URL in base64", () => {
    for (const src of [
      "https://example.test/a.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
      'data:image/png;base64,AAAA" onerror="x',
      "data:image/png,raw",
      "javascript:alert(1)",
      "",
    ]) {
      expect(() => buildWebPage(input({ slides: [{ src }] }))).toThrowError(expect.objectContaining({ code: "invalid-design" }));
    }
  });

  it("asks for at least one page", () => {
    expect(() => buildWebPage(input({ slides: [] }))).toThrowError(expect.objectContaining({ code: "no-pages" }));
  });
});

describe("buildWebPage: the file is inert", () => {
  it("allows nothing but its own pictures, its own style and its own script", () => {
    const doc = parse(buildWebPage(input()));
    expect(csp(doc)).toBe(`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src '${WEB_PAGE_SCRIPT_HASH}'; base-uri 'none'; form-action 'none'`);
    // the policy stands before anything it has to govern
    const head = [...doc.head.children].map((el) => el.tagName.toLowerCase());
    expect(head.indexOf("meta")).toBe(0);
    expect(head.slice(0, 2)).toEqual(["meta", "meta"]);
    expect(doc.head.children[1].getAttribute("http-equiv")).toBe("Content-Security-Policy");
  });

  it("names the hash of exactly the script it carries", () => {
    const doc = parse(buildWebPage(input({ title: "Anything", notes: true })));
    const script = doc.querySelector("script");
    expect(script?.textContent).toBe(WEB_PAGE_SCRIPT);
    expect(script?.attributes).toHaveLength(0);
    expect(WEB_PAGE_SCRIPT_HASH).toBe(`sha256-${createHash("sha256").update(WEB_PAGE_SCRIPT, "utf8").digest("base64")}`);
    // a browser hashes the script as it stands in the file: plain characters and plain line ends only
    expect(/^[\n\x20-\x7e]+$/.test(WEB_PAGE_SCRIPT)).toBe(true);
    expect(WEB_PAGE_SCRIPT).not.toContain("</");
  });

  it("asks the network for nothing: no address, no link, no font, no frame, no form", () => {
    const html = buildWebPage(input({ notes: true, slides: [{ src: PNG, notes: "See https://example.test" }] }));
    const doc = parse(html);
    expect(doc.querySelector("link, iframe, object, embed, form, a, base, video, audio, source")).toBeNull();
    expect(doc.querySelectorAll("[href], [srcset], [action], [style]")).toHaveLength(0);
    expect([...doc.querySelectorAll("[src]")].every((el) => el.getAttribute("src")?.startsWith("data:image/"))).toBe(true);
    const style = doc.querySelector("style")?.textContent ?? "";
    expect(style).not.toMatch(/url\(|@import|@font-face/);
    // the only address in the file is the one that was typed into a note, as text
    expect(html.match(/https?:/g)).toEqual(["https:"]);
    expect(WEB_PAGE_SCRIPT).not.toMatch(/fetch|XMLHttpRequest|WebSocket|import\(|eval|innerHTML|location|cookie|Storage|sendBeacon/);
  });

  it("keeps presenter notes out unless they are asked for", () => {
    const slides = [{ src: PNG, notes: "Mention the secret price" }, { src: PNG }];
    expect(buildWebPage(input({ slides }))).not.toContain("secret");
    expect(buildWebPage(input({ slides, notes: false }))).not.toContain("secret");
    const doc = parse(buildWebPage(input({ slides, notes: true })));
    expect([...doc.querySelectorAll(".notes")].map((n) => n.textContent?.trim())).toEqual(["NotesMention the secret price"]);
    // a page without notes gets no empty box
    expect(doc.querySelectorAll(".slide")[1].querySelector(".notes")).toBeNull();
  });
});

describe("buildWebPage: the size", () => {
  it("refuses a file of more than 40 MB and says what would help", () => {
    const big = `data:image/jpeg;base64,${"A".repeat(MAX_WEB_PAGE_BYTES / 2)}`;
    expect(() => buildWebPage(input({ slides: [{ src: big }, { src: big }, { src: JPG }] }))).toThrowError(
      expect.objectContaining({ code: "too-large", message: "These pages make a web page of more than 40 MB. Choose fewer pages." }),
    );
  });

  it("counts long notes too", () => {
    const fits = `data:image/jpeg;base64,${"A".repeat(MAX_WEB_PAGE_BYTES - 20_000)}`;
    const slides = [{ src: fits, notes: "n".repeat(30_000) }];
    expect(buildWebPage(input({ slides })).length).toBeLessThanOrEqual(MAX_WEB_PAGE_BYTES);
    expect(() => buildWebPage(input({ slides, notes: true }))).toThrowError(expect.objectContaining({ code: "too-large" }));
  });

  it("gives a picture a size even when the design has none that makes sense", () => {
    const img = parse(buildWebPage(input({ width: Number.NaN, height: 0.2 }))).querySelector("img");
    expect([img?.getAttribute("width"), img?.getAttribute("height")]).toEqual(["1", "1"]);
  });

  it("makes a file of just under it", () => {
    const fits = `data:image/jpeg;base64,${"A".repeat(MAX_WEB_PAGE_BYTES / 2 - 20_000)}`;
    const html = buildWebPage(input({ slides: [{ src: fits }, { src: fits }] }));
    expect(html.length).toBeLessThanOrEqual(MAX_WEB_PAGE_BYTES);
  });
});

describe("the web page, opened", () => {
  it("shows the first page and hides the others from everyone", () => {
    const page = open(buildWebPage(input()));
    expect(document.documentElement.classList.contains("js")).toBe(true);
    expect(page.shown()).toEqual([true, false, false]);
    expect(page.slides.map((s) => s.getAttribute("aria-hidden"))).toEqual(["false", "true", "true"]);
    expect(page.count()).toBe("Page 1 of 3");
    expect(page.button("Previous page").getAttribute("aria-disabled")).toBe("true");
    expect(page.button("Next page").getAttribute("aria-disabled")).toBe("false");
  });

  it("goes on and back with the buttons, and stops at both ends", () => {
    const page = open(buildWebPage(input()));
    page.button("Next page").click();
    expect(page.shown()).toEqual([false, true, false]);
    expect(page.count()).toBe("Page 2 of 3");
    expect(page.button("Previous page").getAttribute("aria-disabled")).toBe("false");
    page.button("Next page").click();
    page.button("Next page").click();
    expect(page.index()).toBe(2);
    expect(page.button("Next page").getAttribute("aria-disabled")).toBe("true");
    page.button("Previous page").click();
    page.button("Previous page").click();
    page.button("Previous page").click();
    expect(page.index()).toBe(0);
  });

  it("goes on and back with the keyboard", () => {
    const page = open(buildWebPage(input()));
    page.key("ArrowRight");
    expect(page.index()).toBe(1);
    page.key("ArrowLeft");
    expect(page.index()).toBe(0);
    page.key("PageDown");
    page.key(" ");
    expect(page.index()).toBe(2);
    page.key("PageUp");
    expect(page.index()).toBe(1);
    page.key("Home");
    expect(page.index()).toBe(0);
    page.key("End");
    expect(page.index()).toBe(2);
    // up and down stay what they are in a browser: they scroll (the notes, a page that is zoomed in)
    page.key("ArrowUp");
    page.key("ArrowDown");
    expect(page.index()).toBe(2);
  });

  it("leaves the keys of the browser and of a focused button alone", () => {
    const page = open(buildWebPage(input()));
    page.key("ArrowRight", { altKey: true });
    page.key("ArrowRight", { ctrlKey: true });
    page.key("ArrowRight", { metaKey: true });
    page.key("x");
    expect(page.index()).toBe(0);
    // Space on a button presses the button: it must not turn the page as well
    page.key(" ", {}, page.button("Previous page"));
    page.key("Enter", {}, page.button("Previous page"));
    expect(page.index()).toBe(0);
  });

  it("goes on with a click on the picture of the page, not with one on its notes", () => {
    const page = open(buildWebPage(input({ notes: true, slides: [{ src: PNG, notes: "Say hello" }, { src: PNG }] })));
    page.slides[0].querySelector(".notes p")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(page.index()).toBe(0);
    page.slides[0].querySelector("img")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(page.index()).toBe(1);
  });

  it("goes on and back with a swipe, and not with a drag up or down or a small move", () => {
    const page = open(buildWebPage(input()));
    const stage = document.getElementById("stage") as HTMLElement;
    const touch = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "changedTouches", { value: [{ clientX: x, clientY: y }] });
      stage.dispatchEvent(event);
    };
    const swipe = (fromX: number, toX: number, toY = 100) => {
      touch("touchstart", fromX, 100);
      touch("touchend", toX, toY);
    };
    swipe(300, 100);
    expect(page.index()).toBe(1);
    swipe(100, 300);
    expect(page.index()).toBe(0);
    swipe(300, 280);
    swipe(300, 200, 400);
    expect(page.index()).toBe(0);
    // an end without a start (the finger came from outside) does nothing
    touch("touchend", 0, 100);
    expect(page.index()).toBe(0);
  });

  it("fills the screen and leaves it again, with the button and with F", () => {
    let full: Element | null = null;
    const request = vi.fn(() => {
      full = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      full = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const restoreRoot = replace(document.documentElement, { requestFullscreen: { value: request } });
    const restoreDocument = replace(document, { exitFullscreen: { value: exit }, fullscreenElement: { get: () => full } });
    const page = open(buildWebPage(input()));
    const button = document.getElementById("full") as HTMLButtonElement;
    button.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Leave full screen");
    page.key("f");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Full screen");
    // a browser that refuses (an embedded view) does not break the page
    request.mockImplementationOnce(() => Promise.reject(new Error("not allowed")));
    button.click();
    expect(page.index()).toBe(0);
    expect(button.hidden).toBe(false);
    restoreRoot();
    restoreDocument();
  });

  it("takes the full screen button away where the browser has no full screen", () => {
    const restore = replace(document.documentElement, { requestFullscreen: { value: undefined } });
    const page = open(buildWebPage(input()));
    expect((document.getElementById("full") as HTMLButtonElement).hidden).toBe(true);
    // and F does nothing there
    page.key("f");
    expect(page.index()).toBe(0);
    restore();
  });

  it("works with one page", () => {
    const page = open(buildWebPage(input({ slides: [{ src: PNG }] })));
    expect(page.count()).toBe("Page 1 of 1");
    page.key("ArrowRight");
    page.button("Next page").click();
    expect(page.index()).toBe(0);
    expect(page.button("Next page").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("pageAltText", () => {
  it("is the alt texts of what is on the page, back to front, also inside groups", () => {
    const page = createPage({
      background: solid("#ffffff"),
      elements: [
        createImage({ src: "a.png", alt: "A plate of pasta" }),
        createShape("rect", {}),
        createGroup([createImage({ src: "b.png", alt: " A glass of wine " }), createText({ text: "Hello" })], {}),
        createText({ text: "Sale", alt: "Half price this week" }),
      ],
    });
    expect(pageAltText(page)).toBe("A plate of pasta; A glass of wine; Half price this week");
  });

  it("leaves out what is hidden, and is empty when nothing is described", () => {
    const hidden = createImage({ src: "a.png", alt: "Not shown" });
    hidden.hidden = true;
    expect(pageAltText(createPage({ background: solid("#ffffff"), elements: [hidden, createShape("rect", {})] }))).toBe("");
  });
});
