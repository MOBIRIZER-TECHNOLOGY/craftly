/**
 * What may arrive over the network is checked before it is applied: the shape of every operation, its sizes, and who may send it.
 * (The content of an element is checked by the server on top of this; applying an operation is safe whatever it holds.)
 */
import { describe, expect, it } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createImage, createLine, createPage, createShape, createText } from "@/core/factory";
import type { Design, DesignElement } from "@/core/types";
import { TEMPLATES } from "@/data/templates";
import { completeDesign, minimalDesign } from "@/test/schema/complete";
import { oneOfEach, whole } from "@/test/wholeElement";
import { canEdit, checkDesign, checkOps, checkSets, MAX_OPS_PER_BATCH, parseServerMsg } from "./protocol";
import { applyOps, type Op } from "./ops";

const el = () => createShape("rect", { id: "a" });

describe("checkOps", () => {
  const good: Op[] = [
    { k: "design", set: { title: "T" }, unset: ["guides"] },
    { k: "page.add", page: { id: "p", background: { type: "solid", color: "#fff" }, elements: [el()] }, index: 0 },
    { k: "page.del", id: "p" },
    { k: "page.move", id: "p", index: 1 },
    { k: "page.set", id: "p", set: { name: "N" }, unset: ["notes"] },
    { k: "el.add", page: "p", parent: null, index: 0, el: el() },
    { k: "el.add", page: "p", parent: "g", index: 3, el: el() },
    { k: "el.del", page: "p", id: "a" },
    { k: "el.move", page: "p", id: "a", parent: null, index: 2 },
    { k: "el.set", page: "p", id: "a", set: { x: 1, fill: { type: "solid", color: "#000" } } },
  ];

  it("accepts every kind of operation in its proper form, and gives back what it was given", () => {
    const checked = checkOps(JSON.parse(JSON.stringify(good)));
    expect(typeof checked).not.toBe("string");
    expect(checked).toEqual(good);
  });

  it("accepts a batch with nothing in it", () => {
    expect(checkOps([])).toEqual([]);
  });

  it.each([
    ["not a list", { k: "design" }],
    ["null", null],
    ["a string", "ops"],
    ["a list of things that are not operations", [1, "a", null]],
    ["an operation of a kind that does not exist", [{ k: "page.explode", id: "p" }]],
    ["an operation with no kind", [{ id: "p" }]],
    ["a deletion with no id", [{ k: "el.del", page: "p" }]],
    ["a deletion with an id that is not text", [{ k: "el.del", page: "p", id: 5 }]],
    ["an empty id", [{ k: "page.del", id: "" }]],
    ["an id that is far too long", [{ k: "page.del", id: "x".repeat(500) }]],
    ["an index that is not a number", [{ k: "page.move", id: "p", index: "1" }]],
    ["an index that is not finite", [{ k: "page.move", id: "p", index: Infinity }]],
    ["a parent that is neither null nor an id", [{ k: "el.add", page: "p", parent: 3, index: 0, el: el() }]],
    ["an element with no kind of its own", [{ k: "el.add", page: "p", parent: null, index: 0, el: { id: "a", x: 0 } }]],
    ["an element of a kind that does not exist", [{ k: "el.add", page: "p", parent: null, index: 0, el: { id: "a", type: "script" } }]],
    ["an element with no id", [{ k: "el.add", page: "p", parent: null, index: 0, el: whole({ id: undefined }) }]],
    ["a page with an element that is not an element", [{ k: "page.add", page: { id: "p", elements: [{ id: "a", type: "weird" }] }, index: 0 }]],
    ["a page whose elements are not a list", [{ k: "page.add", page: { id: "p", elements: {} }, index: 0 }]],
    ["properties that are a list", [{ k: "el.set", page: "p", id: "a", set: [1] }]],
    ["properties that are null", [{ k: "el.set", page: "p", id: "a", set: null }]],
    ["names to remove that are not text", [{ k: "el.set", page: "p", id: "a", unset: [1] }]],
    ["names to remove that are not a list", [{ k: "el.set", page: "p", id: "a", unset: "x" }]],
    ["far too many properties", [{ k: "el.set", page: "p", id: "a", set: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i])) }]],
  ])("refuses %s", (_what, ops) => {
    expect(typeof checkOps(ops)).toBe("string");
  });

  it("refuses a batch that is longer than a person could make in one step", () => {
    const many = Array.from({ length: MAX_OPS_PER_BATCH + 1 }, () => ({ k: "page.del", id: "p" }));
    expect(checkOps(many)).toMatch(/too many/i);
    expect(typeof checkOps(many.slice(1))).not.toBe("string");
  });

  it("refuses elements nested so deep that they can only be an attack", () => {
    let deep: unknown = whole({ id: "leaf" });
    for (let i = 0; i < 100; i++) deep = { ...whole({ id: `g${i}`, type: "group" }), children: [deep] };
    expect(checkOps([{ k: "el.add", page: "p", parent: null, index: 0, el: deep }])).toMatch(/deep/i);
  });
});

describe("the content of what arrives", () => {
  const set = (props: Record<string, unknown>): unknown[] => [{ k: "el.set", page: "p", id: "a", set: props }];
  // (an element as the editor makes it, with what is given laid over it: so that what is refused is refused for what the test names)
  const add = (el: Record<string, unknown>): unknown[] => [{ k: "el.add", page: "p", parent: null, index: 0, el: whole({ id: "n", ...el }) }];
  const parsed = (json: string) => JSON.parse(json) as Record<string, unknown>;
  const nested = (levels: number) => {
    let v: unknown = 1;
    for (let i = 0; i < levels; i++) v = { v };
    return v;
  };

  it.each([
    ["an image from the editor", set({ src: "asset:a_1234" })],
    ["a stock picture of the editor", set({ src: "builtin:sunset", originalSrc: "asset:a_9" })],
    ["a picture in the operation", set({ src: "data:image/png;base64,iVBORw0KGgo=" })],
    ["a drawing in the operation", set({ src: "data:image/svg+xml;utf8,<svg/>" })],
    ["no picture", set({ src: "" })],
    ["a link to a page of the web", set({ link: "https://example.test/a?b=c#d" })],
    ["a link to mail", set({ link: "mailto:a@example.test" })],
    ["a graphic with ordinary markup", set({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" fill="#000"/></svg>' })],
    [
      "a graphic with gradients and masks",
      set({ svg: '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient><mask id="m"/></defs><rect fill="url(#g)" mask="url(#m)"/></svg>' }),
    ],
    ["a graphic with no markup yet", set({ svg: "" })],
    ["the colours that a graphic is recoloured with", set({ colors: { "#ff0000": "#111111", currentColor: "rgba(1,2,3,0.5)" } })],
    ["no recolouring", set({ colors: {} })],
    [
      "a fill, a shadow and a list of paragraphs",
      set({ fill: { type: "solid", color: "#fff" }, shadow: { color: "#000", blur: 2, x: 1, y: 1 }, paragraphs: [{ runs: [{ text: "Hi" }] }] }),
    ],
    ["a property that is not there (JSON leaves it out)", set({ blur: undefined })],
    ["an element with children", add({ type: "group", children: [{ id: "c", type: "shape", x: 1 }] })],
    ["a blend mode", set({ blend: "multiply" })],
    ["an element that is added with a blend mode", add({ blend: "soft-light" })],
    ["a blend mode that is taken away", [{ k: "el.set", page: "p", id: "a", set: {}, unset: ["blend"] }]],
    ["a blend mode that is not there (JSON says null)", set({ blend: null })],
  ])("accepts %s", (_what, ops) => {
    expect(typeof checkOps(ops)).not.toBe("string");
  });

  it.each([
    ["a picture that is a script", set({ src: "javascript:alert(1)" })],
    ["a picture from the web, which would tell its server who opened the design", set({ src: "https://example.test/p.jpg" })],
    ["a picture from the web without a scheme", set({ src: "//example.test/p.jpg" })],
    ["an original picture from the web", set({ originalSrc: "http://example.test/p.jpg" })],
    ["an original picture that is a script", set({ originalSrc: "javascript:alert(1)" })],
    ["a picture that is a page", set({ src: "data:text/html,<script>alert(1)</script>" })],
    ["a link that is a script", set({ link: "  JavaScript:alert(1)" })],
    ["a link that is another kind of script", set({ link: "vbscript:x" })],
    ["a link with no scheme that could be anything", set({ href: "evil.example/x" })],
    ["markup that runs a script", set({ svg: "<svg><script>alert(1)</script></svg>" })],
    ["markup with an event", set({ svg: '<svg onload="alert(1)"></svg>' })],
    ["markup that embeds a page", set({ svg: "<svg><foreignObject><div/></foreignObject></svg>" })],
    ["markup with an event that a browser reads after a slash", set({ svg: '<svg/onload="alert(1)"/>' })],
    ["markup with an event on a shape", set({ svg: "<svg><g onclick=alert(1)></g></svg>" })],
    ["markup with an event in capitals", set({ svg: '<svg><g ONMOUSEOVER="x"/></svg>' })],
    ["markup with an address written in characters", set({ svg: '<svg><linearGradient href="&#106;avascript:alert(1)"/></svg>' })],
    ["markup that links out of the drawing", set({ svg: '<svg><a href="https://evil.test/"><rect/></a></svg>' })],
    ["markup that loads another file", set({ svg: '<svg><rect fill="url(https://evil.test/p.svg#a)"/></svg>' })],
    ["markup that is a style sheet", set({ svg: "<svg><style>@import url(https://evil.test/x.css)</style></svg>" })],
    ["markup that is not markup", set({ svg: "hello" })],
    ["a recolouring with markup in it", set({ colors: { "#ff0000": '#111111"/onload="alert(1)' } })],
    ["a recolouring that is a reference to another file", set({ colors: { "#ff0000": "url(https://evil.test/p)" } })],
    ["a recolouring that is not text", set({ colors: { "#ff0000": 5 } })],
    ["a graphic that is added with a recolouring that is code", add({ type: "graphic", svg: "<svg/>", colors: { "#000000": 'a" onclick="x' } })],
    ["markup with a script in a graphic that is added", add({ type: "graphic", svg: "<svg><script>1</script></svg>" })],
    ["markup with a script in a graphic inside a group", add({ type: "group", children: [{ id: "c", type: "graphic", svg: '<svg onload="1"/>' }] })],
    [
      "markup with a script in a graphic of a page",
      [{ k: "page.add", page: { id: "p2", elements: [whole({ id: "g", type: "graphic", svg: "<svg><script/></svg>" })] }, index: 0 }],
    ],
    ["a blend mode that does not exist", set({ blend: "sparkle" })],
    ["a blend mode that is written as the absence of one", set({ blend: "normal" })],
    ["a blend mode with a style after it", set({ blend: "multiply;background:url(https://evil.test/x)" })],
    ["a blend mode that is a number", set({ blend: 5 })],
    ["a blend mode that is true", set({ blend: true })],
    ["a blend mode that is a list", set({ blend: ["multiply"] })],
    ["a blend mode that is an object", set({ blend: { mode: "multiply" } })],
    ["a blend mode that does not exist on an element that is added", add({ blend: "sparkle" })],
    ["a blend mode that does not exist on a child of a group", add({ type: "group", children: [{ id: "c", type: "shape", blend: "sparkle" }] })],
    ["a number that is not finite", set({ x: Number.NaN })],
    ["a value that is a function", set({ x: () => 1 })],
    ["a property called __proto__ in the properties", [{ k: "el.set", page: "p", id: "a", set: parsed('{"__proto__":{"polluted":true}}') }]],
    ["a property called constructor deep inside a value", set({ fill: parsed('{"stops":[{"constructor":1}]}') })],
    ["text that is longer than any text can be", set({ name: "x".repeat(1_000_001) })],
    ["a list that is longer than any list can be", set({ path: Array.from({ length: 100_001 }, () => 1) })],
    ["a value nested far too deep", set({ fill: nested(60) })],
    ["an element that carries a script in its picture", add({ type: "image", src: "javascript:alert(1)" })],
    ["a child of a group that carries a script", add({ type: "group", children: [{ id: "c", type: "image", src: "javascript:1" }] })],
    ["a page that carries a script in a background", [{ k: "page.add", page: { id: "p2", elements: [], background: { type: "image", src: "javascript:1" } }, index: 0 }]],
  ])("refuses %s", (_what, ops) => {
    expect(typeof checkOps(ops)).toBe("string");
  });

  it("refuses a batch that adds up to more content than a design could need", () => {
    const big = () => ({ k: "el.set", page: "p", id: "a", set: { path: Array.from({ length: 20_000 }, (_, i) => i) } });
    expect(typeof checkOps(Array.from({ length: 20 }, big))).toBe("string");
    expect(typeof checkOps(Array.from({ length: 10 }, big))).not.toBe("string");
  });
});

describe("who may do what", () => {
  it("lets those who edit send operations, and nobody else", () => {
    expect(canEdit("edit")).toBe(true);
    expect(canEdit("view")).toBe(false);
  });
});

const overTheWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shared = (): Design =>
  createDesign({
    title: "Shared",
    width: 1000,
    height: 600,
    pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a", x: 1 }), createGraphic({ id: "g", svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>' })] })],
  });
const withElements = (elements: unknown[], more: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...overTheWire(shared()),
  ...more,
  pages: [{ id: "p", background: { type: "solid", color: "#ffffff" }, elements }],
});
const nestedGroups = (levels: number): DesignElement => {
  let inner: DesignElement = createShape("rect", { id: "leaf" });
  for (let i = 0; i < levels; i++) inner = createGroup([inner], { id: `g${i}` });
  return inner;
};

describe("checkDesign: a design that arrives whole, as the welcome of a server", () => {
  it("accepts a design as the editor makes it", () => {
    expect(checkDesign(overTheWire(shared()))).toBeNull();
  });

  it("accepts a design whose elements have blend modes, in a group too", () => {
    expect(
      checkDesign(
        withElements([whole({ id: "a", type: "shape", blend: "multiply" }), whole({ id: "g", type: "group", children: [{ id: "b", type: "shape", blend: "luminosity" }] })]),
      ),
    ).toBeNull();
  });

  it("accepts groups as deep as an element may be nested", () => {
    expect(checkDesign(withElements(overTheWire([nestedGroups(32)])))).toBeNull();
    expect(checkDesign(withElements(overTheWire([nestedGroups(33)])))).toMatch(/deep/);
  });

  it("accepts a design with more in it than one batch may carry, which many batches have built up", () => {
    const elements = Array.from({ length: 16_000 }, (_, i) => whole({ id: `r${i}`, type: "shape", ...Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`p${k}`, k])) }));
    const page = { id: "p", elements };
    expect(checkOps([{ k: "page.add", page, index: 0 }])).toMatch(/more content/);
    expect(checkDesign(withElements(elements))).toBeNull();
  });

  it.each<[string, () => unknown]>([
    ["something that is not an object", () => 5],
    ["nothing at all", () => null],
    ["a list", () => []],
    ["a design with no pages", () => ({ ...shared(), pages: [] })],
    ["pages that are not a list", () => ({ ...shared(), pages: {} })],
    ["a page that is not an object", () => ({ ...shared(), pages: [7] })],
    ["a page with no id", () => ({ ...shared(), pages: [{ elements: [] }] })],
    ["a page whose elements are not a list", () => ({ ...shared(), pages: [{ id: "p", elements: "no" }] })],
    ["an element that is not one", () => withElements([{ id: "a", type: "weird" }])],
    ["a title that is not text", () => ({ ...shared(), title: { a: 1 } })],
    ["a width that is not a number", () => ({ ...shared(), width: "1000" })],
    ["a height of nothing", () => ({ ...shared(), height: 0 })],
    ["a width that is not finite", () => ({ ...shared(), width: Infinity })],
    ["a unit that is not text", () => ({ ...shared(), unit: 5 })],
    ["a picture that is a script", () => withElements([whole({ id: "a", type: "image", src: "javascript:alert(1)" })])],
    ["a page whose background is a script", () => ({ ...shared(), pages: [{ id: "p", elements: [], background: { type: "image", src: "javascript:1" } }] })],
    ["markup that runs", () => withElements([whole({ id: "a", type: "graphic", svg: '<svg/onload="1"/>' })])],
    ["markup inside a group", () => withElements([whole({ id: "g", type: "group", children: [{ id: "a", type: "graphic", svg: "<svg><script/></svg>" }] })])],
    ["a link that is a script", () => withElements([whole({ id: "a", type: "shape", link: "javascript:alert(1)" })])],
    ["a blend mode that does not exist", () => withElements([whole({ id: "a", type: "shape", blend: "sparkle" })])],
    ["a blend mode that does not exist inside a group", () => withElements([whole({ id: "g", type: "group", children: [{ id: "a", type: "shape", blend: "<b>" }] })])],
    ["a property called __proto__ at the top", () => JSON.parse('{"__proto__":{"x":1},"title":"t","width":1,"height":1,"pages":[{"id":"p","elements":[]}]}')],
    ["a property called constructor deep inside", () => withElements([whole({ id: "a", type: "shape", fill: JSON.parse('{"stops":[{"constructor":1}]}') })])],
    ["a value nested far too deep", () => withElements([whole({ id: "a", type: "shape", fill: Array.from({ length: 200 }).reduce<unknown>((v) => ({ v }), 1) })])],
    ["a text that is longer than any text can be", () => ({ ...shared(), title: "x".repeat(1_000_001) })],
  ])("refuses %s", (_what, make) => {
    expect(typeof checkDesign(make())).toBe("string");
  });
});

describe("parseServerMsg: what a server says, before anything of it is used", () => {
  const design = () => overTheWire(shared());
  const good = (): unknown[] => [
    { t: "welcome", role: "edit", rev: 3, lastSeq: 2, design: design() },
    { t: "welcome", role: "view", rev: 0, lastSeq: 0, design: design() },
    { t: "welcome", role: "edit", rev: 3, lastSeq: 2, design: design(), peer: 7 },
    { t: "welcome", role: "edit", rev: 3, lastSeq: 2, design: design(), peer: 7, name: "Val Owner" },
    { t: "ack", seq: 4, rev: 9 },
    { t: "rejected", seq: 4, reason: "this link is read-only" },
    { t: "ops", rev: 5, ops: [{ k: "el.del", page: "p", id: "a" }] },
    { t: "denied", reason: "no-access" },
    { t: "denied", reason: "server-full" },
    { t: "pong" },
  ];

  it("accepts every kind of message in its proper form, and gives back what it was given", () => {
    for (const msg of good()) expect(parseServerMsg(overTheWire(msg))).toEqual(msg);
  });

  it("gives back only what a message is made of", () => {
    expect(parseServerMsg({ t: "ack", seq: 1, rev: 2, evil: { polluted: true } })).toEqual({ t: "ack", seq: 1, rev: 2 });
    const welcome = parseServerMsg({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: design(), extra: 1 }) as unknown as Record<string, unknown>;
    expect(Object.keys(welcome).sort()).toEqual(["design", "lastSeq", "rev", "role", "t"]);
  });

  it("keeps the name of a welcome only as a name presence may say, and none that is left with nothing", () => {
    const named = (name: unknown) => parseServerMsg({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: design(), peer: 1, name }) as Record<string, unknown> | string;
    expect(named(" Val\u0000 Owner\n")).toMatchObject({ name: "Val Owner" });
    expect(named("\u0000 ")).not.toHaveProperty("name");
    expect(named(5)).toMatch(/^welcome: /);
    expect(named("x".repeat(41))).toMatch(/^welcome: /);
  });

  it("lets a kind of message pass that a newer server may send and this version does not know", () => {
    expect(parseServerMsg({ t: "reaction", who: [] })).toBeNull();
  });

  it.each<[string, () => unknown]>([
    ["nothing", () => undefined],
    ["null", () => null],
    ["a number", () => 5],
    ["text", () => "welcome"],
    ["a list of messages", () => [{ t: "pong" }]],
    ["a message with no kind", () => ({ rev: 1 })],
    ["a kind that is not text", () => ({ t: 5 })],
    ["a welcome for a role nobody has", () => ({ t: "welcome", role: "admin", rev: 1, lastSeq: 0, design: design() })],
    ["a welcome with a revision that is text", () => ({ t: "welcome", role: "edit", rev: "1", lastSeq: 0, design: design() })],
    ["a welcome with a revision below nothing", () => ({ t: "welcome", role: "edit", rev: -1, lastSeq: 0, design: design() })],
    ["a welcome with a revision that is half", () => ({ t: "welcome", role: "edit", rev: 1.5, lastSeq: 0, design: design() })],
    ["a welcome with no number for the last batch", () => ({ t: "welcome", role: "edit", rev: 1, design: design() })],
    ["a welcome with no design", () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0 })],
    ["a welcome with a number for the connection that is text", () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: design(), peer: "1" })],
    ["a welcome with a design that has no pages", () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: { ...design(), pages: [] } })],
    [
      "a welcome with a design that carries code",
      () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: withElements([whole({ id: "a", type: "graphic", svg: '<svg/onload="1"/>' })]) }),
    ],
    ["an acknowledgement with a number that is text", () => ({ t: "ack", seq: "1", rev: 2 })],
    ["an acknowledgement with no revision", () => ({ t: "ack", seq: 1 })],
    ["a refusal with no number", () => ({ t: "rejected", seq: "x", reason: "no" })],
    ["a refusal whose reason is not text", () => ({ t: "rejected", seq: 1, reason: { a: 1 } })],
    ["operations with a revision that is text", () => ({ t: "ops", rev: "5", ops: [] })],
    ["operations that are not a list", () => ({ t: "ops", rev: 5, ops: {} })],
    ["operations of a kind that does not exist", () => ({ t: "ops", rev: 5, ops: [{ k: "page.explode", id: "p" }] })],
    ["operations that set a picture to code", () => ({ t: "ops", rev: 5, ops: [{ k: "el.set", page: "p", id: "a", set: { src: "javascript:alert(1)" } }] })],
    ["a denial for a reason nobody has", () => ({ t: "denied", reason: "because" })],
    ["a denial with no reason", () => ({ t: "denied" })],
  ])("refuses %s", (_what, make) => {
    expect(typeof parseServerMsg(make())).toBe("string");
  });

  it("says what is wrong in the operations, so that a person who reads the log can tell", () => {
    expect(parseServerMsg({ t: "ops", rev: 5, ops: [{ k: "el.set", page: "p", id: "a", set: { src: "javascript:alert(1)" } }] })).toMatch(/src is not a safe address/);
  });
});

describe("an element that arrives whole is checked as strictly as one in a file", () => {
  const added = (el: unknown): unknown[] => [{ k: "el.add", page: "p", parent: null, index: 0, el }];
  const inGroup = (el: unknown) => ({ ...whole({ type: "group" }), children: [el] });

  it.each<[string, Record<string, unknown>]>([
    ["a place that is text", whole({ x: "a" })],
    ["a size that is missing", whole({ width: undefined })],
    ["an opacity that is nothing", whole({ opacity: null })],
    ["paragraphs that are a number", whole({ type: "text", paragraphs: 5 })],
    ["a text with no font", whole({ type: "text", fontFamily: undefined })],
    ["a text whose effect is text", whole({ type: "text", effect: "glow" })],
    ["a shape of no shape", whole({ shape: undefined })],
    ["a line with no stroke", whole({ type: "line", stroke: null })],
    ["a line whose stroke has no width", whole({ type: "line", stroke: { color: "#000000" } })],
    ["a picture with no crop", whole({ type: "image", crop: undefined })],
    ["a picture whose source is a number", whole({ type: "image", src: 5 })],
    ["a graphic that does not say how big its drawing is", whole({ type: "graphic", viewW: undefined })],
    ["a graphic with no markup at all", whole({ type: "graphic", svg: undefined })],
    ["a table whose cells are text", whole({ type: "table", cells: "a" })],
    ["a chart with no colours", whole({ type: "chart", palette: [] })],
  ])("refuses %s: added to a page, inside a group, on a new page, and in a design that arrives whole", (_what, el) => {
    expect(checkOps(added(el))).toMatch(/^el\.add: /);
    expect(checkOps(added(inGroup(el)))).toMatch(/^el\.add: /);
    expect(checkOps([{ k: "page.add", page: { id: "p2", background: { type: "solid", color: "#ffffff" }, elements: [el] }, index: 0 }])).toMatch(/^page\.add: /);
    expect(checkOps([{ k: "page.add", page: { id: "p2", background: { type: "solid", color: "#ffffff" }, elements: [inGroup(el)] }, index: 0 }])).toMatch(/^page\.add: /);
    expect(typeof checkDesign(withElements([whole(), el]))).toBe("string");
    expect(typeof checkDesign(withElements([inGroup(el)]))).toBe("string");
    expect(parseServerMsg({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: withElements([el]) })).toMatch(/^welcome: /);
    expect(parseServerMsg({ t: "ops", rev: 2, ops: added(el) })).toMatch(/^ops: el\.add: /);
  });

  it("says which property it is, so that a person who reads the log can tell", () => {
    expect(checkOps(added(whole({ x: "a" })))).toBe("el.add: x of a shape must be a number");
    expect(checkOps(added(whole({ type: "text", paragraphs: 5 })))).toBe("el.add: paragraphs of a text must be a list");
    expect(checkDesign(withElements([inGroup(whole({ type: "chart", palette: [] }))]))).toBe("palette of a chart must be a list that is not empty");
  });

  it("still wants an id that is one, which a file does not ask for", () => {
    expect(typeof checkOps(added(whole({ id: "" })))).toBe("string");
    expect(typeof checkOps(added(whole({ id: "x".repeat(500) })))).toBe("string");
  });

  it("accepts one element of each kind as the editor makes it, added one by one and all on one new page", () => {
    const elements = overTheWire(oneOfEach());
    for (const el of elements) expect(checkOps(added(el)), el.type).toEqual(added(el));
    expect(typeof checkOps([{ k: "page.add", page: { id: "p2", background: { type: "solid", color: "#ffffff" }, elements }, index: 0 }])).not.toBe("string");
    expect(checkDesign(withElements(elements))).toBeNull();
  });

  it("accepts the design that has every field there is, and the smallest one", () => {
    expect(checkDesign(overTheWire(completeDesign()))).toBeNull();
    expect(checkDesign(overTheWire(minimalDesign()))).toBeNull();
  });

  it("accepts every template of the catalogue as a design, and each of its pages as a page that is added", () => {
    expect(TEMPLATES.length).toBeGreaterThan(50);
    for (const template of TEMPLATES) {
      const design = overTheWire({ ...shared(), title: template.name, width: template.width, height: template.height, pages: template.pages });
      const problem = checkDesign(design);
      if (problem) throw new Error(`${template.id}: ${problem}`);
      for (const page of design.pages) {
        // (a page of a template may hold more than one batch carries: only what is wrong with an element matters here)
        const checked = checkOps([{ k: "page.add", page, index: 0 }]);
        if (typeof checked === "string" && !/more content/.test(checked)) throw new Error(`${template.id}, page ${page.id}: ${checked}`);
      }
    }
  });
});

describe("checkSets: what a batch left of the elements whose properties it changed", () => {
  const before = (): Design =>
    createDesign({
      title: "Shared",
      width: 1000,
      height: 600,
      pages: [
        createPage({
          id: "p",
          elements: [
            createShape("rect", { id: "a" }),
            createText({ id: "t", text: "Hello" }),
            createLine({ id: "l" }),
            createImage({ id: "i", src: null }),
            createChart({ id: "c" }),
            createGroup([createShape("rect", { id: "inner" })], { id: "g" }),
          ],
        }),
        createPage({ id: "q", elements: [] }),
      ],
    });
  const set = (id: string, props: Record<string, unknown>, unset?: string[]): Op => ({ k: "el.set", page: "p", id, set: props, ...(unset ? { unset } : {}) });
  const after = (ops: Op[], from = before()) => checkSets(from, applyOps(from, ops), ops);

  it.each<[string, Op[]]>([
    ["a place", [set("a", { x: 12, y: -3.5 })]],
    ["a fill, an outline and a name", [set("a", { fill: { type: "solid", color: "#ff0000" }, stroke: null, name: "Box" })]],
    ["what is not needed, taken away", [set("a", {}, ["fill", "radius", "name"])]],
    ["a property nobody knows", [set("a", { somethingNew: { a: [1, 2] } })]],
    ["the paragraphs and the font of a text", [set("t", { paragraphs: [{ runs: [{ text: "Hi" }] }], fontFamily: "Inter", fontSize: 20 })]],
    ["the stroke of a line", [set("l", { stroke: { color: "#000000", width: 2, style: "dashed" } })]],
    ["a picture taken out of its frame", [set("i", { src: null })]],
    ["a picture put into its frame", [set("i", { src: "asset:a_1" })]],
    ["an element inside a group", [set("inner", { x: 5 })]],
    ["the group itself", [set("g", { rotation: 45 })]],
    ["an element that is not there, which changes nothing", [set("gone", { x: "a" })]],
    ["an element on a page that is not there", [{ k: "el.set", page: "nowhere", id: "a", set: { x: "a" } }]],
    ["an element that the same batch then deletes", [set("a", { x: "a" }), { k: "el.del", page: "p", id: "a" }]],
    ["a batch that sets nothing", [{ k: "el.move", page: "p", id: "a", parent: null, index: 3 }]],
  ])("finds nothing wrong with %s", (_what, ops) => {
    expect(after(ops)).toBeNull();
  });

  it.each<[string, Op[], RegExp]>([
    ["a place that is text", [set("a", { x: "a" })], /x of a shape must be a number/],
    ["a place that is nothing", [set("a", { y: null })], /y of a shape/],
    ["a size that is taken away", [set("a", {}, ["width"])], /width of a shape/],
    ["an opacity that is a list", [set("a", { opacity: [1] })], /opacity/],
    ["paragraphs that are a number", [set("t", { paragraphs: 5 })], /paragraphs of a text must be a list/],
    ["a font that is a number", [set("t", { fontFamily: 5 })], /fontFamily/],
    ["a font size that is text", [set("t", { fontSize: "big" })], /fontSize/],
    ["an effect that is taken away", [set("t", {}, ["effect"])], /effect/],
    ["a shape of no shape", [set("a", { shape: 5 })], /shape of a shape/],
    ["a stroke that is taken from a line", [set("l", { stroke: null })], /stroke of a line/],
    ["a stroke of a line with no width", [set("l", { stroke: { color: "#000000" } })], /width of the stroke/],
    ["a picture whose source is a number", [set("i", { src: 5 })], /src of a image/],
    ["a picture whose source is taken away", [set("i", {}, ["src"])], /src/],
    ["a crop that is text", [set("i", { crop: "all" })], /crop/],
    ["a chart with no colours", [set("c", { palette: [] })], /palette/],
    ["a chart whose series are text", [set("c", { series: "many" })], /series/],
    ["an element inside a group", [set("inner", { height: "tall" })], /height/],
    ["the group itself", [set("g", { rotation: "a bit" })], /rotation of a group/],
    ["one bad change among good ones", [set("a", { x: 1 }), set("t", { fontSize: 12 }), set("l", { stroke: 5 }), set("c", { title: "T" })], /stroke of a line/],
    ["a change that a later one of the same batch does not mend", [set("a", { x: "a" }), set("a", { y: 4 })], /x of a shape/],
    [
      "an element that the same batch added, and then spoils",
      [{ k: "el.add", page: "p", parent: null, index: 0, el: createShape("rect", { id: "new" }) }, set("new", { width: "wide" })],
      /width of a shape/,
    ],
  ])("says what is wrong with %s", (_what, ops, words) => {
    const problem = after(ops);
    expect(problem).toMatch(/^el\.set: /);
    expect(problem).toMatch(words);
  });

  it("lets a batch mend its own mistake: what counts is the element as the batch leaves it", () => {
    expect(after([set("a", { x: "a" }), set("a", { x: 7 })])).toBeNull();
  });

  it("looks only at the elements whose properties the batch changed, and at each once", () => {
    const from = before();
    const damaged = { ...from, pages: [{ ...from.pages[0], elements: [...from.pages[0].elements, { id: "old", type: "shape" } as unknown as DesignElement] }, from.pages[1]] };
    // an element that was not usable before this change (a room from before the check) is nobody's new mistake
    expect(after([set("a", { x: 3 })], damaged)).toBeNull();
    expect(after([set("old", { name: "still broken" })], damaged)).toBeNull();
    // and one that the batch makes whole is whole
    expect(after([set("old", { ...createShape("rect", { id: "old" }), id: undefined, type: undefined })], damaged)).toBeNull();
    expect(after([set("old", { name: "x" }), set("a", { x: "a" })], damaged)).toMatch(/x of a shape/);
  });

  it("is quick for a batch that changes ten thousand elements of a big page", () => {
    const elements = Array.from({ length: 10_000 }, (_, i) => createShape("rect", { id: `s${i}` }));
    const big = { ...before(), pages: [createPage({ id: "p", elements })] };
    const ops = elements.map((el, i): Op => ({ k: "el.set", page: "p", id: el.id, set: { x: i } }));
    const moved = { ...big, pages: [{ ...big.pages[0], elements: elements.map((el, i) => ({ ...el, x: i })) }] };
    const started = performance.now();
    expect(checkSets(big, moved, ops)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
