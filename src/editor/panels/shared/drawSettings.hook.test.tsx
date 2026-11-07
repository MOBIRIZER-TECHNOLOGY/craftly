import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setDrawSettings, useDrawSettings } from "./drawSettings";

afterEach(() => setDrawSettings({ color: "#0e1318", width: null }));

function Pen() {
  const { color, width } = useDrawSettings();
  return (
    <p>
      pen {color} {width === null ? "auto" : width}
    </p>
  );
}

describe("useDrawSettings", () => {
  it("shows the pen settings and follows every change", () => {
    render(<Pen />);
    expect(screen.getByText("pen #0e1318 auto")).toBeTruthy();
    act(() => setDrawSettings({ color: "#e5484d" }));
    expect(screen.getByText("pen #e5484d auto")).toBeTruthy();
    act(() => setDrawSettings({ width: 12 }));
    expect(screen.getByText("pen #e5484d 12")).toBeTruthy();
  });

  it("stops listening when the component goes away", () => {
    const { unmount } = render(<Pen />);
    unmount();
    expect(() => act(() => setDrawSettings({ color: "#ffffff" }))).not.toThrow();
  });

  it("gives a page rendered on the server the settings as they are", () => {
    setDrawSettings({ color: "#16a34a", width: 7 });
    // React separates adjacent text with comment markers
    expect(renderToString(<Pen />).replaceAll("<!-- -->", "")).toBe("<p>pen #16a34a 7</p>");
  });
});
