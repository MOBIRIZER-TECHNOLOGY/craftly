/**
 * Markup that comes from outside is only drawn when it is plain drawing: a short list of shapes, gradients and masks with their
 * ordinary attributes, written as strictly as XML is. Everything else is refused, whatever it might be meant for: scripts, event
 * handlers, links, styles, references to other files, and the tricks of the markup itself that make two parsers read it differently.
 * Each refusal below is a thing that only one rule refuses, so that taking a rule away fails a test that names it.
 */
import { describe, expect, it } from "vitest";
import { svgProblem } from "./svgSafety";

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

describe("what is accepted", () => {
  it.each([
    ["a path", '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" fill="#000"/></svg>'],
    [
      "a drawing the way a person writes it",
      `\n  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n    <circle cx="12" cy="12" r="10"/>\n    <polyline points="12 6 12 12 16 14"></polyline>\n  </svg>\n`,
    ],
    [
      "gradients, a mask and a clip path, and the references to them",
      wrap(
        '<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><radialGradient id="r"><stop offset="0"/></radialGradient><clipPath id="c"><rect width="5" height="5"/></clipPath><mask id="m"><circle r="4" fill="#fff"/></mask></defs><g clip-path="url(#c)" mask="url(#m)"><ellipse rx="2" ry="1" fill="url(#g)"/><polygon points="0,0 1,1 0,2" stroke="url( #r )"/></g>',
      ),
    ],
    [
      "a gradient that takes its stops from another",
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><linearGradient id="a" xlink:href="#b"/><linearGradient id="b" href="#a"/></svg>',
    ],
    ["single quotes", "<svg viewBox='0 0 1 1'><rect width='1' height='1' fill='red'/></svg>"],
    ["characters written as the five that XML names", wrap('<g id="a&amp;b" aria-label="the &quot;one&quot;" data-x="&lt;&gt;&apos;"/>')],
    ["a title with text in it", wrap('<title>Logo &amp; mark &lt;1&gt;</title><rect width="1" height="1"/>')],
    ["a drawing inside a drawing", wrap('<svg x="1" y="1" width="5" height="5"><rect width="5" height="5"/></svg>')],
    ["an empty drawing", "<svg/>"],
    ["a filter", wrap('<filter id="f"><feGaussianBlur stdDeviation="2"/><feOffset dx="1" dy="1"/></filter><rect width="5" height="5" filter="url(#f)"/>')],
    [
      "a pattern and a marker",
      wrap('<pattern id="p" width="2" height="2"><rect width="1" height="1"/></pattern><marker id="k"><path d="M0 0"/></marker><symbol id="s"><g/></symbol>'),
    ],
    ["a drawing that is nested fifty deep", `<svg>${"<g>".repeat(50)}${"</g>".repeat(50)}</svg>`],
    ["a drawing nested as deep as is allowed", `<svg>${"<g>".repeat(99)}${"</g>".repeat(99)}</svg>`],
    ["as many attributes as are allowed", `<svg ${Array.from({ length: 100 }, (_, i) => `a${i}="1"`).join(" ")}/>`],
    ["a reference in single quotes", wrap(`<rect fill="url('#g')"/>`)],
    ["a reference in double quotes inside single ones", wrap(`<rect fill='url("#g")'/>`)],
    ["a reference with its quotes written as characters", wrap('<rect fill="url(&quot;#g&quot;)"/>')],
  ])("accepts %s", (_what, markup) => {
    expect(svgProblem(markup)).toBeNull();
  });

  it("looks at a megabyte of markup in a moment", () => {
    const big = `<svg>${'<path d="M0 0L1 1" fill="#000"/>'.repeat(30_000)}</svg>`;
    expect(big.length).toBeGreaterThan(900_000);
    const started = Date.now();
    expect(svgProblem(big)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("what is refused", () => {
  it.each<[string, string, RegExp]>([
    // elements that are not drawing
    ["a script", wrap("<script>alert(1)</script>"), /<script>/],
    ["a script that closes itself", wrap('<script href="#x"/>'), /<script>/],
    ["a page inside the drawing", wrap("<foreignObject><div/></foreignObject>"), /<foreignObject>/],
    ["a link", wrap('<a href="https://evil.test/"><rect/></a>'), /<a>/],
    ["a use of something", wrap('<use href="#a"/>'), /<use>/],
    ["a picture", wrap('<image href="#a"/>'), /<image>/],
    ["a style sheet", wrap("<style>.a{fill:red}</style>"), /<style>/],
    ["an animation that sets an attribute", wrap('<set attributeName="onmouseover" to="alert(1)"/>'), /<set>/],
    ["an animation", wrap('<animate attributeName="href" values="javascript:alert(1)"/>'), /<animate>/],
    ["an element that does not exist", wrap("<blink/>"), /<blink>/],
    ["an element in capitals, which only a browser reads as the one it means", wrap("<SCRIPT>alert(1)</SCRIPT>"), /<SCRIPT>/],
    ["an element in mixed case", wrap("<Script>alert(1)</Script>"), /<Script>/],
    ["markup that is not a drawing", "<div/>", /<div>/],
    // event handlers, however they are written
    ["an event handler", wrap('<g onclick="x()"/>'), /onclick/],
    ["an event handler in capitals", wrap('<g ONCLICK="x()"/>'), /ONCLICK/],
    ["an event handler on the drawing itself", '<svg onload="x()"/>', /onload/],
    ["an event handler after a tab", wrap('<g\tonclick="x()"/>'), /onclick/],
    ["an event handler after a line break", wrap('<g\nonmouseover="x()"/>'), /onmouseover/],
    ["an event handler with spaces around the equals sign", wrap('<g onclick = "x()"/>'), /onclick/],
    ["an event handler after a slash, which a browser reads as a space", '<svg/onload="x()"/>', /well formed/],
    ["an event handler with no quotes", wrap("<g onclick=x()/>"), /quote/],
    // addresses
    ["a link that is code", wrap('<linearGradient xlink:href="javascript:alert(1)"/>'), /xlink:href/],
    ["a link out of the drawing", wrap('<linearGradient href="https://evil.test/x#g"/>'), /href may only point/],
    ["a link to data", wrap('<pattern xlink:href="data:image/png;base64,AAAA"/>'), /xlink:href may only point/],
    ["a link to nothing", wrap('<linearGradient href=""/>'), /href may only point/],
    ["a link to a fragment with nothing in it", wrap('<linearGradient href="#"/>'), /href may only point/],
    ["a link written with a character reference", wrap('<linearGradient href="&#106;avascript:alert(1)"/>'), /character reference/],
    ["a link written with a reference that is not one of XML's five", wrap('<linearGradient href="&colon;x"/>'), /character reference/],
    ["a character reference that does not end", wrap('<g id="a&amp"/>'), /character reference/],
    ["a character reference in text", wrap("<title>&#60;script&#62;</title>"), /character reference/],
    ["the end of a CDATA section in text", wrap("<title>a]]>b</title>"), /]]>/],
    ["a backslash, which can spell a function of a style", wrap('<rect fill="u\\72l(https://evil.test/p)"/>'), /backslash/],
    ["a paint that leaves the drawing", wrap('<rect fill="url(https://evil.test/p.svg#a)"/>'), /fill may only refer/],
    ["a paint that leaves the drawing, in quotes", wrap("<rect fill=\"url('https://evil.test/p')\"/>"), /fill may only refer/],
    ["a paint that is data", wrap('<rect fill="url(data:image/svg+xml;base64,AAAA)"/>'), /fill may only refer/],
    ["a paint that leaves the drawing, in capitals", wrap('<rect fill="URL(https://evil.test/p)"/>'), /fill may only refer/],
    ["a reference with nothing in it", wrap('<rect filter="url()"/>'), /filter may only refer/],
    ["a second reference that leaves the drawing", wrap('<rect fill="url(#a) url(https://evil.test/p)"/>'), /fill may only refer/],
    ["a style attribute", wrap('<rect style="fill:red"/>'), /style/],
    ["a changed base address", '<svg xml:base="https://evil.test/"/>', /xml:base/],
    ["a namespace that is not the drawing's", '<svg xmlns:x="http://evil.test/ns"/>', /namespace/],
    ["the wrong namespace for the drawing", '<svg xmlns="http://evil.test/"/>', /namespace/],
    ["a namespace with a prefix of its own for the drawing's", '<svg xmlns:svg="http://www.w3.org/2000/svg"/>', /namespace/],
    // things that are not elements and not text
    ["a DOCTYPE with an entity", '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', /comment, declaration/],
    ["a processing instruction", '<?xml-stylesheet href="x.css"?><svg/>', /comment, declaration/],
    ["an XML declaration", '<?xml version="1.0"?><svg/>', /comment, declaration/],
    ["a comment", wrap("<!-- hello -->"), /comment, declaration/],
    ["a CDATA section", wrap("<![CDATA[x]]>"), /comment, declaration/],
    // how it is written
    ["a tag that is never closed", "<svg><g></svg>", /closing/],
    ["a closing tag with nothing open", "<svg></g></svg>", /closing/],
    ["a closing tag of another element", "<svg><g></rect></svg>", /closing/],
    ["a drawing that never ends", "<svg><g/>", /never closed/],
    ["two drawings side by side", "<svg/><svg/>", /outside/],
    ["text before the drawing", "hello<svg/>", /outside/],
    ["text after the drawing", "<svg/>hello", /outside/],
    ["an attribute with no quotes", wrap("<rect width=10/>"), /quote/],
    ["two attributes with nothing between them", wrap('<rect width="1"height="1"/>'), /well formed/],
    ["an attribute twice", wrap('<rect width="1" width="2"/>'), /twice/],
    ["a bracket in a value", wrap('<rect x="<b>"/>'), /value/],
    ["an attribute with no value", wrap("<rect hidden/>"), /well formed/],
    ["a name that is not a name", wrap('<rect 1x="1"/>'), /well formed/],
    ["a tag that stops", "<svg><rect", /well formed/],
    ["a value that stops", '<svg><rect width="1', /well formed/],
    ["a slash that closes nothing", "<svg><rect / ></svg>", /well formed/],
    ["tags with nothing in them", "<>", /well formed/],
    ["something that is not markup", "hello", /outside/],
    ["nothing", "", /no drawing/],
    ["a control character in text", "<svg>\u0000</svg>", /character/],
    ["a control character in a value", '<svg id="a\u0001b"/>', /character/],
    ["a reference that is never closed", wrap('<rect fill="url(#a"/>'), /fill may only refer/],
    ["two drawings, the first closed with a tag", "<svg></svg><svg></svg>", /outside/],
    ["a drawing nested one level too deep", `<svg>${"<g>".repeat(100)}${"</g>".repeat(100)}</svg>`, /deep/],
    ["one attribute too many", `<svg ${Array.from({ length: 101 }, (_, i) => `a${i}="1"`).join(" ")}/>`, /attributes/],
    ["a drawing nested too deep", `<svg>${"<g>".repeat(300)}${"</g>".repeat(300)}</svg>`, /deep/],
    ["a drawing that starts with something else", "<g/>", /starts with <svg>/],
    ["a closing tag with something in it", "<svg></svg x>", /well formed/],
    ["a name that goes on for ever, which is not repeated in full", `<svg><${"a".repeat(5000)}/></svg>`, /<a{1,40}…?>/],
    ["far too many attributes", `<svg ${Array.from({ length: 300 }, (_, i) => `a${i}="1"`).join(" ")}/>`, /attributes/],
  ])("refuses %s", (_what, markup, reason) => {
    const problem = svgProblem(markup);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(reason);
  });

  it("names the thing that is wrong and not the markup, which can be long", () => {
    const problem = svgProblem(`<svg>${"<g/>".repeat(5000)}<script>${"x".repeat(5000)}</script></svg>`) as string;
    expect(problem.length).toBeLessThan(120);
  });
});
