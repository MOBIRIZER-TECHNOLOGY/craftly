/**
 * What may arrive over the network is checked before it is applied: the shape of every operation, its sizes, and who may send it.
 * (The content of an element is checked by the server on top of this; applying an operation is safe whatever it holds.)
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGraphic, createGroup, createPage, createShape } from "@/core/factory";
import type { Design, DesignElement } from "@/core/types";
import { canEdit, checkDesign, checkOps, MAX_OPS_PER_BATCH, parseServerMsg } from "./protocol";
import type { Op } from "./ops";

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
    ["an element with no id", [{ k: "el.add", page: "p", parent: null, index: 0, el: { type: "shape" } }]],
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
    let deep: unknown = { id: "leaf", type: "shape" };
    for (let i = 0; i < 100; i++) deep = { id: `g${i}`, type: "group", children: [deep] };
    expect(checkOps([{ k: "el.add", page: "p", parent: null, index: 0, el: deep }])).toMatch(/deep/i);
  });
});

describe("the content of what arrives", () => {
  const set = (props: Record<string, unknown>): unknown[] => [{ k: "el.set", page: "p", id: "a", set: props }];
  const add = (el: Record<string, unknown>): unknown[] => [{ k: "el.add", page: "p", parent: null, index: 0, el: { id: "n", type: "shape", ...el } }];
  const parsed = (json: string) => JSON.parse(json) as Record<string, unknown>;
  const nested = (levels: number) => {
    let v: unknown = 1;
    for (let i = 0; i < levels; i++) v = { v };
    return v;
  };

  it.each([
    ["an image from the editor", set({ src: "asset:a_1234" })],
    ["a stock picture of the editor", set({ src: "builtin:sunset", originalSrc: "asset:a_9" })],
    ["a picture from the web", set({ src: "https://example.test/p.jpg" })],
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
  ])("accepts %s", (_what, ops) => {
    expect(typeof checkOps(ops)).not.toBe("string");
  });

  it.each([
    ["a picture that is a script", set({ src: "javascript:alert(1)" })],
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
    ["markup with a script in a graphic of a page", [{ k: "page.add", page: { id: "p2", elements: [{ id: "g", type: "graphic", svg: "<svg><script/></svg>" }] }, index: 0 }]],
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

  it("accepts groups as deep as an element may be nested", () => {
    expect(checkDesign(withElements(overTheWire([nestedGroups(32)])))).toBeNull();
    expect(checkDesign(withElements(overTheWire([nestedGroups(33)])))).toMatch(/deep/);
  });

  it("accepts a design with more in it than one batch may carry, which many batches have built up", () => {
    const elements = Array.from({ length: 16_000 }, (_, i) => ({ id: `r${i}`, type: "shape", ...Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`p${k}`, k])) }));
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
    ["a picture that is a script", () => withElements([{ id: "a", type: "image", src: "javascript:alert(1)" }])],
    ["a page whose background is a script", () => ({ ...shared(), pages: [{ id: "p", elements: [], background: { type: "image", src: "javascript:1" } }] })],
    ["markup that runs", () => withElements([{ id: "a", type: "graphic", svg: '<svg/onload="1"/>' }])],
    ["markup inside a group", () => withElements([{ id: "g", type: "group", children: [{ id: "a", type: "graphic", svg: "<svg><script/></svg>" }] }])],
    ["a link that is a script", () => withElements([{ id: "a", type: "shape", link: "javascript:alert(1)" }])],
    ["a property called __proto__ at the top", () => JSON.parse('{"__proto__":{"x":1},"title":"t","width":1,"height":1,"pages":[{"id":"p","elements":[]}]}')],
    ["a property called constructor deep inside", () => withElements([{ id: "a", type: "shape", fill: JSON.parse('{"stops":[{"constructor":1}]}') }])],
    ["a value nested far too deep", () => withElements([{ id: "a", type: "shape", fill: Array.from({ length: 200 }).reduce<unknown>((v) => ({ v }), 1) }])],
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

  it("lets a kind of message pass that a newer server may send and this version does not know", () => {
    expect(parseServerMsg({ t: "presence", who: [] })).toBeNull();
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
    ["a welcome with a design that has no pages", () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: { ...design(), pages: [] } })],
    [
      "a welcome with a design that carries code",
      () => ({ t: "welcome", role: "edit", rev: 1, lastSeq: 0, design: withElements([{ id: "a", type: "graphic", svg: '<svg/onload="1"/>' }]) }),
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
