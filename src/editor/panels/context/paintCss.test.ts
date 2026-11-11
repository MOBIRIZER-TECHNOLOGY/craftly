import { describe, expect, it } from "vitest";
import { cssUrl } from "./paintCss";

describe("an address as a CSS url()", () => {
  it("is the address in quotes", () => {
    expect(cssUrl("blob:http://localhost/1b2c")).toBe('url("blob:http://localhost/1b2c")');
    expect(cssUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E(1)'")).toBe(`url("data:image/svg+xml;charset=utf-8,%3Csvg%3E(1)'")`);
  });

  it("cannot end its own quotes: an address that tries to add a second picture stays one address", () => {
    const sneaky = 'data:image/png,"), url("https://example.test/b.png';
    expect(cssUrl(sneaky)).toBe('url("data:image/png,\\22 ), url(\\22 https://example.test/b.png")');
    // every quote, backslash and line break is written as an escape
    const body = cssUrl('a"b\\c\nd\re\ff').slice(5, -2);
    expect(body).toBe("a\\22 b\\5c c\\a d\\d e\\c f");
    expect(/["\n\r\f]/.test(body)).toBe(false);
  });
});
