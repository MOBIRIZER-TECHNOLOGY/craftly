import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createLine, createShape, createText } from "@/core/factory";
import type { ShapeElement } from "@/core/types";
import { live, openElements, typeNumber } from "@/test/ctxUtils";
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
