/** Which keys pressed on the editor's controls still reach the canvas shortcuts as letters (barLetters.ts). */
import { afterEach, describe, expect, it } from "vitest";
import { isBarLetter } from "./barLetters";

afterEach(() => document.body.replaceChildren());

/** A key event as it arrives at `target`. */
function press(target: EventTarget | null, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
}

/** A button inside `bar` (a class or a role), and the bar in the page. */
function buttonIn(bar: { className?: string; role?: string }, attrs: Record<string, string> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  if (bar.className) host.className = bar.className;
  if (bar.role) host.setAttribute("role", bar.role);
  const button = host.appendChild(document.createElement("button"));
  for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
  const label = button.appendChild(document.createElement("span"));
  return { button, label };
}

describe("isBarLetter", () => {
  it("lets a plain letter through from a button of the top bar, the bottom bar or a toolbar, in either case", () => {
    expect(isBarLetter(press(buttonIn({ className: "cf-topbar" }).button, "t"))).toBe(true);
    expect(isBarLetter(press(buttonIn({ className: "cf-bottombar" }).button, "M"))).toBe(true);
    // the label inside the button counts as the button
    expect(isBarLetter(press(buttonIn({ role: "toolbar" }).label, "r", { shiftKey: true }))).toBe(true);
  });

  it("keeps every other key on the button: arrows, Enter, Space, digits and signs", () => {
    const { button } = buttonIn({ className: "cf-topbar" });
    for (const key of ["ArrowRight", "Enter", " ", "Tab", "Delete", "1", "?", "é"]) expect(isBarLetter(press(button, key))).toBe(false);
  });

  it("leaves letters with Ctrl, Cmd or Alt to the shortcuts that pass anyway", () => {
    const { button } = buttonIn({ className: "cf-topbar" });
    expect(isBarLetter(press(button, "z", { ctrlKey: true }))).toBe(false);
    expect(isBarLetter(press(button, "z", { metaKey: true }))).toBe(false);
    expect(isBarLetter(press(button, "l", { altKey: true }))).toBe(false);
  });

  it("keeps the letters on a control that jumps to an item by its first letter", () => {
    expect(isBarLetter(press(buttonIn({ className: "cf-topbar" }, { "aria-haspopup": "listbox" }).button, "r"))).toBe(false);
    expect(isBarLetter(press(buttonIn({ role: "toolbar" }, { role: "combobox" }).button, "r"))).toBe(false);
  });

  it("keeps the letters off anything that is not a button of the bars", () => {
    // a button of the side panel goes on through the panel
    expect(isBarLetter(press(buttonIn({ className: "cf-sidepanel" }).button, "t"))).toBe(false);
    // a field or a plain element of a bar
    const bar = document.body.appendChild(document.createElement("div"));
    bar.className = "cf-topbar";
    expect(isBarLetter(press(bar.appendChild(document.createElement("input")), "t"))).toBe(false);
    expect(isBarLetter(press(bar, "t"))).toBe(false);
    // keys that come from no element at all
    expect(isBarLetter(press(window, "t"))).toBe(false);
    expect(isBarLetter(press(null, "t"))).toBe(false);
  });
});
