import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Template } from "@/core/types";
import { closeTemplatePreview, openTemplatePreview, presetTemplateSearch, takePresetTemplateSearch, usePreviewTemplate } from "./templatePreview";

const template = (id: string) =>
  ({ id, name: `Template ${id}`, category: "social", typeId: "instagram-post", width: 10, height: 10, tags: [], accent: "#000", pages: [] }) as unknown as Template;

afterEach(() => {
  act(() => closeTemplatePreview());
  takePresetTemplateSearch();
});

describe("the template preview state", () => {
  it("shows no template at first", () => {
    const { result } = renderHook(() => usePreviewTemplate());
    expect(result.current).toBeNull();
  });

  it("shows the template that was opened, and replaces it when another is opened", () => {
    const { result } = renderHook(() => usePreviewTemplate());
    const a = template("a");
    const b = template("b");
    act(() => openTemplatePreview(a));
    expect(result.current).toBe(a);
    act(() => openTemplatePreview(b));
    expect(result.current).toBe(b);
  });

  it("goes back to nothing when closed", () => {
    const { result } = renderHook(() => usePreviewTemplate());
    act(() => openTemplatePreview(template("a")));
    act(() => closeTemplatePreview());
    expect(result.current).toBeNull();
  });

  it("does not notify anyone when there is nothing to close", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return usePreviewTemplate();
    });
    const before = renders;
    act(() => closeTemplatePreview());
    expect(renders).toBe(before);
  });

  it("tells every component that watches it", () => {
    const first = renderHook(() => usePreviewTemplate());
    const second = renderHook(() => usePreviewTemplate());
    const a = template("a");
    act(() => openTemplatePreview(a));
    expect(first.result.current).toBe(a);
    expect(second.result.current).toBe(a);
  });

  it("can be rendered on a server, where nothing is previewed", () => {
    function Probe() {
      return <p>{usePreviewTemplate() === null ? "no preview" : "preview"}</p>;
    }
    expect(renderToString(<Probe />)).toContain("no preview");
  });
});

describe("the search handed over from Home to Templates", () => {
  it("hands the typed search over once", () => {
    presetTemplateSearch("birthday card");
    expect(takePresetTemplateSearch()).toBe("birthday card");
    expect(takePresetTemplateSearch()).toBe("");
  });

  it("is empty when nobody preset a search, and the last preset wins", () => {
    expect(takePresetTemplateSearch()).toBe("");
    presetTemplateSearch("one");
    presetTemplateSearch("two");
    expect(takePresetTemplateSearch()).toBe("two");
  });
});
