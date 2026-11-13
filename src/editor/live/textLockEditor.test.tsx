/**
 * The text editor on the canvas in a shared design, when this person's box is closed because somebody else was first in it
 * (connection.ts closes it): closing a box that was left empty removes the element, as always, but not when somebody else is
 * typing in that very box.
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { TextEditorOverlay } from "../canvas/TextEditorOverlay";

const a = () => useEditor.getState().actions;
const ids = () => useEditor.getState().design?.pages[0].elements.map((e) => e.id);
let holder: string | null;

beforeEach(() => {
  resetEditor();
  a().openDesign(createDesign({ title: "Shared", width: 1000, height: 600, pages: [createPage({ id: "p", elements: [createText({ id: "t", text: "Hello" })] })] }));
  holder = null;
  a().startLive({ change: () => undefined, textHolder: () => holder });
});

/** opens the box, empties it as a person would who selected everything and pressed Delete, and closes it */
function emptyAndClose(before: () => void = () => undefined) {
  render(<TextEditorOverlay />);
  act(() => a().startTextEdit("t"));
  const editor = document.querySelector<HTMLElement>("[data-cf-text-editor]")!;
  expect(editor).toBeTruthy();
  editor.textContent = "";
  before();
  act(() => a().endTextEdit());
  expect(document.querySelector("[data-cf-text-editor]")).toBeNull();
}

describe("a text box that is closed empty in a shared design", () => {
  it("is removed, as in any design, when nobody else is typing in it", () => {
    emptyAndClose();
    expect(ids()).toEqual([]);
  });

  it("is left alone when somebody else is typing in it: it is theirs now, and what they type must have a box to be in", () => {
    emptyAndClose(() => (holder = "Bo"));
    expect(ids()).toEqual(["t"]);
  });
});
