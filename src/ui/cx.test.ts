import { describe, expect, it } from "vitest";
import { cx } from "./cx";

describe("cx", () => {
  it("joins the class names with single spaces", () => {
    expect(cx("a", "b", "c")).toBe("a b c");
  });

  it("skips false, null, undefined and empty entries", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("returns an empty string when nothing is left", () => {
    expect(cx()).toBe("");
    expect(cx(false, null, undefined)).toBe("");
  });

  it("keeps a conditional class only while its condition holds", () => {
    const active = true as boolean;
    const disabled = false as boolean;
    expect(cx("btn", active && "is-active", disabled && "is-disabled")).toBe("btn is-active");
  });
});
