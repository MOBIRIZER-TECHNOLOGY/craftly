import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Tabs, type TabItem, type TabsProps } from "./Tabs";

const TABS: TabItem[] = [
  { id: "all", label: "All" },
  { id: "designs", label: "Designs", icon: <svg data-testid="designs-icon" /> },
  { id: "off", label: "Off", disabled: true },
  { id: "images", label: "Images" },
];

function TabsDemo({ initial = "all", onChange, tabs = TABS, ...props }: Partial<Omit<TabsProps, "value" | "onChange">> & { initial?: string; onChange?: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      aria-label="Project content"
      {...props}
      tabs={tabs}
      value={value}
      onChange={(id) => {
        onChange?.(id);
        setValue(id);
      }}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const selectedTab = () => screen.getAllByRole("tab").find((el) => el.getAttribute("aria-selected") === "true")?.textContent;

describe("<Tabs>", () => {
  it("is a tablist with the selected tab marked and the others out of the tab order", () => {
    render(<TabsDemo initial="designs" />);
    expect(screen.getByRole("tablist", { name: "Project content" }).getAttribute("aria-orientation")).toBe("horizontal");
    expect(selectedTab()).toBe("Designs");
    expect(tab("Designs").tabIndex).toBe(0);
    expect(tab("All").tabIndex).toBe(-1);
    expect((tab("Off") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an icon next to the label", () => {
    render(<TabsDemo />);
    expect(tab("Designs").querySelector("[data-testid='designs-icon']")).toBeTruthy();
    expect(tab("All").querySelector(".cf-tabs__icon")).toBeNull();
  });

  it("reports a clicked tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabsDemo onChange={onChange} />);
    await user.click(tab("Images"));
    expect(onChange).toHaveBeenCalledWith("images");
    expect(selectedTab()).toBe("Images");
  });

  it("does not select a disabled tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TabsDemo onChange={onChange} />);
    await user.click(tab("Off"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ties tabs to their panels when given an idBase", () => {
    render(<TabsDemo idBase="proj" />);
    expect(tab("Designs").id).toBe("proj-tab-designs");
    expect(tab("Designs").getAttribute("aria-controls")).toBe("proj-panel-designs");
  });

  it("has no ids without an idBase", () => {
    render(<TabsDemo />);
    expect(tab("All").id).toBe("");
    expect(tab("All").getAttribute("aria-controls")).toBeNull();
  });

  it("takes its look from the variant and width props", () => {
    render(<TabsDemo variant="pill" fullWidth className="extra" />);
    const list = screen.getByRole("tablist");
    expect(list.classList.contains("cf-tabs--pill")).toBe(true);
    expect(list.classList.contains("cf-tabs--full")).toBe(true);
    expect(list.classList.contains("extra")).toBe(true);
  });

  describe("keyboard", () => {
    it("selects the next enabled tab with ArrowRight and moves focus with it", async () => {
      const user = userEvent.setup();
      render(<TabsDemo />);
      tab("All").focus();
      await user.keyboard("{ArrowRight}");
      expect(selectedTab()).toBe("Designs");
      await waitFor(() => expect(document.activeElement).toBe(tab("Designs")));
      await user.keyboard("{ArrowRight}");
      expect(selectedTab()).toBe("Images");
      await waitFor(() => expect(document.activeElement).toBe(tab("Images")));
    });

    it("wraps around at both ends", async () => {
      const user = userEvent.setup();
      render(<TabsDemo initial="images" />);
      tab("Images").focus();
      await user.keyboard("{ArrowRight}");
      expect(selectedTab()).toBe("All");
      await user.keyboard("{ArrowLeft}");
      expect(selectedTab()).toBe("Images");
    });

    it("goes back with ArrowLeft, skipping disabled tabs", async () => {
      const user = userEvent.setup();
      render(<TabsDemo initial="images" />);
      tab("Images").focus();
      await user.keyboard("{ArrowLeft}");
      expect(selectedTab()).toBe("Designs");
    });

    it("jumps to the first and last enabled tab with Home and End", async () => {
      const user = userEvent.setup();
      render(<TabsDemo initial="designs" />);
      tab("Designs").focus();
      await user.keyboard("{End}");
      expect(selectedTab()).toBe("Images");
      await user.keyboard("{Home}");
      expect(selectedTab()).toBe("All");
    });

    it("ignores other keys", () => {
      const onChange = vi.fn();
      render(<TabsDemo onChange={onChange} />);
      expect(fireEvent.keyDown(tab("All"), { key: "a" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does nothing when every tab is disabled", () => {
      const onChange = vi.fn();
      render(<TabsDemo onChange={onChange} tabs={[{ id: "a", label: "A", disabled: true }]} initial="a" />);
      expect(fireEvent.keyDown(screen.getByRole("tab", { name: "A" }), { key: "ArrowRight" })).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
