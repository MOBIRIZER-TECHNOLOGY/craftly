import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { lastElement, mountPanels, pageElements } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";
import { placeholderSvg } from "./PlaceholderApp";

beforeEach(() => {
  resetEditor();
  useAppsNav.setState({ app: "placeholder", query: "" });
});

async function openPlaceholder() {
  const user = userEvent.setup();
  mountPanels({ tab: "apps" });
  await screen.findByRole("heading", { name: "Placeholder image" });
  return user;
}

const picture = () => screen.getByRole("img", { name: /^Placeholder image, / }) as HTMLImageElement;
const shape = (name: string) => screen.getByRole("button", { name });
const width = () => screen.getByRole("spinbutton", { name: "W" }) as HTMLInputElement;
const height = () => screen.getByRole("spinbutton", { name: "H" }) as HTMLInputElement;
const svgOf = (img: HTMLImageElement) => decodeURIComponent(img.getAttribute("src")!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));

async function type(user: ReturnType<typeof userEvent.setup>, field: HTMLInputElement, value: string) {
  await user.clear(field);
  await user.type(field, `${value}{Enter}`);
}

describe("placeholderSvg", () => {
  it("is a flat picture of the requested size with its crossed corners, glyph and size label", () => {
    const svg = placeholderSvg(1200, 900, "#e7e9ef");
    expect(svg).toContain('viewBox="0 0 1200 900"');
    expect(svg).toContain('<rect width="1200" height="900" fill="#e7e9ef"/>');
    expect(svg).toContain("M0 0L1200 900M1200 0L0 900");
    expect(svg).toContain(">1200 × 900</text>");
    expect(svg).toContain("M4 18 L9 11 L13 16 L16 12 L22 18 Z");
  });

  it("draws a light picture in darker ink and a dark picture in lighter ink", () => {
    const ink = (svg: string) => /<g [^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)![1].toLowerCase();
    const onLight = ink(placeholderSvg(400, 300, "#ffffff"));
    const onDark = ink(placeholderSvg(400, 300, "#14213d"));
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(onLight)).toBeLessThan(lum("#ffffff"));
    expect(lum(onDark)).toBeGreaterThan(lum("#14213d"));
  });

  it("scales the glyph, the label and the lines with the shorter side, never below readable", () => {
    const small = placeholderSvg(40, 30, "#ffffff");
    expect(small).toContain('font-size="10"');
    expect(small).toContain('stroke-width="1"');
    const big = placeholderSvg(2000, 1000, "#ffffff");
    expect(big).toContain('font-size="70"');
    expect(big).toContain('stroke-width="4"');
  });

  it("rounds the size shown in the label", () => {
    expect(placeholderSvg(100.4, 49.6, "#eeeeee")).toContain(">100 × 50</text>");
  });
});

describe("Placeholder image app", () => {
  it("starts with a 4 : 3 picture in light grey", async () => {
    await openPlaceholder();
    expect(screen.getByText("A stand-in picture you can swap later")).toBeTruthy();
    expect(picture().getAttribute("alt")).toBe("Placeholder image, 1200 by 900");
    expect(svgOf(picture())).toBe(placeholderSvg(1200, 900, "#e7e9ef"));
    expect(shape("4 : 3").getAttribute("aria-pressed")).toBe("true");
    expect(width().value).toBe("1200");
    expect(height().value).toBe("900");
  });

  it("offers five shapes and marks the one in use", async () => {
    const user = await openPlaceholder();
    const group = screen.getByRole("group", { name: "Shape" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Square", "4 : 3", "16 : 9", "4 : 5", "9 : 16"]);
    await user.click(shape("Square"));
    expect(picture().getAttribute("alt")).toBe("Placeholder image, 1000 by 1000");
    expect(shape("Square").getAttribute("aria-pressed")).toBe("true");
    expect(shape("4 : 3").getAttribute("aria-pressed")).toBe("false");
    expect([width().value, height().value]).toEqual(["1000", "1000"]);
    await user.click(shape("9 : 16"));
    expect(picture().getAttribute("alt")).toBe("Placeholder image, 720 by 1280");
  });

  it("takes any size between 16 and 8000 px", async () => {
    const user = await openPlaceholder();
    await type(user, width(), "640");
    await type(user, height(), "360");
    expect(picture().getAttribute("alt")).toBe("Placeholder image, 640 by 360");
    // no shape matches: none is pressed
    expect(
      within(screen.getByRole("group", { name: "Shape" }))
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(0);
    await type(user, width(), "99999");
    expect(width().value).toBe("8000");
    await type(user, height(), "1");
    expect(height().value).toBe("16");
    expect(picture().getAttribute("alt")).toBe("Placeholder image, 8000 by 16");
  });

  it("fits the preview to a box, wide or tall, and never makes it a sliver", async () => {
    const user = await openPlaceholder();
    expect(picture().style.width).toBe("236px");
    expect(picture().style.height).toBe(`${236 / (1200 / 900)}px`);
    await user.click(shape("9 : 16"));
    expect(picture().style.height).toBe("168px");
    expect(picture().style.width).toBe(`${168 * (720 / 1280)}px`);
    await type(user, width(), "8000");
    await type(user, height(), "16");
    expect(picture().style.height).toBe("40px");
  });

  it("colours the picture from the swatches or the colour picker", async () => {
    const user = await openPlaceholder();
    const swatches = within(screen.getByRole("group", { name: "Placeholder colour" })).getAllByRole("button");
    expect(swatches).toHaveLength(8);
    expect(swatches[0].getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "#ffd8a8" }));
    expect(svgOf(picture())).toBe(placeholderSvg(1200, 900, "#ffd8a8"));
    expect(screen.getByRole("button", { name: "#ffd8a8" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "#e7e9ef" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: /^Placeholder colour: #ffd8a8/ }));
    const dialog = await screen.findByRole("dialog", { name: "Placeholder colour" });
    const hex = within(dialog).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "336699");
    expect(svgOf(picture()).toLowerCase()).toContain('fill="#336699"');
  });

  describe("adding it to the design", () => {
    it("puts a frame on the page that a photo can later replace", async () => {
      const user = await openPlaceholder();
      const before = pageElements().length;
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      const el = lastElement() as ImageElement;
      expect(pageElements()).toHaveLength(before + 1);
      expect(el.type).toBe("image");
      expect(el.isFrame).toBe(true);
      expect(el.name).toBe("Placeholder image");
      expect([el.naturalWidth, el.naturalHeight]).toEqual([1200, 900]);
      // half the page's shorter side along the longer edge of the picture
      expect(el.width).toBe(360);
      expect(el.height).toBe(270);
      expect(el.src).toBe(picture().getAttribute("src"));
      expect(useEditor.getState().selection).toEqual([el.id]);
    });

    it("keeps the chosen shape and colour", async () => {
      const user = await openPlaceholder();
      await user.click(shape("9 : 16"));
      await user.click(screen.getByRole("button", { name: "#d3f9d8" }));
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      const el = lastElement() as ImageElement;
      expect([el.naturalWidth, el.naturalHeight]).toEqual([720, 1280]);
      expect(el.height).toBe(360);
      expect(el.width).toBe(Math.round(720 * (360 / 1280)));
      expect(decodeURIComponent(el.src!)).toContain('fill="#d3f9d8"');
    });

    it("has nowhere to put it once the design is closed", async () => {
      const user = await openPlaceholder();
      act(() => useEditor.getState().actions.closeDesign());
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      expect(useEditor.getState().design).toBeNull();
    });
  });
});
