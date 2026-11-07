import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createPage, createText, solid } from "@/core/factory";
import type { Template } from "@/core/types";
import { DESIGN_TYPES, describeSize, getDesignType } from "@/data/designTypes";
import { IconStar } from "@/ui";
import { CategoryTile } from "./CategoryTile";
import { genericDesignIcon, designIcon, typeIcon } from "./designIcons";
import { DesignMock, mockForDesign, mockForType } from "./DesignMock";
import { CustomSizeTile, DesignTypeTile } from "./DesignTypeTile";

const type = (id: string) => getDesignType(id) as NonNullable<ReturnType<typeof getDesignType>>;
const cssVar = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

describe("designIcon / typeIcon", () => {
  it("gives every design type of the catalogue its own icon, not the generic fallback", () => {
    const missing = DESIGN_TYPES.filter((item) => designIcon(item.icon) === genericDesignIcon).map((item) => `${item.id} (${item.icon})`);
    expect(missing).toEqual([]);
  });

  it("falls back to the generic icon for a name it does not know", () => {
    expect(designIcon("NoSuchIcon")).toBe(genericDesignIcon);
    expect(designIcon("")).toBe(genericDesignIcon);
  });

  it("maps the social networks to neutral glyphs that differ from each other", () => {
    const glyphs = new Set(["Instagram", "Facebook", "Youtube", "Linkedin", "Twitter"].map((name) => designIcon(name)));
    expect(glyphs.size).toBe(5);
  });

  it("reads the icon name of a design type", () => {
    expect(typeIcon(type("presentation"))).toBe(designIcon("Presentation"));
    expect(typeIcon({ icon: "Nope" })).toBe(genericDesignIcon);
  });

  it("draws its icons as svg", () => {
    const Icon = designIcon("Presentation");
    const { container } = render(<Icon />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("mockForType / mockForDesign", () => {
  it("describe a design type by its size, colour and icon", () => {
    const presentation = type("presentation");
    expect(mockForType(presentation)).toEqual({ width: 1920, height: 1080, color: presentation.color, icon: designIcon("Presentation") });
  });

  it("describe a saved design by its own size and the colour of its type", () => {
    const spec = mockForDesign({ typeId: "instagram-post", width: 500, height: 600 });
    expect(spec).toEqual({ width: 500, height: 600, color: type("instagram-post").color, icon: typeIcon(type("instagram-post")) });
  });

  it("give a design of unknown type a neutral purple page of the same shape", () => {
    expect(mockForDesign({ typeId: "custom", width: 300, height: 200 })).toEqual({ width: 300, height: 200, color: "var(--c-primary)", icon: genericDesignIcon });
  });
});

describe("<DesignMock>", () => {
  const spec = (width: number, height: number) => ({ width, height, color: "#ff8800", icon: IconStar });

  it("is a decorative page in the accent colour with the shape of the design", () => {
    const { container } = render(<DesignMock spec={spec(1920, 1080)} height={128} className="extra" />);
    const mock = container.querySelector(".cf-mock") as HTMLElement;
    expect(mock.getAttribute("aria-hidden")).toBe("true");
    expect(cssVar(mock, "--cf-mock-color")).toBe("#ff8800");
    expect(cssVar(mock, "--cf-mock-ratio")).toBe("1.7778");
    expect(cssVar(mock, "--cf-mock-aspect")).toBe("1920 / 1080");
    expect(cssVar(mock, "--cf-mock-h")).toBe("128px");
    expect(mock.classList.contains("extra")).toBe(true);
    expect(mock.querySelector(".cf-mock__page svg")).toBeTruthy();
  });

  it("does not set a stage height unless asked", () => {
    const { container } = render(<DesignMock spec={spec(100, 100)} />);
    expect(cssVar(container.querySelector(".cf-mock") as HTMLElement, "--cf-mock-h")).toBe("");
  });

  it("marks very wide pages", () => {
    const { container, rerender } = render(<DesignMock spec={spec(2000, 500)} />);
    expect(container.querySelector(".cf-mock")?.classList.contains("cf-mock--wide")).toBe(true);
    rerender(<DesignMock spec={spec(2200, 1000)} />);
    expect(container.querySelector(".cf-mock")?.classList.contains("cf-mock--wide")).toBe(false);
  });

  it("is square when the size is not usable", () => {
    const { container } = render(<DesignMock spec={spec(0, 0)} />);
    expect(cssVar(container.querySelector(".cf-mock") as HTMLElement, "--cf-mock-ratio")).toBe("1.0000");
  });
});

describe("<DesignTypeTile>", () => {
  it("is a button named after the type and its size, showing both", () => {
    const poster = type("poster");
    render(<DesignTypeTile type={poster} onClick={() => undefined} />);
    const size = describeSize(poster.width, poster.height, poster.unit);
    const tile = screen.getByRole("button", { name: `${poster.name}, ${size}` });
    expect(tile.textContent).toContain(poster.name);
    expect(tile.textContent).toContain(size);
    expect(size).toBe("18 × 24 in");
  });

  it("creates the design when pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<DesignTypeTile type={type("logo")} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /^Logo,/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("takes its size and class from the props", () => {
    render(<DesignTypeTile type={type("logo")} onClick={() => undefined} size="lg" className="extra" />);
    const tile = screen.getByRole("button");
    expect(tile.classList.contains("cf-tile--lg")).toBe(true);
    expect(tile.classList.contains("extra")).toBe(true);
    expect(cssVar(tile.querySelector(".cf-mock") as HTMLElement, "--cf-mock-h")).toBe("148px");
  });

  it("uses a stage of 124 px at the default size and 96 px when small", () => {
    const { rerender } = render(<DesignTypeTile type={type("logo")} onClick={() => undefined} />);
    expect(cssVar(screen.getByRole("button").querySelector(".cf-mock") as HTMLElement, "--cf-mock-h")).toBe("124px");
    rerender(<DesignTypeTile type={type("logo")} onClick={() => undefined} size="sm" />);
    expect(cssVar(screen.getByRole("button").querySelector(".cf-mock") as HTMLElement, "--cf-mock-h")).toBe("96px");
  });
});

describe("<CustomSizeTile>", () => {
  it("offers a custom size typed into a search box", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CustomSizeTile width={1200} height={628} onClick={onClick} spec={{ width: 1200, height: 628, color: "#123456", icon: IconStar }} size="sm" />);
    const tile = screen.getByRole("button", { name: "Custom size, 1200 × 628 px" });
    expect(tile.textContent).toContain("Custom size");
    expect(tile.textContent).toContain("1200 × 628 px");
    expect(tile.classList.contains("cf-tile--sm")).toBe(true);
    await user.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to the medium tile", () => {
    render(<CustomSizeTile width={500} height={500} onClick={() => undefined} spec={{ width: 500, height: 500, color: "#000", icon: IconStar }} />);
    expect(screen.getByRole("button").classList.contains("cf-tile--md")).toBe(true);
  });
});

describe("<CategoryTile>", () => {
  const example: Template = {
    id: "t-1",
    name: "Sunny",
    category: "social",
    typeId: "instagram-post",
    width: 1080,
    height: 1350,
    tags: [],
    accent: "#ff8800",
    pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Hi" })] })],
  };

  it("is a link to the category with its name and template count", () => {
    render(<CategoryTile category="social" label="Social media" count={12} example={example} />);
    const link = screen.getByRole("link", { name: "Social media, 12 templates" });
    expect(link.getAttribute("href")).toBe("#/templates/social");
    expect(link.textContent).toContain("Social media");
    expect(link.textContent).toContain("12 templates");
  });

  it("says 'template' for a single one", () => {
    render(<CategoryTile category="logo" label="Logos" count={1} example={example} />);
    expect(screen.getByRole("link", { name: "Logos, 1 template" })).toBeTruthy();
  });

  it("shows the example template on its accent colour, sized to its shape", () => {
    const { container } = render(<CategoryTile category="social" label="Social media" count={3} example={example} />);
    const stage = container.querySelector(".cf-ctile__stage") as HTMLElement;
    expect(cssVar(stage, "--cf-accent")).toBe("#ff8800");
    const thumb = container.querySelector(".cf-ctile__thumb") as HTMLElement;
    expect(thumb.style.width).toBe("72px");
    expect(thumb.querySelector("canvas")).toBeTruthy();
  });

  it("keeps the picture between 52 and 176 pixels wide", () => {
    const wide = { ...example, width: 4000, height: 500 };
    const narrow = { ...example, width: 100, height: 1000 };
    const { container, rerender } = render(<CategoryTile category="social" label="L" count={1} example={wide} />);
    expect((container.querySelector(".cf-ctile__thumb") as HTMLElement).style.width).toBe("176px");
    rerender(<CategoryTile category="social" label="L" count={1} example={narrow} />);
    expect((container.querySelector(".cf-ctile__thumb") as HTMLElement).style.width).toBe("52px");
  });
});
