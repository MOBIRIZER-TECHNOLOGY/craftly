import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGroup, createPage, createShape, createText, createVideo } from "@/core/factory";
import { stopPreview, usePreview } from "@/editor/canvas/preview";
import { contextOf } from "@/test/canvasMock";
import { live, openElements, selectElements, showPanel, store } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  stopPreview();
  restoreLayout = stubLayout();
});
afterEach(() => {
  stopPreview();
  restoreLayout();
});

const box = (extra = {}) => createShape("rect", { x: 100, y: 100, width: 200, height: 100, ...extra });
const group = (name: string) => screen.getByRole("group", { name });
const tile = (groupName: string, label: string) => within(group(groupName)).getByRole("button", { name: label });
const slider = (name: string) => screen.getByRole("slider", { name });
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed") === "true";
const previewing = () => usePreview.getState().preview !== null;
const openAnimate = (tab: "element" | "page") => showPanel({ kind: "animate", tab });

describe("Animate panel: element animations", () => {
  it("offers the page animations when nothing is selected", async () => {
    const user = userEvent.setup();
    openElements([box()]);
    openAnimate("element");
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Page animations" }));
    expect(store().context).toEqual({ kind: "animate", tab: "page" });
    expect(screen.getByText("Page timing")).toBeTruthy();
  });

  it("refuses locked elements and elements inside a group", () => {
    const inner = box();
    const locked = box({ locked: true });
    const g = createGroup([inner], { x: 0, y: 0, width: 300, height: 200 });
    openElements([locked, g], { selected: [locked] });
    openAnimate("element");
    expect(screen.getByText("This can not be animated")).toBeTruthy();
    selectElements(inner);
    expect(screen.getByText("This can not be animated")).toBeTruthy();
    selectElements(g);
    expect(screen.queryByText("This can not be animated")).toBeNull();
  });

  it("gives an element an entrance and plays the page so the effect is seen", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    expect(pressed(tile("Entrance animations", "None"))).toBe(true);
    expect(previewing()).toBe(false);

    await user.click(tile("Entrance animations", "Rise"));
    expect(live(el).animation?.in).toEqual({ kind: "rise", duration: 0.8, delay: 0, direction: "up" });
    expect(pressed(tile("Entrance animations", "Rise"))).toBe(true);
    expect(pressed(tile("Entrance animations", "None"))).toBe(false);
    expect(previewing()).toBe(true);
    expect(usePreview.getState().preview?.from).toBe(0);
    // an entrance does not touch the exit and the emphasis
    expect(pressed(tile("Exit animations", "None"))).toBe(true);

    // undo takes it away again
    store().actions.undo();
    expect(live(el).animation).toBeUndefined();
  });

  it("changes direction, duration and delay of the animation and replays it", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    await user.click(tile("Entrance animations", "Rise"));
    stopPreview();
    await user.click(screen.getByRole("radio", { name: "Towards the left" }));
    expect(live(el).animation?.in?.direction).toBe("left");
    expect(screen.getByRole("radio", { name: "Towards the left" }).getAttribute("aria-checked")).toBe("true");
    expect(previewing()).toBe(true);

    slider("Duration").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(live(el).animation?.in?.duration).toBeCloseTo(1.0);
    expect(slider("Duration").getAttribute("aria-valuetext")).toBe("1.0 s");
    slider("Delay").focus();
    await user.keyboard("{ArrowRight}{End}");
    expect(live(el).animation?.in?.delay).toBe(10);
    await user.keyboard("{Home}");
    expect(live(el).animation?.in?.delay).toBe(0);
  });

  it("shows the directions a preset understands and none for a plain effect", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    await user.click(tile("Entrance animations", "Fade"));
    expect(screen.queryByRole("radiogroup", { name: "Direction" })).toBeNull();
    expect(live(el).animation?.in).toMatchObject({ kind: "fade" });
    await user.click(tile("Entrance animations", "Wipe"));
    expect(screen.getByRole("radiogroup", { name: "Direction" })).toBeTruthy();
    expect(live(el).animation?.in?.direction).toBe("right");
  });

  it("adds an exit and an emphasis with settings of their own", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    await user.click(tile("Exit animations", "Fade"));
    await user.click(tile("Emphasis animations", "Breathe"));
    expect(Object.keys(live(el).animation ?? {}).sort()).toEqual(["loop", "out"]);

    // an exit counts its delay back from the end of the page, an emphasis has none
    expect(screen.getAllByText("Leave early")).toHaveLength(1);
    expect(screen.getAllByText("Cycle length")).toHaveLength(1);
    expect(screen.queryAllByText("Delay")).toHaveLength(0);
    slider("Cycle length").focus();
    await user.keyboard("{ArrowRight}");
    expect(live(el).animation?.loop?.duration).toBeCloseTo(2.5);
    slider("Leave early").focus();
    await user.keyboard("{ArrowRight}");
    expect(live(el).animation?.out?.delay).toBeCloseTo(0.1);
  });

  it("removes one phase with None and everything with the remove button", async () => {
    const user = userEvent.setup();
    const el = box({ animation: { in: { kind: "pop", duration: 0.6, delay: 0 }, out: { kind: "fade", duration: 0.7, delay: 0 }, loop: { kind: "spin", duration: 3, delay: 0 } } });
    openElements([el], { selected: [el] });
    openAnimate("element");
    await user.click(tile("Exit animations", "None"));
    expect(Object.keys(live(el).animation ?? {}).sort()).toEqual(["in", "loop"]);
    expect(previewing()).toBe(false);

    await user.click(tile("Entrance animations", "Zoom"));
    expect(previewing()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Remove all animations" }));
    expect(live(el).animation).toBeUndefined();
    expect(previewing()).toBe(false);
    expect(screen.queryByRole("button", { name: "Remove all animations" })).toBeNull();
  });

  it("applies a choice to every selected element and does not pick a tile when they disagree", async () => {
    const user = userEvent.setup();
    const [a, b] = [box({ animation: { in: { kind: "fade", duration: 0.7, delay: 0 } } }), box({ animation: { in: { kind: "pop", duration: 0.6, delay: 0 } } })];
    openElements([a, b], { selected: [a, b] });
    openAnimate("element");
    for (const name of ["None", "Fade", "Pop"]) expect(pressed(tile("Entrance animations", name))).toBe(false);
    expect(screen.queryByRole("slider", { name: "Duration" })).toBeNull();
    await user.click(tile("Entrance animations", "Pop"));
    expect(live(a).animation?.in?.kind).toBe("pop");
    expect(live(b).animation?.in?.kind).toBe("pop");
    expect(pressed(tile("Entrance animations", "Pop"))).toBe(true);
  });

  it("plays and stops the whole page from the header", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    await user.click(screen.getByRole("button", { name: "Play the page" }));
    expect(usePreview.getState().preview).toMatchObject({ from: 0, until: 5 });
    await user.click(screen.getByRole("button", { name: "Stop preview" }));
    expect(previewing()).toBe(false);
  });

  it("switches between element and page animations with the tabs", async () => {
    const user = userEvent.setup();
    const el = box();
    openElements([el], { selected: [el] });
    openAnimate("element");
    expect(screen.getByRole("tab", { name: "Element animations" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Page animations" }));
    expect(store().context).toEqual({ kind: "animate", tab: "page" });
    expect(screen.getByRole("group", { name: "Page animations" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Element animations" }));
    expect(screen.getByRole("group", { name: "Entrance animations" })).toBeTruthy();
  });
});

describe("Animate panel: page animations", () => {
  const backdrop = () => createShape("rect", { x: 0, y: 0, width: 1000, height: 600 });

  it("animates every element one after another and leaves the backdrop and locked elements alone", async () => {
    const user = userEvent.setup();
    const [back, a, b, locked] = [backdrop(), box(), createText({ text: "Hi", x: 50, y: 50 }), box({ locked: true })];
    openElements([back, a, b, locked]);
    openAnimate("page");
    expect(pressed(tile("Page animations", "None"))).toBe(true);

    await user.click(tile("Page animations", "Pop"));
    expect(live(a).animation?.in).toMatchObject({ kind: "pop", delay: 0 });
    expect(live(b).animation?.in).toMatchObject({ kind: "pop", delay: 0.12 });
    expect(live(back).animation).toBeUndefined();
    expect(live(locked).animation).toBeUndefined();
    expect(pressed(tile("Page animations", "Pop"))).toBe(true);
    expect(pressed(tile("Page animations", "None"))).toBe(false);
    expect(previewing()).toBe(true);

    await user.click(tile("Page animations", "None"));
    expect(live(a).animation).toBeUndefined();
    expect(live(b).animation).toBeUndefined();
    expect(previewing()).toBe(false);
  });

  it("does not start a preview for a page with nothing to animate", async () => {
    const user = userEvent.setup();
    openElements([backdrop()]);
    openAnimate("page");
    await user.click(tile("Page animations", "Rise"));
    expect(previewing()).toBe(false);
  });

  it("sets how long the page stays, for this page or for all of them", async () => {
    const user = userEvent.setup();
    const second = createPage({ elements: [box()] });
    openElements([box()], { pages: [second] });
    openAnimate("page");
    expect(slider("Page duration").getAttribute("aria-valuetext")).toBe("5 s");
    slider("Page duration").focus();
    await user.keyboard("{ArrowRight}");
    const first = store().design!.pages[0].duration!;
    expect(first).toBeGreaterThan(5);
    expect(store().design!.pages[1].duration).toBeUndefined();

    await user.click(screen.getByRole("checkbox", { name: "Apply to all pages" }));
    slider("Page duration").focus();
    await user.keyboard("{ArrowRight}");
    const [p1, p2] = store().design!.pages;
    expect(p2.duration).toBe(p1.duration);
    expect(p1.duration).toBeGreaterThan(first);
  });

  it("says a page with a clip lasts as long as the clip, and gives it that length back after one was set", async () => {
    const user = userEvent.setup();
    openElements([box(), createVideo({ src: "asset:c", duration: 12, naturalWidth: 64, naturalHeight: 36, trimStart: 2, trimEnd: 11.5, speed: 1 })]);
    openAnimate("page");
    expect(slider("Page duration").getAttribute("aria-valuetext")).toBe("9.5 s");
    expect(screen.getByRole("status").textContent).toBe("Lasts as long as its clip: 9.5 s");
    expect(screen.queryByRole("button", { name: /Match the clip/ })).toBeNull();

    slider("Page duration").focus();
    await user.keyboard("{ArrowRight}");
    expect(store().design!.pages[0].duration).toBeGreaterThan(9.5);
    expect(screen.queryByText(/Lasts as long as its clip/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Match the clip (9.5 s)" }));
    expect("duration" in store().design!.pages[0]).toBe(false);
    expect(slider("Page duration").getAttribute("aria-valuetext")).toBe("9.5 s");
    expect(screen.getByText("Lasts as long as its clip: 9.5 s")).toBeTruthy();
  });

  it("says nothing about a clip on a page without one", () => {
    openElements([box()]);
    openAnimate("page");
    expect(screen.queryByText(/its clip/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Match the clip/ })).toBeNull();
  });

  it("says that the first page has no transition", () => {
    openElements([box()], { pages: [createPage()] });
    openAnimate("page");
    expect(screen.getByText(/first page has nothing to arrive from/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Page transitions" })).toBeNull();
  });

  it("chooses and tunes the transition into a page, and removes it", async () => {
    const user = userEvent.setup();
    const second = createPage({ elements: [box()] });
    openElements([box()], { pages: [second] });
    act(() => store().actions.setActivePage(second.id));
    openAnimate("page");
    expect(pressed(tile("Page transitions", "None"))).toBe(true);
    expect(screen.queryByRole("slider", { name: "Duration" })).toBeNull();

    await user.click(tile("Page transitions", "Push"));
    expect(store().design!.pages[1].transition).toEqual({ kind: "push", duration: 0.6, direction: "left" });
    expect(pressed(tile("Page transitions", "Push"))).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Upwards" }));
    expect(store().design!.pages[1].transition?.direction).toBe("up");
    slider("Duration").focus();
    await user.keyboard("{ArrowRight}");
    expect(store().design!.pages[1].transition?.duration).toBeCloseTo(0.7);

    // a transition without directions has no direction picker
    await user.click(tile("Page transitions", "Dissolve"));
    expect(screen.queryByRole("radiogroup", { name: "Direction" })).toBeNull();
    expect(store().design!.pages[1].transition?.kind).toBe("dissolve");

    await user.click(tile("Page transitions", "None"));
    expect(store().design!.pages[1].transition).toBeUndefined();
  });

  it("applies a transition to every page but the first when asked to", async () => {
    const user = userEvent.setup();
    const [second, third] = [createPage({ elements: [box()] }), createPage({ elements: [box()] })];
    openElements([box()], { pages: [second, third] });
    act(() => store().actions.setActivePage(second.id));
    openAnimate("page");
    const [, allTransitions] = screen.getAllByRole("checkbox", { name: "Apply to all pages" });
    await user.click(allTransitions);
    await user.click(tile("Page transitions", "Wipe"));
    const pages = store().design!.pages;
    expect(pages[0].transition).toBeUndefined();
    expect(pages[1].transition?.kind).toBe("wipe");
    expect(pages[2].transition?.kind).toBe("wipe");
    await user.click(screen.getByRole("radio", { name: "Downwards" }));
    expect(store().design!.pages[2].transition?.direction).toBe("down");
  });

  it("previews the transition with the real renderer and replays it", async () => {
    const user = userEvent.setup();
    const animated = createText({ text: "Animated", x: 10, y: 10, animation: { in: { kind: "fade", duration: 0.7, delay: 0 } } });
    const second = createPage({ elements: [animated, box()], transition: { kind: "zoom", duration: 0.7 } });
    openElements([box()], { pages: [second] });
    act(() => store().actions.setActivePage(second.id));
    openAnimate("page");
    const canvas = screen.getByRole("img", { name: "Preview of the transition" }) as HTMLCanvasElement;
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(5));
    const seen = contextOf(canvas)!.calls.length;
    await user.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(contextOf(canvas)!.calls.length).toBeGreaterThan(seen));
  });

  it("shows the page as it is while it has no transition", async () => {
    const second = createPage({ elements: [box()] });
    openElements([box()], { pages: [second] });
    act(() => store().actions.setActivePage(second.id));
    openAnimate("page");
    const canvas = screen.getByRole("img", { name: "This page" }) as HTMLCanvasElement;
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(0));
  });

  it("stops painting the transition when the panel goes away", async () => {
    const second = createPage({ elements: [box()], transition: { kind: "dissolve", duration: 0.7 } });
    openElements([box()], { pages: [second] });
    act(() => store().actions.setActivePage(second.id));
    const view = openAnimate("page");
    const canvas = screen.getByRole("img", { name: "Preview of the transition" }) as HTMLCanvasElement;
    await waitFor(() => expect(contextOf(canvas)?.calls.length ?? 0).toBeGreaterThan(0));
    view.unmount();
    const painted = contextOf(canvas)!.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(contextOf(canvas)!.calls.length).toBe(painted);
  });
});

describe("Animate panel without a design", () => {
  it.each(["element", "page"] as const)("shows the %s tab with nothing in it", (tab) => {
    openAnimate(tab);
    expect(screen.getByRole("region", { name: "Animate" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: tab === "page" ? "Page animations" : "Element animations" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText("Nothing selected")).toBeNull();
  });
});
