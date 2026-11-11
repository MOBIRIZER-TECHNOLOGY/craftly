import { describe, expect, it } from "vitest";
import { createGroup, createImage, createShape, createText } from "./factory";
import { backgroundWithoutRemoteImage, isRemoteImage, withoutRemoteImages } from "./imageSources";
import type { ImageElement, ShapeElement } from "./types";

describe("which addresses of pictures are somewhere else", () => {
  it.each(["https://example.test/p.png", "http://example.test/p.png", "//example.test/p.png", "HTTPS://EXAMPLE.TEST/P.PNG", "  https://example.test/p.png"])(
    "%s is on the web",
    (src) => {
      expect(isRemoteImage(src)).toBe(true);
    },
  );

  // a browser reads all of these as an address on the web: a list of the spellings to refuse would always miss one
  it.each([
    ["backslashes for slashes", "https:\\\\example.test\\p.png"],
    ["two backslashes and no scheme", "\\\\example.test/p.png"],
    ["a slash and a backslash", "/\\example.test/p.png"],
    ["a tab inside the scheme", "ht\ttps://example.test/p.png"],
    ["a line break inside the scheme", "htt\nps://example.test/p.png"],
    ["a scheme with no slashes", "https:example.test/p.png"],
    ["a control character in front", "\u0001https://example.test/p.png"],
  ])("so is one written with %s", (_how, src) => {
    expect(isRemoteImage(src)).toBe(true);
  });

  // and nothing else that is not one of the four kinds the editor makes is loaded either
  it.each([
    "/icon.png",
    "icon.png",
    "ftp://example.test/p.png",
    "file:///c:/p.png",
    "javascript:alert(1)",
    "https",
    " data:image/png;base64,AAAA",
    "DATA:image/png;base64,AAAA",
    " ",
  ])("%s is no address the editor makes, and counts as somewhere else", (src) => {
    expect(isRemoteImage(src)).toBe(true);
  });

  it.each(["asset:a_1", "builtin:sunset-hills", "data:image/png;base64,AAAA", "data:image/svg+xml;charset=utf-8,%3Csvg%3E", "blob:http://localhost/1b2c", ""])(
    "%s is not",
    (src) => {
      expect(isRemoteImage(src)).toBe(false);
    },
  );

  it("is not for anything that is no text", () => {
    for (const value of [null, undefined, 5, {}, ["https://example.test"]]) expect(isRemoteImage(value)).toBe(false);
  });
});

describe("an element without pictures from the web", () => {
  const web = "https://example.test/p.png";

  it("makes an empty frame of a photo, and forgets an original that was on the web", () => {
    const count = { remote: 0 };
    const photo = withoutRemoteImages(createImage({ src: web, originalSrc: web, width: 10, height: 10 }), count);
    expect(photo.src).toBeNull();
    expect("originalSrc" in photo).toBe(false);
    expect(count.remote).toBe(1);

    const cut = withoutRemoteImages(createImage({ src: "asset:a", originalSrc: web, width: 10, height: 10 }));
    expect(cut.src).toBe("asset:a");
    expect("originalSrc" in cut).toBe(false);
  });

  it("makes the fill of a shape plain", () => {
    const count = { remote: 0 };
    const shape = withoutRemoteImages(createShape("rect", { fill: { type: "image", src: web, fit: "cover" } }), count) as ShapeElement;
    expect(shape.fill).toEqual({ type: "solid", color: "#e5e7eb" });
    expect(count.remote).toBe(1);
  });

  it("goes through the elements of a group, at any depth, and keeps the ones it did not change", () => {
    const untouched = createText({ text: "words" });
    const group = createGroup([untouched, createGroup([createImage({ id: "deep", src: web, width: 10, height: 10 })])]);
    const count = { remote: 0 };
    const out = withoutRemoteImages(group, count);
    expect(out).not.toBe(group);
    expect(out.children[0]).toBe(untouched);
    expect(JSON.stringify(out)).not.toContain("example.test");
    expect(count.remote).toBe(1);
  });

  it("gives back the element itself when it has no picture from the web", () => {
    const count = { remote: 0 };
    for (const el of [
      createImage({ src: "asset:a", originalSrc: "builtin:b", width: 10, height: 10 }),
      createImage({ src: null, width: 10, height: 10 }),
      createShape("rect", { fill: { type: "image", src: "asset:f", fit: "tile" } }),
      createShape("ellipse"),
      createGroup([createShape("rect"), createImage({ src: "data:image/png;base64,AAAA", width: 10, height: 10 })]),
    ])
      expect(withoutRemoteImages(el as ImageElement, count)).toBe(el);
    expect(count.remote).toBe(0);
  });
});

describe("the background of a page without a picture from the web", () => {
  it("is white in its place, and is itself otherwise", () => {
    const count = { remote: 0 };
    expect(backgroundWithoutRemoteImage({ type: "image", src: "https://example.test/bg.png", fit: "cover", dim: 0 }, count)).toEqual({ type: "solid", color: "#ffffff" });
    expect(count.remote).toBe(1);
    const own = { type: "image", src: "asset:bg", fit: "cover", dim: 0 } as const;
    expect(backgroundWithoutRemoteImage(own)).toBe(own);
    const plain = { type: "solid", color: "#123456" } as const;
    expect(backgroundWithoutRemoteImage(plain)).toBe(plain);
  });
});
