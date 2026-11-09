/**
 * The editor store in a design that is edited together with other people: what it tells the connection about every change, how
 * what other people did is shown (no step of undo, the person's own place kept as far as it still exists), and undo and redo that
 * take back this person's own steps and nothing else. The connection itself (src/collab) is tested on its own; here it is a spy,
 * and a second person is a design that changes under the store's feet.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOps, designsEqual, diffDesign, type Op } from "@/collab/ops";
import { createDesign, createLine, createPage, createShape, createText, solid } from "./factory";
import { getActivePage, pageOf, useEditor, type LiveBridge } from "./store";
import type { Design, DesignElement, LineElement } from "./types";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const page = () => getActivePage(s())!;
const el = (id: string) => page().elements.find((e) => e.id === id)!;
const ids = () => page().elements.map((e) => e.id);
const rect = (id: string, x = 0, y = 0, extra: Partial<DesignElement> = {}) => createShape("rect", { id, x, y, width: 100, height: 50, ...extra });

/** what the connection is told: every change as the design before and the design after */
let told: Array<{ before: Design; after: Design }>;
const bridge: LiveBridge = { change: (before, after) => void told.push({ before, after }) };

function open(elements: DesignElement[] = [rect("a", 0, 0), rect("b", 300, 0), rect("c", 600, 0)]) {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(
    createDesign({ title: "Together", width: 1000, height: 600, pages: [createPage({ id: "p1", elements }), createPage({ id: "p2", elements: [rect("on-page-two")] })] }),
  );
  told = [];
  a().startLive(bridge);
}

/** what another person does: the shared design as the connection would hand it to the store */
const elsewhere = (fn: (d: Design) => Design) => a().applyShared(fn(s().design!));
const withEls = (d: Design, fn: (els: DesignElement[]) => DesignElement[], pageId = "p1"): Design => ({
  ...d,
  pages: d.pages.map((p) => (p.id === pageId ? { ...p, elements: fn(p.elements) } : p)),
});
const setProps = (id: string, patch: Partial<DesignElement>) => (d: Design) => withEls(d, (els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)));
const opsOf = (entry: { before: Design; after: Design }): Op[] => diffDesign(entry.before, entry.after);

beforeEach(() => open());
afterEach(() => a().stopLive());

describe("telling the connection", () => {
  it("is told of every change as the design before it and after it, once", () => {
    a().updateElements(["a"], { x: 40 });
    expect(told).toHaveLength(1);
    expect(opsOf(told[0])).toEqual([{ k: "el.set", page: "p1", id: "a", set: { x: 40 } }]);
    expect(told[0].after).toBe(s().design);
    const n = a().addElement(rect("n"), { center: false });
    a().deleteElements([n]);
    expect(told).toHaveLength(3);
  });

  it("is told what the editor works out by itself in the same change: the lines that follow a shape", () => {
    open([rect("a", 0, 0), rect("b", 300, 0)]);
    const id = a().connect("a", "b");
    expect(opsOf(told.at(-1)!).map((o) => o.k)).toEqual(["el.add"]);
    a().updateElements(["a"], { y: 200 });
    expect(
      opsOf(told.at(-1)!)
        .map((o) => (o as { id: string }).id)
        .sort(),
    ).toEqual([id, "a"].sort());
  });

  it("is told when the design already is the new one, so that the connection may read the store", () => {
    const seen: Array<Design | null> = [];
    a().startLive({ change: (_before, after) => void seen.push(after === s().design ? s().design : null) });
    a().updateElements(["a"], { x: 40 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(s().design);
  });

  it("is not told when nothing shared changed: a star in the library, a title that stays", () => {
    a().updateMeta({ starred: true, folderId: "mine" }); // a change of the document, but not one for other people
    a().setTitle("Together");
    expect(told).toEqual([]);
    expect(s().canUndo).toBe(false); // and not a step of the undo of the shared design
    expect(s().design).toMatchObject({ starred: true, folderId: "mine" });
  });

  it("is not told while the document is only being looked at, or when no connection is attached", () => {
    a().setMode("view");
    a().updateElements(["a"], { x: 5 });
    expect(told).toEqual([]);
    a().setMode("edit");
    a().stopLive();
    a().updateElements(["a"], { x: 6 });
    expect(told).toEqual([]);
    expect(s().live).toBe(false);
  });
});

describe("what other people did", () => {
  it("is shown at once, is not a step of undo and is not told back to the connection", () => {
    elsewhere(setProps("b", { x: 500 }));
    expect(el("b").x).toBe(500);
    expect(s().canUndo).toBe(false);
    expect(told).toEqual([]);
    expect(s().saveState).toBe("unsaved"); // the design on this device is kept up to date
  });

  it("keeps what belongs to this person's library, and the shared parts of the design change", () => {
    a().updateMeta({ starred: true, folderId: "mine" });
    const id = s().design!.id;
    elsewhere((d) => ({ ...d, title: "Renamed by someone", id: "theirs", starred: false, folderId: null }));
    expect(s().design).toMatchObject({ id, starred: true, folderId: "mine", title: "Renamed by someone" });
  });

  it("keeps the selection as far as it is still there, and the page that is open", () => {
    a().select(["a", "b"]);
    elsewhere((d) => withEls(d, (els) => els.filter((e) => e.id !== "b")));
    expect(s().selection).toEqual(["a"]);
    expect(s().activePageId).toBe("p1");
  });

  it("goes to the first page when the page that is open is deleted, and stops editing a text that is gone", () => {
    const t = a().addElement(createText({ text: "Hello", x: 0, y: 100 }), { center: false });
    a().setActivePage("p2");
    elsewhere((d) => ({ ...d, pages: d.pages.filter((p) => p.id !== "p2") }));
    expect(s().activePageId).toBe("p1");
    a().select([t]);
    useEditor.setState({ editingTextId: t });
    elsewhere((d) => withEls(d, (els) => els.filter((e) => e.id !== t)));
    expect(s().editingTextId).toBeNull();
    expect(s().selection).toEqual([]);
  });

  it("aims the lines that follow a shape that someone moved, on this device, without telling anybody", () => {
    open([rect("a", 0, 0), rect("b", 300, 0)]);
    const id = a().connect("a", "b");
    told = [];
    const before = el(id) as LineElement;
    elsewhere(setProps("b", { y: 300 })); // a shape moved: nothing said about the line
    const after = el(id) as LineElement;
    expect(after).not.toBe(before);
    expect(after.height).toBe(0);
    expect(Math.abs(after.rotation)).toBeGreaterThan(1); // it points downwards now
    expect(told).toEqual([]);
  });

  it("does nothing for a design that is the same, or when no design is open or none is shared", () => {
    const before = s().design;
    a().applyShared(s().design!);
    expect(s().design).toBe(before);
    a().stopLive();
    elsewhere(setProps("a", { x: 99 }));
    expect(el("a").x).toBe(0);
    a().closeDesign();
    a().applyShared(createDesign({ width: 1, height: 1 }));
    expect(s().design).toBeNull();
  });
});

describe("undo and redo in a shared design", () => {
  it("take back this person's step and nothing else, however much others have changed since", () => {
    a().updateElements(["a"], { x: 40 }); // mine
    elsewhere(setProps("b", { x: 777 })); // theirs, on another element
    elsewhere(setProps("c", { fill: solid("#00ff00") }));
    expect(s().canUndo).toBe(true);
    a().undo();
    expect(el("a").x).toBe(0);
    expect(el("b").x).toBe(777);
    expect(el("c")).toMatchObject({ fill: solid("#00ff00") });
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(true);
    a().redo();
    expect(el("a").x).toBe(40);
    expect(el("b").x).toBe(777);
    expect(s().canRedo).toBe(false);
  });

  it("tell the connection what they do, like any other change", () => {
    a().updateElements(["a"], { x: 40 });
    told = [];
    a().undo();
    expect(opsOf(told[0])).toEqual([{ k: "el.set", page: "p1", id: "a", set: { x: 0 } }]);
    a().redo();
    expect(opsOf(told[1])).toEqual([{ k: "el.set", page: "p1", id: "a", set: { x: 40 } }]);
  });

  it("leave another person's change to another property of the same element alone", () => {
    a().updateElements(["a"], { x: 40 });
    elsewhere(setProps("a", { fill: solid("#0000ff") }));
    a().undo();
    expect(el("a")).toMatchObject({ x: 0, fill: solid("#0000ff") });
  });

  it("bring back an element that this person deleted, as it was, whatever else changed", () => {
    a().deleteElements(["b"]);
    elsewhere(setProps("c", { x: 9 }));
    expect(ids()).toEqual(["a", "c"]);
    a().undo();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(el("c").x).toBe(9);
    a().redo();
    expect(ids()).toEqual(["a", "c"]);
  });

  it("take a step that another person has made moot without harm", () => {
    a().updateElements(["b"], { x: 5 });
    elsewhere((d) => withEls(d, (els) => els.filter((e) => e.id !== "b"))); // someone deletes it
    a().undo(); // nothing to put back on: the step is used up all the same
    expect(ids()).toEqual(["a", "c"]);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(true);
    a().redo();
    expect(ids()).toEqual(["a", "c"]);
  });

  it("go back step by step, and a new change ends what can be redone", () => {
    a().updateElements(["a"], { x: 1 });
    a().updateElements(["a"], { x: 2 });
    a().updateElements(["a"], { x: 3 });
    a().undo();
    a().undo();
    expect(el("a").x).toBe(1);
    a().updateElements(["b"], { x: 8 });
    expect(s().canRedo).toBe(false);
    a().undo();
    expect(el("b").x).toBe(300);
    a().undo();
    expect(el("a").x).toBe(0);
    a().undo();
    expect(s().canUndo).toBe(false);
    expect(el("a").x).toBe(0);
  });

  it("count the edits that are coalesced, and a gesture, as one step each", () => {
    a().select(["a"]);
    a().nudge(5, 0);
    a().nudge(5, 0);
    a().nudge(5, 0);
    expect(el("a").x).toBe(15);
    a().undo();
    expect(el("a").x).toBe(0);
    a().beginTransaction();
    a().updateElements(["b"], { x: 310 });
    elsewhere(setProps("c", { x: 650 })); // someone else moves another element while this one is dragged
    a().updateElements(["b"], { x: 320 });
    a().updateElements(["b"], { x: 330 });
    a().endTransaction();
    expect(s().canUndo).toBe(true);
    a().undo();
    expect(el("b").x).toBe(300);
    expect(el("c").x).toBe(650); // the other person's move is not part of the gesture
    expect(s().canUndo).toBe(false);
  });

  it("bring back every part of a step that was joined from several changes, not only the first", () => {
    a().select(["a"]);
    a().nudge(5, 0);
    a().nudge(5, 0);
    a().nudge(5, 0);
    a().undo();
    expect(el("a").x).toBe(0);
    a().redo();
    expect(el("a").x).toBe(15);
    a().beginTransaction();
    a().updateElements(["b"], { x: 310 });
    a().updateElements(["b"], { x: 320 });
    a().updateElements(["b"], { x: 330 });
    a().endTransaction();
    a().undo();
    expect(el("b").x).toBe(300);
    a().redo();
    expect(el("b").x).toBe(330);
    a().undo();
    expect(el("b").x).toBe(300); // a step that was redone can be undone again
  });

  it("end what could be redone when a gesture ends", () => {
    a().updateElements(["a"], { x: 1 });
    a().undo();
    expect(s().canRedo).toBe(true);
    a().beginTransaction();
    a().updateElements(["b"], { x: 5 });
    a().endTransaction();
    expect(s().canRedo).toBe(false);
    a().redo(); // nothing is left to redo: the step that was taken back before the gesture is gone
    expect(el("a").x).toBe(0);
    expect(el("b").x).toBe(5);
  });

  it("go back to the first page when the page that was open is taken back, and find it again with redo", () => {
    const added = a().addPage();
    expect(s().activePageId).toBe(added);
    a().undo();
    expect(s().design!.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(s().activePageId).toBe("p1");
    a().redo();
    expect(s().design!.pages).toHaveLength(3);
    expect(s().activePageId).toBe("p1"); // where the person is stays
  });

  it("do nothing while a gesture is in progress, or when there is nothing to do", () => {
    a().undo();
    a().redo();
    expect(told).toEqual([]);
    a().updateElements(["a"], { x: 1 });
    a().beginTransaction();
    a().undo();
    expect(el("a").x).toBe(1);
    a().endTransaction();
  });

  it("keep as many steps as the editor does, and no more", () => {
    for (let i = 1; i <= 130; i++) a().updateElements(["a"], { x: i });
    let steps = 0;
    while (s().canUndo) {
      a().undo();
      steps++;
    }
    expect(steps).toBe(120);
    expect(el("a").x).toBe(10);
  });

  it("forget this person's steps when sharing stops or another design is opened", () => {
    a().updateElements(["a"], { x: 40 });
    a().stopLive();
    expect(s().canUndo).toBe(false);
    a().undo();
    expect(el("a").x).toBe(40);
    open();
    a().updateElements(["a"], { x: 41 });
    a().openDesign(createDesign({ width: 100, height: 100 }));
    expect(s().canUndo).toBe(false);
    a().updateElements([], {});
    expect(told).toHaveLength(1);
  });

  it("let go of the connection when another design is opened: that one is the person's own, with a history of its own", () => {
    a().openDesign(createDesign({ title: "Another", width: 400, height: 300, pages: [createPage({ id: "q1", elements: [rect("z")] })] }));
    told = [];
    a().updateElements(["z"], { x: 7 });
    expect(told).toEqual([]);
    expect(s().past).toHaveLength(1);
    expect(s().live).toBe(false);
  });

  it("leave the history of a design that is not shared exactly as it was: whole designs, one step each", () => {
    a().stopLive();
    a().updateElements(["a"], { x: 40 });
    elsewhere(setProps("b", { x: 777 })); // not shared: ignored
    expect(el("b").x).toBe(300);
    expect(s().past).toHaveLength(1);
    a().undo();
    expect(el("a").x).toBe(0);
  });

  it("use the same machinery as the connection: what undo asks of the others is the inverse of the step", () => {
    const before = s().design!;
    a().updateElements(["a"], { x: 40, y: 20 });
    const after = s().design!;
    a().undo();
    expect(designsEqual(s().design!, before)).toBe(true);
    expect(designsEqual(applyOps(after, opsOf(told.at(-1)!)), before)).toBe(true);
  });
});

describe("starting and stopping", () => {
  it("clears the history of the one design when sharing starts, and says that it is shared", () => {
    a().stopLive();
    a().updateElements(["a"], { x: 40 });
    expect(s().canUndo).toBe(true);
    a().startLive(bridge);
    expect(s().live).toBe(true);
    expect(s().canUndo).toBe(false);
    expect(s().past).toEqual([]);
  });

  it("attaches the link of a shared design to the design, on this device only", () => {
    a().setLiveLink({ server: "wss://live.example.test", room: "r", key: "k", role: "edit" });
    expect(s().design!.live).toEqual({ server: "wss://live.example.test", room: "r", key: "k", role: "edit" });
    expect(s().saveState).toBe("unsaved");
    expect(told).toEqual([]);
    a().setLiveLink(null);
    expect(s().design!.live).toBeUndefined();
    expect(pageOf(s().design, "p1")).toBeTruthy();
  });
});

describe("a line that is attached survives all of it", () => {
  it("is aimed the same on both sides: what is sent for a move and what the other copy shows after it", () => {
    open([rect("a", 0, 0), rect("b", 300, 0), createLine({ id: "line0" })]);
    a().connect("a", "b");
    const start = s().design!;
    told = [];
    a().updateElements(["b"], { x: 500, y: 100 });
    const sent = told.flatMap(opsOf);
    const copy = applyOps(start, sent);
    expect(designsEqual(copy, s().design!)).toBe(true);
  });
});
