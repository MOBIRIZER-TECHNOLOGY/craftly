/**
 * text.ts: a text as one line of positions, the splice that takes one text to another, and a splice made on one text moved onto
 * the text as somebody else has changed it meanwhile, so that both keep their letters.
 */
import { describe, expect, it } from "vitest";
import type { TextParagraph } from "@/core/types";
import { applySplice, editScript, flatText, mapPosition, MARK, mergeText, rebase, textSplice } from "./text";

const P = (...runs: (string | [string, Record<string, unknown>])[]): TextParagraph => ({
  runs: runs.map((r) => (typeof r === "string" ? { text: r } : { text: r[0], ...r[1] })),
});
const plain = (paras: TextParagraph[]) => paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
const text = (s: string): TextParagraph[] => s.split("\n").map((line) => P(line));

/** A random generator with a seed, so that a failure can be run again. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a person might do to a text: type, delete, press Enter, make a stretch bold. */
function randomEdit(paras: TextParagraph[], rnd: () => number): TextParagraph[] {
  const line = flatText(paras);
  const pos = 1 + Math.floor(rnd() * (line.length - 1 + 1));
  const kind = rnd();
  if (kind < 0.5) {
    const ch = "abcdefgh é😀"[Math.floor(rnd() * 12)];
    const ins = ch === "😀" ? "😀" : ch;
    return applySplice(paras, { at: Math.min(pos, line.length), del: 0, ins: [{ text: ins, ...(rnd() < 0.2 ? { bold: true } : {}) }] });
  }
  if (kind < 0.75) {
    const at = Math.min(pos, line.length - 1);
    const del = Math.min(line.length - at, 1 + Math.floor(rnd() * 3));
    return applySplice(paras, { at, del, ins: [] });
  }
  if (kind < 0.9) return applySplice(paras, { at: Math.min(pos, line.length), del: 0, ins: [{ para: rnd() < 0.5 ? { align: "center" } : {} }] });
  const at = Math.min(pos, line.length);
  const del = Math.min(line.length - at, 2);
  const slice = flatText(paras).slice(at, at + del);
  if (slice.includes(MARK)) return paras;
  return applySplice(paras, { at, del, ins: [{ text: slice, italic: true }] });
}

const normal = (paras: TextParagraph[]) => applySplice(paras, { at: 0, del: 0, ins: [] });

describe("a text as a line", () => {
  it("has a mark before each paragraph, then its characters", () => {
    expect(flatText([P("ab", "c"), P("")])).toBe(`${MARK}abc${MARK}`);
  });

  it("is spliced with styles kept, runs cut where a splice falls inside them, and paragraphs made where a mark is put", () => {
    const paras = [P(["Hello", { bold: true }], " world")];
    expect(applySplice(paras, { at: 3, del: 2, ins: [{ text: "X", italic: true }] })).toEqual([
      P(["He", { bold: true }], ["X", { italic: true }], ["o", { bold: true }], " world"),
    ]);
    expect(applySplice(paras, { at: 6, del: 0, ins: [{ para: { align: "center" } }] })).toEqual([P(["Hello", { bold: true }]), { align: "center", runs: [{ text: " world" }] }]);
    // taking a mark away joins two paragraphs, under the first one's alignment
    expect(applySplice([{ align: "right", runs: [{ text: "a" }] }, P("b")], { at: 2, del: 1, ins: [] })).toEqual([{ align: "right", runs: [{ text: "ab" }] }]);
    // everything taken away leaves one empty paragraph
    expect(applySplice(paras, { at: 0, del: 99, ins: [] })).toEqual([{ runs: [{ text: "" }] }]);
  });

  it("finds the one splice between two texts, which makes the one of the other", () => {
    const rnd = random(1);
    for (let i = 0; i < 400; i++) {
      let before = text("The quick brown fox\njumps over\n\nthe lazy dog");
      for (let j = 0; j < 3; j++) before = randomEdit(before, rnd);
      const after = randomEdit(before, rnd);
      const splice = textSplice(before, after);
      if (!splice) {
        expect(normal(after)).toEqual(normal(before));
        continue;
      }
      expect(normal(applySplice(before, splice))).toEqual(normal(after));
    }
  });

  it("never cuts a character outside the basic plane in two", () => {
    const splice = textSplice([P("a😀b")], [P("a😃b")]);
    // the two faces share their first half: the splice still takes both halves
    expect(splice).toMatchObject({ at: 2, del: 2 });
  });

  it("changes the style of an empty paragraph by replacing it", () => {
    const splice = textSplice([P("a"), P("")], [P("a"), P(["", { size: 40 }])]);
    expect(splice).not.toBeNull();
    expect(applySplice([P("a"), P("")], splice!)).toEqual([P("a"), P(["", { size: 40 }])]);
  });
});

describe("the comparison of two lines", () => {
  const replay = (a: string, b: string) => {
    let out = "";
    let ai = 0;
    let bi = 0;
    for (const s of editScript(a, b)) {
      if ("eq" in s) {
        expect(a.slice(ai, ai + s.eq)).toBe(b.slice(bi, bi + s.eq));
        out += a.slice(ai, ai + s.eq);
        ai += s.eq;
        bi += s.eq;
      } else if ("del" in s) ai += s.del;
      else {
        out += b.slice(bi, bi + s.ins);
        bi += s.ins;
      }
    }
    expect(ai).toBe(a.length);
    return out;
  };

  it("is a script that makes the second line from the first", () => {
    const rnd = random(2);
    for (let i = 0; i < 300; i++) {
      const a = Array.from({ length: Math.floor(rnd() * 40) }, () => "abc"[Math.floor(rnd() * 3)]).join("");
      const b = Array.from({ length: Math.floor(rnd() * 40) }, () => "abc"[Math.floor(rnd() * 3)]).join("");
      expect(replay(a, b)).toBe(b);
    }
  });

  it("finds two edits far apart as two, not as everything between them replaced", () => {
    const a = "x".repeat(50) + "MIDDLE" + "y".repeat(50);
    const b = "A" + a.slice(0, 103) + "B" + a.slice(103);
    const script = editScript(a, b);
    expect(script.filter((s) => !("eq" in s))).toEqual([{ ins: 1 }, { ins: 1 }]);
  });

  it("settles for one stretch replaced when the lines differ in too many places, quickly", () => {
    const a = "ab".repeat(200_000);
    const b = "ba".repeat(200_000);
    const t = performance.now();
    const script = editScript(a, b);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(replay(a, b)).toBe(b);
    expect(script.length).toBeLessThanOrEqual(4);
  });

  it("maps a position past what was put in before it, and to where taken-out text was", () => {
    const script = editScript("hello world", "hello big world");
    expect(mapPosition(script, 6, true)).toBe(10);
    expect(mapPosition(script, 6, false)).toBe(6);
    expect(mapPosition(script, 11, true)).toBe(15);
    const gone = editScript("hello big world", "hello world");
    expect(mapPosition(gone, 8, true)).toBe(6);
  });
});

describe("two people typing in one text at once", () => {
  it("keeps the letters of both when they type in different places", () => {
    const base = text("Hello world");
    const ana = text("Hello, world");
    const ben = text("Hello world!");
    expect(plain(mergeText(base, ben, ana))).toBe("Hello, world!");
    expect(plain(mergeText(base, ana, ben))).toBe("Hello, world!");
  });

  it("puts what the server applied first first, when both type in the same place", () => {
    const base = text("ab");
    // Ana's "X" was applied first; Ben's "Y", made on the text without it, goes after it
    expect(plain(mergeText(base, text("aYb"), text("aXb")))).toBe("aXYb");
  });

  it("keeps a deletion of one and the typing of the other next to it", () => {
    const base = text("one two three");
    const ana = text("one three"); // Ana deleted "two "
    const ben = text("one two three four");
    expect(plain(mergeText(base, ben, ana))).toBe("one three four");
    expect(plain(mergeText(base, ana, ben))).toBe("one three four");
  });

  it("keeps the other's letters around a deletion, and takes away what was deleted when the other typed inside it", () => {
    const base = text("abcdef");
    // Ana typed "X" at both ends of "cd" while Ben deleted "cd"
    expect(plain(mergeText(base, text("abef"), text("abXcdXef")))).toBe("abXXef");
    // Ana typed inside it: what Ben deleted goes, with what was typed inside it
    expect(plain(mergeText(base, text("abef"), text("abcXdef")))).toBe("abef");
  });

  it("keeps the style one gave a stretch while the other types elsewhere", () => {
    const base = text("bold me, then type");
    const ana = [P(["bold", { bold: true }], " me, then type")];
    const ben = text("bold me, then type here");
    expect(mergeText(base, ben, ana)).toEqual([P(["bold", { bold: true }], " me, then type here")]);
  });

  it("keeps new paragraphs of both", () => {
    const base = text("first second");
    const ana = text("first\nsecond");
    const ben = text("first second third");
    expect(plain(mergeText(base, ben, ana))).toBe("first\nsecond third");
  });

  it("moves a splice by what changed since its text", () => {
    expect(rebase(`${MARK}abc`, `${MARK}XYabc`, { at: 3, del: 1, ins: [] })).toEqual({ at: 5, del: 1, ins: [] });
  });

  it("ends the same for everybody, whatever the two type, when the server orders their changes", () => {
    // Two browsers each make changes on what they have; the server applies each change, as it arrives, by moving it onto the
    // text as it is; each browser then shows the server's text with its own unconfirmed changes moved onto it the same way.
    for (let seed = 1; seed <= 60; seed++) {
      const rnd = random(seed);
      let server = text("Shared text\nwith two lines");
      type Change = { base: string; splice: NonNullable<ReturnType<typeof textSplice>> };
      const clients = [0, 1].map(() => ({ confirmed: server, pending: [] as Change[] }));
      const shown = (c: (typeof clients)[number]) => c.pending.reduce((t, ch) => applySplice(t, rebase(ch.base, flatText(t), ch.splice)), c.confirmed);
      const inFlight: { from: number; change: Change }[] = [];
      for (let step = 0; step < 40; step++) {
        const who = rnd() < 0.5 ? 0 : 1;
        const c = clients[who];
        const r = rnd();
        if (r < 0.6) {
          const before = shown(c);
          const after = randomEdit(before, rnd);
          const splice = textSplice(before, after);
          if (!splice) continue;
          const change = { base: flatText(before), splice };
          c.pending.push(change);
          inFlight.push({ from: who, change });
        } else if (inFlight.length) {
          // the server takes the oldest change on its way and tells both
          const { from, change } = inFlight.shift()!;
          server = applySplice(server, rebase(change.base, flatText(server), change.splice));
          for (let i = 0; i < 2; i++) {
            if (i === from) clients[i].pending.shift();
            clients[i].confirmed = server;
          }
        }
      }
      while (inFlight.length) {
        const { from, change } = inFlight.shift()!;
        server = applySplice(server, rebase(change.base, flatText(server), change.splice));
        for (let i = 0; i < 2; i++) {
          if (i === from) clients[i].pending.shift();
          clients[i].confirmed = server;
        }
      }
      expect(shown(clients[0])).toEqual(server);
      expect(shown(clients[1])).toEqual(server);
    }
  });

  it("loses no letter of either when both only type, in different words", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = random(100 + seed);
      const base = text("alpha beta gamma delta");
      // Ana types capitals into the first half, Ben digits into the second
      let ana = base;
      let ben = base;
      for (let i = 0; i < 5; i++) {
        const a = 1 + Math.floor(rnd() * 11);
        ana = applySplice(ana, { at: a, del: 0, ins: [{ text: "ABCDE"[i] }] });
        const line = flatText(ben);
        const b = line.length - Math.floor(rnd() * 10);
        ben = applySplice(ben, { at: b, del: 0, ins: [{ text: "12345"[i] }] });
      }
      const merged = plain(mergeText(base, ben, ana));
      for (const ch of "ABCDE12345") expect(merged).toContain(ch);
      expect(merged.replace(/[A-E1-5]/g, "")).toBe("alpha beta gamma delta");
    }
  });
});
