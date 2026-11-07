import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";
import * as kit from "./index";

const iconEntries = Object.entries(icons).filter(([name]) => /^Icon[A-Z]/.test(name));

describe("icons", () => {
  it("names a good number of semantic icons", () => {
    expect(iconEntries.length).toBeGreaterThan(200);
  });

  it("resolves every semantic icon name to a component that draws an svg", () => {
    const broken: string[] = [];
    for (const [name, Icon] of iconEntries) {
      if (Icon === undefined || Icon === null) {
        broken.push(`${name} is not exported by lucide-react`);
        continue;
      }
      const Component = Icon as unknown as React.ComponentType<{ className?: string }>;
      const { container, unmount } = render(<Component className={name} />);
      if (!container.querySelector(`svg.${name}`)) broken.push(`${name} did not render an svg`);
      unmount();
    }
    expect(broken).toEqual([]);
  });

  it("exports the brand mark and the rotate-handle glyph next to the icons", () => {
    expect(typeof icons.BrandMark).toBe("function");
    expect(typeof icons.RotateHandleIcon).toBe("function");
  });
});

describe("the UI kit entry point", () => {
  it("exports the components, hosts and helpers the app imports from @/ui", () => {
    const expected = [
      "Button",
      "IconButton",
      "Tooltip",
      "Popover",
      "Menu",
      "MenuList",
      "MenuPopover",
      "ContextMenuHost",
      "openContextMenu",
      "closeContextMenu",
      "Modal",
      "ConfirmHost",
      "confirm",
      "ToastHost",
      "toast",
      "Tabs",
      "Segmented",
      "Slider",
      "sliderRatioToValue",
      "sliderValueToRatio",
      "NumberField",
      "TextField",
      "SearchField",
      "Switch",
      "Checkbox",
      "Select",
      "ColorSwatch",
      "ColorPicker",
      "Spinner",
      "Skeleton",
      "Avatar",
      "Badge",
      "Kbd",
      "Divider",
      "EmptyState",
      "focusElement",
      "getTabbables",
      "isKeyboardModality",
      "mergeRefs",
      "trapTab",
      "useEscape",
      "useLatest",
      "useMedia",
      "useMergedRefs",
      "useOutsideClick",
      "usePresence",
      "useResizeObserver",
      "useScrollLock",
      "OVERLAY_ROOT_ID",
      "getOverlayRoot",
      "ariaShortcut",
      "formatShortcut",
      "isMacPlatform",
      "shortcutKeys",
      "cx",
      "IconHome",
      "BrandMark",
    ];
    const missing = expected.filter((name) => (kit as Record<string, unknown>)[name] === undefined);
    expect(missing).toEqual([]);
  });
});
