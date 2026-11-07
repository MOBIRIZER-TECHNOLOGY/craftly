import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppField, AppPage, ColorButton, useAppsNav } from "./appKit";

beforeEach(() => useAppsNav.setState({ app: null, query: "" }));

describe("the apps navigation", () => {
  it("remembers which app is open and goes back to the list", () => {
    const nav = useAppsNav.getState();
    nav.open("emoji");
    expect(useAppsNav.getState().app).toBe("emoji");
    nav.back();
    expect(useAppsNav.getState().app).toBeNull();
  });

  it("keeps the list's search apart from the open app", () => {
    useAppsNav.getState().setQuery("qr");
    useAppsNav.getState().open("qr");
    useAppsNav.getState().back();
    expect(useAppsNav.getState().query).toBe("qr");
  });
});

describe("<AppPage>", () => {
  it("frames an app with a header, a scrolling body and a pinned footer", () => {
    const { container } = render(
      <AppPage title="Emoji" subtitle="Click one" top={<input aria-label="Search" />} footer={<button type="button">Add to design</button>} scrollClassName="mine">
        <p>body</p>
      </AppPage>,
    );
    expect(screen.getByRole("heading", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByText("Click one")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy();
    expect(container.querySelector(".cf-panel__scroll.mine")?.textContent).toBe("body");
    expect(container.querySelector(".cf-app__footer")?.textContent).toBe("Add to design");
  });

  it("has no footer unless one is given", () => {
    const { container } = render(
      <AppPage title="Lorem ipsum">
        <p>body</p>
      </AppPage>,
    );
    expect(container.querySelector(".cf-app__footer")).toBeNull();
  });

  it("goes back to the list of apps with its arrow", async () => {
    const user = userEvent.setup();
    useAppsNav.getState().open("lorem");
    render(
      <AppPage title="Lorem ipsum">
        <p>body</p>
      </AppPage>,
    );
    await user.click(screen.getByRole("button", { name: "Back to apps" }));
    expect(useAppsNav.getState().app).toBeNull();
  });
});

describe("<AppField>", () => {
  it("labels a group of controls and can explain it", () => {
    const { container } = render(
      <AppField label="Size" hint="In pixels" className="mine">
        <input aria-label="Width" />
      </AppField>,
    );
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.getByText("In pixels")).toBeTruthy();
    expect(container.querySelector(".cf-app__field.mine")).toBeTruthy();
  });

  it("leaves out the hint when there is none", () => {
    const { container } = render(
      <AppField label="Size">
        <input aria-label="Width" />
      </AppField>,
    );
    expect(container.querySelector(".cf-app__hint")).toBeNull();
  });
});

describe("<ColorButton>", () => {
  function Harness({ presets }: { presets?: string[] }) {
    const [value, setValue] = useState("#7c3aed");
    return (
      <>
        <ColorButton label="Square colour" value={value} onChange={setValue} presets={presets} />
        <output>{value}</output>
      </>
    );
  }

  it("shows the colour and its code on a button that names them", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Square colour: #7c3aed. Change colour" });
    expect(button.textContent).toBe("#7C3AED");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a picker with quick colours, the current one marked", async () => {
    const user = userEvent.setup();
    render(<Harness presets={["#7C3AED", "#ffffff", "#000000"]} />);
    await user.click(screen.getByRole("button", { name: /Square colour/ }));
    const dialog = await screen.findByRole("dialog", { name: "Square colour" });
    const quick = within(within(dialog).getByRole("group", { name: "Quick colours" })).getAllByRole("button");
    expect(quick.map((b) => b.getAttribute("aria-label"))).toEqual(["#7C3AED", "#ffffff", "#000000"]);
    // the comparison ignores case
    expect(quick.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(screen.getByRole("button", { name: /Square colour/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("changes the colour with a quick colour or with the picker", async () => {
    const user = userEvent.setup();
    render(<Harness presets={["#ffffff"]} />);
    await user.click(screen.getByRole("button", { name: /Square colour/ }));
    const dialog = await screen.findByRole("dialog", { name: "Square colour" });
    await user.click(within(dialog).getByRole("button", { name: "#ffffff" }));
    expect(screen.getByRole("status").textContent).toBe("#ffffff");
    const hex = within(dialog).getByRole("textbox", { name: "Hex colour" });
    await user.clear(hex);
    await user.type(hex, "336699");
    expect(screen.getByRole("status").textContent?.toLowerCase()).toBe("#336699");
    expect(screen.getByRole("button", { name: /Square colour/ }).textContent?.toLowerCase()).toBe("#336699");
  });

  it("has no quick colours unless it is given some", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Square colour/ }));
    const dialog = await screen.findByRole("dialog", { name: "Square colour" });
    expect(within(dialog).queryByRole("group", { name: "Quick colours" })).toBeNull();
    const none = render(<Harness presets={[]} />);
    await user.click(within(none.container).getByRole("button", { name: /Square colour/ }));
    expect(screen.queryAllByRole("group", { name: "Quick colours" })).toHaveLength(0);
  });

  it("closes with Escape and toggles with a second click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorButton label="Background" value="#ffffff" onChange={onChange} />);
    const button = screen.getByRole("button", { name: /Background/ });
    await user.click(button);
    await screen.findByRole("dialog", { name: "Background" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Background" })).toBeNull();
    await user.click(button);
    await screen.findByRole("dialog", { name: "Background" });
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: "Background" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
