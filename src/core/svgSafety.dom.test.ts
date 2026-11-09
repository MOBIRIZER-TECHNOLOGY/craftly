/**
 * The check reads the markup with a few lines of its own, so the one thing that could go wrong is that a real parser reads it
 * differently: markup that the check lets through, and that a browser takes to be something else. Here real parsers (the XML parser
 * and the HTML parser of the test browser) read thousands of mutations of drawings, most of them damaged on purpose, and whatever the
 * check accepts must come out of both as nothing but plain drawing.
 */
import { describe, expect, it } from "vitest";
import { random } from "@/test/random";
import { svgProblem } from "./svgSafety";

const SEEDS = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><g clip-path="url(#c)"><rect width="10" height="10" fill="url(#g)"/><path d="M0 0L10 10" stroke="#000" stroke-width="2"/><circle cx="5" cy="5" r="2" opacity="0.5"/></g><title>Mark &amp; sign</title></svg>',
  "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor'><polyline points='12 6 12 12 16 14'></polyline><ellipse rx='3' ry='2'/><line x1='0' y1='0' x2='5' y2='5'/></svg>",
];

/** What a mutation may put in: pieces of the things that make a browser read markup as something else. */
const PIECES = [
  "<script>alert(1)</script>",
  "<script/>",
  " onload=alert(1)",
  "/onload=alert(1)",
  ' onclick="alert(1)"',
  "\tonmouseover='x'",
  "<a href='javascript:alert(1)'>",
  "</a>",
  '<use href="https://evil.test/x.svg#a"/>',
  '<image href="https://evil.test/x.png"/>',
  "<foreignObject><div onclick=x></div></foreignObject>",
  "<style>@import url(https://evil.test/x.css)</style>",
  ' style="fill:url(https://evil.test/p)"',
  ' href="javascript:alert(1)"',
  ' xlink:href="data:text/html,x"',
  ' href="&#106;avascript:alert(1)"',
  "<!--",
  "-->",
  "<![CDATA[",
  "]]>",
  "<!DOCTYPE svg [<!ENTITY x 'y'>]>",
  "<?xml-stylesheet href='x'?>",
  "&lt;script&gt;",
  "&#60;script&#62;",
  "<set attributeName='onclick' to='x'/>",
  "<animate attributeName='href' to='javascript:x'/>",
  "<svg/onload=alert(1)>",
  "<math><mi xlink:href='javascript:x'>",
  "<iframe src=x>",
  "<img src=x onerror=alert(1)>",
  '"',
  "'",
  "<",
  ">",
  "/",
  "=",
  " ",
  "\n",
  "\u0000",
  "&",
  ";",
];

/** Elements that a drawing is made of, by the names an XML parser gives them. */
const DRAWING = new Set(
  (
    "svg g defs symbol path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask pattern marker title desc filter " +
    "feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood " +
    "feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence"
  ).split(" "),
);

function mutate(source: string, r: ReturnType<typeof random>): string {
  let text = source;
  for (let n = 1 + r.int(3); n > 0; n--) {
    const at = r.int(text.length + 1);
    switch (r.int(4)) {
      case 0:
        text = text.slice(0, at) + r.pick(PIECES) + text.slice(at);
        break;
      case 1:
        text = text.slice(0, at) + text.slice(at + 1 + r.int(8));
        break;
      case 2:
        text = text.slice(0, at) + text[r.int(text.length)] + text.slice(at);
        break;
      default: {
        const to = Math.min(text.length, at + r.int(30));
        text = text.slice(0, at) + r.pick(PIECES) + text.slice(to);
      }
    }
  }
  return text;
}

/** Everything a browser could run, load or follow, found in a tree that a parser made of the markup; the empty list when there is none. */
function danger(root: Element): string[] {
  const found: string[] = [];
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    const name = el.localName;
    if (!DRAWING.has(name)) found.push(`element ${name}`);
    if (el.namespaceURI !== null && el.namespaceURI !== "http://www.w3.org/2000/svg" && el.namespaceURI !== "http://www.w3.org/1999/xhtml")
      found.push(`namespace ${el.namespaceURI}`);
    for (const attr of Array.from(el.attributes)) {
      const a = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (a.startsWith("on")) found.push(`attribute ${attr.name}`);
      if (a === "style") found.push("attribute style");
      // the places where a value is an address: a link, and the paint or filter that is called with url(...)
      if ((a === "href" || a === "xlink:href") && !/^#[^\s]+$/.test(value)) found.push(`${a}=${value}`);
      if (/url\(\s*[^#\s)]/i.test(value)) found.push(`${a}=${value}`);
    }
  }
  return found;
}

describe("whatever is accepted is plain drawing for the parsers of a browser too", () => {
  it("holds for thousands of damaged drawings", () => {
    let accepted = 0;
    let refused = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const r = random(seed);
      const markup = mutate(r.pick(SEEDS), r);
      if (svgProblem(markup) !== null) {
        refused++;
        continue;
      }
      accepted++;
      // read as XML: the way an image is read, and an exported file when somebody opens it
      const xml = new DOMParser().parseFromString(markup, "image/svg+xml");
      expect(xml.querySelector("parsererror"), `seed ${seed} was accepted but is not well formed XML: ${markup}`).toBeNull();
      expect(danger(xml.documentElement), `seed ${seed} was accepted and holds ${markup}`).toEqual([]);
      // read as HTML: the way markup is read when it is put into a page (a parsed document is inert: nothing in it runs)
      const html = new DOMParser().parseFromString(markup, "text/html");
      expect(html.body.querySelector("script, iframe, object, embed, img, a, style, foreignObject, math"), `seed ${seed} became markup in a page: ${markup}`).toBeNull();
      expect(
        danger(html.body).filter((d) => d !== "element body"),
        `seed ${seed} read as HTML holds ${markup}`,
      ).toEqual([]);
    }
    // the test is only worth something when it sees both kinds
    expect(accepted).toBeGreaterThan(400);
    expect(refused).toBeGreaterThan(400);
  });

  it("holds for the drawings it was made for", () => {
    for (const source of SEEDS) {
      expect(svgProblem(source)).toBeNull();
      const xml = new DOMParser().parseFromString(source, "image/svg+xml");
      expect(xml.querySelector("parsererror")).toBeNull();
      expect(danger(xml.documentElement)).toEqual([]);
    }
  });
});
