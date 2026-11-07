import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { GraphicElement, ImageElement } from "@/core/types";
import type { GraphicDef } from "@/data/graphicTypes";
import { GRAPHICS } from "@/data/graphics";
import { PHOTOS } from "@/data/photos";
import { resetEditor } from "@/test/helpers";
import { lastElement, mountPanels, pageElements } from "@/test/tabsHarness";
import { GraphicCell, IconCell, PhotoCell, PhotoThumb, graphicAspect, photoSrc, useIconSvg } from "./cells";

const def = (svg: string): GraphicDef => ({ ...GRAPHICS[0], svg });

beforeEach(() => resetEditor());

describe("graphicAspect", () => {
  it("is the height over the width of the viewBox", () => {
    expect(graphicAspect(def('<svg viewBox="0 0 200 100"/>'))).toBe(0.5);
    expect(graphicAspect(def("<svg viewBox='10 20 100,150'/>"))).toBe(1.5);
  });

  it("keeps extreme strips within 0.4 and 1.5 so the columns stay even", () => {
    expect(graphicAspect(def('<svg viewBox="0 0 1000 50"/>'))).toBe(0.4);
    expect(graphicAspect(def('<svg viewBox="0 0 10 400"/>'))).toBe(1.5);
  });

  it("is square when the drawing has no usable viewBox", () => {
    expect(graphicAspect(def("<svg/>"))).toBe(1);
    expect(graphicAspect(def('<svg viewBox="0 0 0 10"/>'))).toBe(1);
  });
});

describe("photoSrc", () => {
  it("is the builtin source that the renderer resolves", () => {
    expect(photoSrc(PHOTOS[0])).toBe(`builtin:${PHOTOS[0].id}`);
  });
});

describe("<PhotoThumb>", () => {
  it("shows a shimmer until the preview exists, then the picture", async () => {
    const { container } = render(<PhotoThumb def={PHOTOS[1]} maxSide={200} />);
    expect(container.querySelector(".cf-skeleton")).toBeTruthy();
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(container.querySelector(".cf-skeleton")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("keeps the shimmer for a photo that does not exist", async () => {
    const { container } = render(<PhotoThumb def={{ ...PHOTOS[0], id: "no-such-photo" }} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".cf-skeleton")).toBeTruthy();
  });
});

describe("<GraphicCell> and <PhotoCell> outside a grid", () => {
  it("shows a sticker and an illustration differently", async () => {
    mountPanels();
    const illustration = GRAPHICS.find((g) => g.kind !== "sticker")!;
    const sticker: GraphicDef = { ...illustration, id: "test-sticker", name: "Test sticker", kind: "sticker" };
    const { container } = render(
      <>
        <GraphicCell def={illustration} />
        <GraphicCell def={sticker} />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll(".cf-cell__svg")).toHaveLength(2));
    const [plain, stuck] = Array.from(container.querySelectorAll(".cf-cell__svg"));
    expect(plain.classList.contains("is-sticker")).toBe(false);
    expect(stuck.classList.contains("is-sticker")).toBe(true);
  });

  it("inserts a sticker marked as a sticker", async () => {
    const user = userEvent.setup();
    mountPanels();
    const sticker: GraphicDef = { ...GRAPHICS[0], id: "test-sticker", name: "Test sticker", kind: "sticker" };
    render(<GraphicCell def={sticker} />);
    await user.click(screen.getByRole("button", { name: "Test sticker" }));
    expect((lastElement() as GraphicElement).source).toEqual({ kind: "sticker", id: "test-sticker" });
  });

  it("inserts a photo at its natural proportions", async () => {
    const user = userEvent.setup();
    mountPanels();
    const photo = PHOTOS.find((p) => p.height > p.width)!;
    render(<PhotoCell def={photo} />);
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: photo.name }));
    const el = lastElement() as ImageElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.src).toBe(`builtin:${photo.id}`);
    expect(el.height).toBeGreaterThan(el.width);
  });
});

describe("<IconCell> and useIconSvg", () => {
  function Probe({ id }: { id: string }) {
    return <p data-testid="svg">{useIconSvg(id) ? "ready" : "loading"}</p>;
  }

  it("loads an icon's drawing once and remembers it", async () => {
    const first = render(<Probe id="cat" />);
    expect(screen.getByTestId("svg").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("svg").textContent).toBe("ready"));
    first.unmount();
    // the second time the drawing is there from the first render
    render(<Probe id="cat" />);
    expect(screen.getByTestId("svg").textContent).toBe("ready");
  });

  it("stays empty for an icon that does not exist", async () => {
    render(<Probe id="definitely-not-an-icon" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("svg").textContent).toBe("loading");
  });

  it("does not change anything once the panel is gone, but still remembers the drawing", async () => {
    const { unmount } = render(<Probe id="rabbit" />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    render(<Probe id="rabbit" />);
    expect(screen.getByTestId("svg").textContent).toBe("ready");
  });

  it("follows the id to another drawing", async () => {
    function Markup({ id }: { id: string }) {
      return <p data-testid="markup">{useIconSvg(id) ?? "none"}</p>;
    }
    const { rerender } = render(<Markup id="dog" />);
    await waitFor(() => expect(screen.getByTestId("markup").textContent).toContain("<svg"));
    const dog = screen.getByTestId("markup").textContent;
    rerender(<Markup id="fish" />);
    await waitFor(() => expect(screen.getByTestId("markup").textContent).not.toBe(dog));
    expect(screen.getByTestId("markup").textContent).toContain("<svg");
  });

  it("cannot be dragged before its drawing has loaded, and adds nothing when there is none", async () => {
    const user = userEvent.setup();
    mountPanels();
    render(<IconCell def={{ id: "no-such-icon", name: "Missing icon", tags: [] }} />);
    const cell = screen.getByRole("button", { name: "Missing icon" });
    expect(cell.querySelector(".cf-skeleton")).toBeTruthy();
    const before = pageElements().length;
    await user.click(cell);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pageElements()).toHaveLength(before);
  });

  it("adds a one colour, recolourable icon", async () => {
    const user = userEvent.setup();
    mountPanels();
    render(<IconCell def={{ id: "bird", name: "Bird", tags: [] }} />);
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Bird" }));
    await waitFor(() => expect(pageElements()).toHaveLength(before + 1));
    const el = lastElement() as GraphicElement;
    expect(el.source).toEqual({ kind: "icon", id: "bird" });
    expect(el.colors).toEqual({ currentColor: "#0e1318" });
  });
});
