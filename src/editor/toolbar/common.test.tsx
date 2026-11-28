import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { BLEND_MODES, blendLabel } from "@/core/blend";
import { createLine, createShape, createText } from "@/core/factory";
import type { DesignElement, LineElement, ShapeElement } from "@/core/types";
import { live, openElements, store, typeNumber } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { BorderPopover, FillButton, RadiusPopover, Swatch, TransparencyButton, capFor } from "./common";
import { LineBar } from "./bars/ShapeBar";

beforeEach(() => resetEditor());

const swatchOf = (el: Element) => (el.querySelector(".cf-tb__swatch") as HTMLElement).style.getPropertyValue("--cf-sw");

describe("<Swatch>", () => {
  it("is a colour chip drawn from any CSS background, in round, large and square forms", () => {
    const { container } = render(
      <>
        <Swatch css="#ff0000" />
        <Swatch css="linear-gradient(red, blue)" large />
        <Swatch css="#00ff00" square />
      </>,
    );
    const [plain, large, square] = Array.from(container.querySelectorAll<HTMLElement>(".cf-tb__swatch"));
    expect(plain.style.getPropertyValue("--cf-sw")).toBe("#ff0000");
    expect(plain.className).toBe("cf-tb__swatch");
    expect(large.classList.contains("cf-tb__swatch--lg")).toBe(true);
    expect(large.style.getPropertyValue("--cf-sw")).toBe("linear-gradient(red, blue)");
    expect(square.classList.contains("cf-tb__swatch--square")).toBe(true);
  });
});

describe("capFor", () => {
  it("gives each stroke style the end caps that make it look right", () => {
    expect(capFor("dotted", false)).toBe("round");
    expect(capFor("dotted", true)).toBe("round");
    expect(capFor("dashed", false)).toBe("butt");
    expect(capFor("dashed", true)).toBe("butt");
    expect(capFor("solid", true)).toBe("round");
    expect(capFor("solid", false)).toBeUndefined();
  });
});

describe("controls with nothing to read from", () => {
  it("show neutral defaults for an empty selection", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")], { selected: [] });
    render(
      <>
        <TransparencyButton els={[]} ids={[]} />
        <BorderPopover els={[]} ids={[]} />
        <RadiusPopover els={[]} ids={[]} />
        <FillButton els={[]} />
      </>,
    );
    // no fill: the crossed-out swatch
    expect(swatchOf(screen.getByRole("button", { name: "Fill color" }))).toContain("var(--c-danger)");

    await user.click(screen.getByRole("button", { name: "Transparency" }));
    expect(screen.getByRole("slider", { name: "Transparency" }).getAttribute("aria-valuenow")).toBe("100");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Border" }));
    const dialog = screen.getByRole("dialog", { name: "Border" });
    expect(within(dialog).getByRole("radio", { name: "No border" }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByRole("slider", { name: "Border weight" }).getAttribute("aria-valuenow")).toBe("0");
    expect(swatchOf(within(dialog).getByRole("button", { name: "Color" }))).toBe("#0e1318");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Corner radius" }));
    expect(screen.getByRole("slider", { name: "Corner radius" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("do not touch elements the control is not about", async () => {
    const user = userEvent.setup();
    const text = createText({ text: "not a shape", x: 0, y: 0 });
    openElements([text], { selected: [text] });
    const standIn = createShape("rect", { width: 100, height: 100 });
    render(
      <>
        <BorderPopover els={[standIn]} ids={[text.id]} />
        <RadiusPopover els={[standIn]} ids={[text.id]} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Border" }));
    await user.click(screen.getByRole("radio", { name: "Dashed" }));
    await typeNumber(user, screen.getByRole("spinbutton", { name: "Border weight value" }), "6");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Corner radius" }));
    await typeNumber(user, screen.getByRole("spinbutton", { name: "Corner radius value" }), "20");
    expect(live(text)).not.toHaveProperty("stroke");
    expect(live(text)).not.toHaveProperty("radius");
  });

  it("make a border at a sensible default size for any design size", async () => {
    const user = userEvent.setup();
    const big = createShape("rect", { width: 400, height: 400 });
    openElements([big], { selected: [big], width: 3000, height: 2000 });
    render(<BorderPopover els={[big]} ids={[big.id]} />);
    await user.click(screen.getByRole("button", { name: "Border" }));
    await user.click(screen.getByRole("radio", { name: "Solid" }));
    // 0.4% of the shorter side of the design
    expect(live<ShapeElement>(big).stroke?.width).toBe(8);
  });
});

describe("the line bar with nothing selected", () => {
  it("shows the defaults of a line", () => {
    openElements([createLine()], { selected: [] });
    render(<LineBar els={[]} ids={[]} copyEnabled={false} />);
    expect(swatchOf(screen.getByRole("button", { name: "Line color" }))).toBe("var(--c-ink)");
    expect(screen.getByRole("button", { name: "Line style" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start arrowhead" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End arrowhead" })).toBeTruthy();
  });

  it("starts the weight at 1 and a width the slider can hold", async () => {
    const user = userEvent.setup();
    openElements([createLine()], { selected: [] });
    render(<LineBar els={[]} ids={[]} copyEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Line weight" }));
    expect(screen.getByRole("slider", { name: "Weight" }).getAttribute("aria-valuenow")).toBe("1");
  });
});

describe("connector route and label controls", () => {
  it("changes the route and edits the label of the selected line", async () => {
    const line = createLine({ id: "line", x: 100, y: 100, width: 200 });
    openElements([line], { selected: [line] });
    render(<LineBar els={[line]} ids={[line.id]} copyEnabled={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Connector route" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Elbow" }));
    expect(live<LineElement>(line).routing).toBe("elbow");
    expect(live<LineElement>(line).route).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Line label" }));
    await user.click(screen.getByRole("textbox", { name: "Line label" }));
    await user.paste("Next");
    expect(live<LineElement>(line).label).toBe("Next");
  });
});

describe("<TransparencyButton>: the blend mode", () => {
  const openPopover = async (user: ReturnType<typeof userEvent.setup>, elements: DesignElement[]) => {
    openElements(elements, { selected: elements });
    render(<TransparencyButton els={elements.map((el) => live(el))} ids={elements.map((el) => el.id)} />);
    await user.click(screen.getByRole("button", { name: "Transparency" }));
    return screen.getByRole("dialog", { name: "Transparency" });
  };
  const box = (dialog: HTMLElement) => within(dialog).getByRole("combobox", { name: "Blend mode" });
  const choose = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string) => {
    await user.click(box(dialog));
    await user.click(screen.getByRole("option", { name }));
  };

  it("sits under the transparency, says Normal for an element with no mode and lists Normal and the fifteen modes in order", async () => {
    const user = userEvent.setup();
    const dialog = await openPopover(user, [createShape("rect")]);
    expect(box(dialog).textContent).toContain("Normal");
    expect(within(dialog).getByText("Blend mode")).toBeTruthy();
    await user.click(box(dialog));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Normal", ...BLEND_MODES.map((mode) => blendLabel(mode))]);
  });

  it("says in its tooltip that the button holds the blend mode too", async () => {
    const user = userEvent.setup();
    openElements([createShape("rect")], { selected: [] });
    render(<TransparencyButton els={[]} ids={[]} />);
    await user.hover(screen.getByRole("button", { name: "Transparency" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain("Transparency and blend mode");
  });

  it("shows the mode that an element has", async () => {
    const user = userEvent.setup();
    const dialog = await openPopover(user, [createShape("rect", { blend: "color-burn" })]);
    expect(box(dialog).textContent).toContain("Color burn");
  });

  it("gives the chosen mode to every selected element, as one step that undo takes back", async () => {
    const user = userEvent.setup();
    const a = createShape("rect");
    const b = createShape("ellipse", { blend: "screen" });
    const dialog = await openPopover(user, [a, b]);
    await choose(user, dialog, "Multiply");
    expect(live(a).blend).toBe("multiply");
    expect(live(b).blend).toBe("multiply");
    act(() => store().actions.undo());
    expect(live(a)).not.toHaveProperty("blend");
    expect(live(b).blend).toBe("screen");
  });

  it("says Mixed when the selected elements differ, and Normal takes the mode of every one of them away", async () => {
    const user = userEvent.setup();
    const a = createShape("rect", { blend: "multiply" });
    const b = createShape("rect");
    const dialog = await openPopover(user, [a, b]);
    expect(box(dialog).textContent).toContain("Mixed");
    await choose(user, dialog, "Normal");
    expect(live(a)).not.toHaveProperty("blend");
    expect(live(b)).not.toHaveProperty("blend");
  });

  it("does not change the transparency", async () => {
    const user = userEvent.setup();
    const a = createShape("rect", { opacity: 0.4 });
    const dialog = await openPopover(user, [a]);
    await choose(user, dialog, "Overlay");
    expect(live(a).opacity).toBe(0.4);
    expect(within(dialog).getByRole("slider", { name: "Transparency" }).getAttribute("aria-valuenow")).toBe("40");
  });
});
