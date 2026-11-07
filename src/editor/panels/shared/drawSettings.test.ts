import { afterEach, describe, expect, it, vi } from "vitest";
import { autoDrawWidth, drawSettings, getDrawStroke, setDrawSettings, subscribeDrawSettings } from "./drawSettings";

afterEach(() => setDrawSettings({ color: "#0e1318", width: null }));

describe("pen settings", () => {
  it("start with a near-black pen of automatic width", () => {
    expect(drawSettings).toEqual({ color: "#0e1318", width: null });
  });

  it("make the automatic width a little under half a percent of the page width, never thinner than 4", () => {
    expect(autoDrawWidth(1920)).toBe(8);
    expect(autoDrawWidth(1080)).toBe(4);
    expect(autoDrawWidth(200)).toBe(4);
    expect(autoDrawWidth(5000)).toBe(20);
  });

  it("give the controller the pen's colour and the automatic width until one is picked", () => {
    expect(getDrawStroke(1920)).toEqual({ color: "#0e1318", width: 8 });
    setDrawSettings({ color: "#e5484d" });
    expect(getDrawStroke(1920)).toEqual({ color: "#e5484d", width: 8 });
    setDrawSettings({ width: 17 });
    expect(getDrawStroke(1920)).toEqual({ color: "#e5484d", width: 17 });
    setDrawSettings({ width: null });
    expect(getDrawStroke(3000)).toEqual({ color: "#e5484d", width: 12 });
  });

  it("change one setting without touching the other", () => {
    setDrawSettings({ width: 9 });
    expect(drawSettings).toEqual({ color: "#0e1318", width: 9 });
    setDrawSettings({ color: "#16a34a" });
    expect(drawSettings).toEqual({ color: "#16a34a", width: 9 });
  });

  it("tell subscribers about every change until they unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribeDrawSettings(listener);
    setDrawSettings({ color: "#3b82f6" });
    setDrawSettings({ width: 5 });
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    setDrawSettings({ width: 6 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
