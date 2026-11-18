/**
 * What a person sees of the others on the page (their pointers and what they have selected, each with a name and a colour), the
 * list of who is here in the top bar, and the field for this person's own name.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PresenceState } from "@/collab/presence";
import { createDesign, createGroup, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { LivePeople, NameField } from "./LivePeople";
import { clearPresence, colorOf, heardPresence, pointerNow, savedName, setPointer, usePresence } from "./presence";
import { PresenceOverlay } from "./PresenceOverlay";

const design = () =>
  createDesign({
    title: "Shared",
    width: 1000,
    height: 600,
    pages: [
      createPage({
        id: "p",
        elements: [
          createShape("rect", { id: "a", x: 100, y: 50, width: 200, height: 80, rotation: 30 }),
          createGroup([createShape("rect", { id: "inner", x: 10, y: 20, width: 50, height: 40 })], { id: "g", x: 400, y: 100, width: 300, height: 200 }),
        ],
      }),
      createPage({ id: "q", elements: [] }),
    ],
  });
const there = (peer: number, over: Partial<PresenceState> = {}) =>
  heardPresence({ t: "presence", peer, name: "Bo", page: "p", pointer: null, selection: [], editing: null, ...over }, Date.now());

const mount = () =>
  render(
    <div data-cf-workspace data-testid="workspace">
      <div className="cf-pageframe">
        <PresenceOverlay />
      </div>
    </div>,
  );
const overlay = () => document.querySelector<HTMLElement>(".cf-presence")!;

beforeEach(() => {
  localStorage.clear();
  resetEditor();
  useEditor.getState().actions.openDesign(design());
  useEditor.setState({ zoom: 0.5 });
  clearPresence();
  usePresence.setState({ name: "", me: 1 });
  setPointer(null);
});
afterEach(() => clearPresence());

describe("the others on the page", () => {
  it("are drawn in a layer that is not for the pointer, the keyboard or a screen reader: who is here is said in the top bar", () => {
    there(2, { pointer: { x: 10, y: 10 }, selection: ["a"] });
    mount();
    expect(overlay().getAttribute("aria-hidden")).toBe("true");
    expect(overlay().querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    expect(overlay().querySelector("[aria-live], [role=status], [role=alert]")).toBeNull();
  });

  it("have their pointer where it is on the page at the zoom of this person, in their colour and with their name", () => {
    there(2, { pointer: { x: 300, y: 120 } });
    mount();
    const pointer = overlay().querySelector<HTMLElement>(".cf-presence__pointer")!;
    expect(pointer.style.transform).toBe("translate(150px, 60px)");
    expect(pointer.style.color).toBe(hexToRgb(colorOf(2)));
    expect(within(pointer).getByText("Bo")).toBeTruthy();
  });

  it("have an outline around what they selected, turned as the element is, with their name on the first", () => {
    there(2, { selection: ["a", "inner", "not-on-this-page"] });
    mount();
    const outlines = [...overlay().querySelectorAll<HTMLElement>(".cf-presence__outline")];
    expect(outlines).toHaveLength(2);
    expect(outlines[0].style).toMatchObject({ left: "50px", top: "25px", width: "100px", height: "40px", transform: "rotate(30deg)" });
    expect(outlines[0].style.borderColor).toBe(hexToRgb(colorOf(2)));
    expect(within(outlines[0]).getByText("Bo")).toBeTruthy();
    // an element inside a group is outlined where it is on the page
    expect(outlines[1].style).toMatchObject({ left: "205px", top: "60px", width: "25px", height: "20px" });
    expect(outlines[1].textContent).toBe("");
  });

  it("are not drawn while they are on another page, and are when this person goes there", () => {
    there(2, { page: "q", pointer: { x: 5, y: 5 }, selection: ["a"] });
    mount();
    expect(overlay().children).toHaveLength(0);
    act(() => useEditor.getState().actions.setActivePage("q"));
    expect(overlay().querySelectorAll(".cf-presence__pointer")).toHaveLength(1);
    expect(overlay().querySelectorAll(".cf-presence__outline")).toHaveLength(0); // that element is not on this page
  });

  it("are not drawn while no design is open", () => {
    there(2, { pointer: { x: 5, y: 5 } });
    resetEditor();
    mount();
    expect(overlay().children).toHaveLength(0);
  });

  it("each keep their own colour and name", () => {
    there(2, { pointer: { x: 1, y: 1 } });
    there(3, { name: "", pointer: { x: 2, y: 2 } });
    mount();
    const pointers = [...overlay().querySelectorAll<HTMLElement>(".cf-presence__pointer")];
    expect(pointers.map((p) => p.textContent)).toEqual(["Bo", "Guest 3"]);
    expect(pointers[0].style.color).not.toBe(pointers[1].style.color);
  });

  it("have a name that is shown as the text it is, whatever is in it", () => {
    there(2, { name: "<img src=x onerror=alert(1)>", pointer: { x: 1, y: 1 } });
    mount();
    expect(overlay().querySelector("img")).toBeNull();
    expect(overlay().textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("a text box that somebody else is typing in", () => {
  it("has one outline in their colour that says who is typing in it, and not a second one for being selected", () => {
    there(2, { selection: ["a"], editing: "a" });
    mount();
    const outlines = [...overlay().querySelectorAll<HTMLElement>(".cf-presence__outline")];
    expect(outlines).toHaveLength(1);
    expect(outlines[0].classList.contains("cf-presence__outline--typing")).toBe(true);
    expect(outlines[0].style).toMatchObject({ left: "50px", top: "25px", width: "100px", height: "40px", transform: "rotate(30deg)" });
    expect(outlines[0].style.borderColor).toBe(hexToRgb(colorOf(2)));
    expect(outlines[0].textContent).toBe("Bo is typing…");
  });

  it("says so beside the name on what else they have selected, and nothing for a box that is not on this page", () => {
    there(2, { selection: ["inner", "a"], editing: "a" });
    there(3, { name: "Cy", selection: [], editing: "gone" });
    mount();
    const texts = [...overlay().querySelectorAll<HTMLElement>(".cf-presence__outline")].map((o) => o.textContent);
    expect(texts).toEqual(["Bo", "Bo is typing…"]);
  });
});

describe("this person's own pointer", () => {
  it("is followed over the canvas in the pixels of the design, and is gone when it leaves", () => {
    mount();
    const workspace = screen.getByTestId("workspace");
    // (the test browser lays nothing out: the page is at the corner of the window)
    fireEvent.pointerMove(workspace, { clientX: 100, clientY: 40 });
    expect(pointerNow()).toEqual({ x: 200, y: 80 });
    fireEvent.pointerLeave(workspace);
    expect(pointerNow()).toBeNull();
  });

  it("is not followed while this person is not in a shared design, nor after the layer is gone", () => {
    usePresence.setState({ me: null });
    const { unmount } = mount();
    const workspace = screen.getByTestId("workspace");
    fireEvent.pointerMove(workspace, { clientX: 100, clientY: 40 });
    expect(pointerNow()).toBeNull();
    act(() => usePresence.setState({ me: 1 }));
    fireEvent.pointerMove(workspace, { clientX: 100, clientY: 40 });
    expect(pointerNow()).not.toBeNull();
    unmount();
    expect(pointerNow()).toBeNull();
    fireEvent.pointerMove(workspace, { clientX: 7, clientY: 7 });
    expect(pointerNow()).toBeNull();
  });
});

describe("who is here, in the top bar", () => {
  it("is nothing while this person is not in a shared design", () => {
    usePresence.setState({ me: null });
    const { container } = render(<LivePeople />);
    expect(container.innerHTML).toBe("");
  });

  it("is a list with a name that says how many, this person first, each with initials in their colour and their name for a screen reader", () => {
    usePresence.setState({ name: "Ana María" });
    there(2, { name: "Bo" });
    there(3, { name: "" });
    render(<LivePeople />);
    const list = screen.getByRole("list", { name: "3 people here" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".cf-live-people__initials")?.textContent)).toEqual(["AM", "B", "G3"]);
    expect(items.map((li) => li.querySelector(".cf-sr-only")?.textContent)).toEqual(["Ana María (you)", "Bo", "Guest 3"]);
    expect(items.map((li) => li.getAttribute("title"))).toEqual(["Ana María (you)", "Bo", "Guest 3"]);
    expect(items[1].style.backgroundColor).toBe(hexToRgb(colorOf(2)));
    expect(items[0].style.backgroundColor).toBe(hexToRgb(colorOf(1)));
    expect(list.querySelector(".cf-live-people__count")?.textContent).toBe("3");
  });

  it("shows this person under the name the server gave their seat (an account's), over the one they typed and over Guest (B4)", () => {
    usePresence.setState({ name: "Typed here", fixedName: "Val Owner" });
    render(<LivePeople />);
    const item = screen.getByRole("listitem");
    expect(item.querySelector(".cf-sr-only")?.textContent).toBe("Val Owner (you)");
    expect(item.querySelector(".cf-live-people__initials")?.textContent).toBe("VO");
    act(() => usePresence.setState({ name: "", fixedName: "Val Owner" }));
    expect(screen.getByRole("listitem").getAttribute("title")).toBe("Val Owner (you)");
  });

  it("says one person when this person is alone", () => {
    render(<LivePeople />);
    expect(screen.getByRole("list", { name: "1 person here" })).toBeTruthy();
    expect(screen.getByRole("listitem").querySelector(".cf-sr-only")?.textContent).toBe("Guest 1 (you)");
  });

  it("shows the first few and names the rest in one place when there are many", () => {
    for (let peer = 2; peer <= 9; peer++) there(peer, { name: `Person ${peer}` });
    render(<LivePeople />);
    const list = screen.getByRole("list", { name: "9 people here" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[4].textContent).toContain("+5");
    expect(items[4].querySelector(".cf-sr-only")?.textContent).toBe("and Person 5, Person 6, Person 7, Person 8, Person 9");
  });

  it("does not speak up when somebody moves or comes in: it is not a live region", () => {
    there(2);
    const { container } = render(<LivePeople />);
    expect(container.querySelector("[aria-live], [role=status], [role=alert], [role=log]")).toBeNull();
  });
});

describe("the field for this person's name", () => {
  it("shows the name kept on this device, and keeps what is typed as a name that may be said", async () => {
    localStorage.setItem("craftly.live.name", "Ana");
    usePresence.setState({ name: savedName(), me: null });
    render(<NameField />);
    const field = screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement;
    expect(field.value).toBe("Ana");
    expect(field.placeholder).toBe("Guest"); // before there is a number to go with it
    await userEvent.clear(field);
    await userEvent.type(field, "Bo  Diddley ");
    expect(field.value).toBe("Bo  Diddley "); // what is typed stays as typed while it is typed
    expect(usePresence.getState().name).toBe("Bo Diddley");
    expect(savedName()).toBe("Bo Diddley");
  });

  it("says what the name is for, and what the others see without one", () => {
    usePresence.setState({ me: 4 });
    render(<NameField />);
    const field = screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement;
    expect(field.placeholder).toBe("Guest 4");
    expect(field.maxLength).toBe(40);
    expect(screen.getByText(/others see this name/i)).toBeTruthy();
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}
