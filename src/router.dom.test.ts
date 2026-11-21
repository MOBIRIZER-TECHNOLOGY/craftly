import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { designPath, navigate, parseRoute, useRoute } from "./router";

// whether the design's saves are done, and what the person answers when asked to leave without them
const leaving = vi.hoisted(() => ({ saves: "saved" as string, answer: true, asked: 0 }));
vi.mock("./settleSaves", () => ({ settleSaves: async () => leaving.saves }));
vi.mock("@/ui", () => ({
  confirm: async () => {
    leaving.asked++;
    return leaving.answer;
  },
}));

/** Waits for the hash change and the answers that one navigation sets off. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("parseRoute", () => {
  it("treats an empty hash, # and #/ as the home page", () => {
    for (const hash of ["", "#", "#/", "/"]) expect(parseRoute(hash)).toEqual({ name: "home" });
  });

  it("reads the page name", () => {
    expect(parseRoute("#/projects")).toEqual({ name: "projects", id: undefined });
    expect(parseRoute("#/templates")).toEqual({ name: "templates", id: undefined });
    expect(parseRoute("#/brand")).toEqual({ name: "brand", id: undefined });
    expect(parseRoute("#/trash")).toEqual({ name: "trash", id: undefined });
  });

  it("reads the id after the page name", () => {
    expect(parseRoute("#/design/d_abc123")).toEqual({ name: "design", id: "d_abc123" });
    expect(parseRoute("#/projects/f_1")).toEqual({ name: "projects", id: "f_1" });
    expect(parseRoute("#/templates/social")).toEqual({ name: "templates", id: "social" });
  });

  it("decodes an id that was encoded for the URL", () => {
    expect(parseRoute("#/design/a%20b%2Fc")).toEqual({ name: "design", id: "a b/c" });
  });

  it("ignores a trailing slash and anything after the id", () => {
    expect(parseRoute("#/projects/")).toEqual({ name: "projects", id: undefined });
    expect(parseRoute("#/design/d1/extra")).toEqual({ name: "design", id: "d1" });
  });

  it("accepts a hash without the slash and keeps unknown page names", () => {
    expect(parseRoute("#projects")).toEqual({ name: "projects", id: undefined });
    expect(parseRoute("#/gallery")).toEqual({ name: "gallery", id: undefined });
  });
});

describe("designPath", () => {
  it("builds the route of a design and encodes the id", () => {
    expect(designPath("d_1")).toBe("/design/d_1");
    expect(designPath("a b/c")).toBe("/design/a%20b%2Fc");
  });

  it("round-trips through parseRoute", () => {
    expect(parseRoute(`#${designPath("we ird/id")}`)).toEqual({ name: "design", id: "we ird/id" });
  });
});

describe("navigate", () => {
  it("sets the hash for a path with or without the hash sign", () => {
    navigate("/trash");
    expect(window.location.hash).toBe("#/trash");
    navigate("#/brand");
    expect(window.location.hash).toBe("#/brand");
  });
});

describe("useRoute", () => {
  it("starts from the current hash", () => {
    window.location.hash = "#/projects/f_9";
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: "projects", id: "f_9" });
  });

  it("is the home page when there is no hash", () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: "home" });
  });

  it("follows the hash as it changes", async () => {
    const { result } = renderHook(() => useRoute());
    await act(async () => {
      navigate("/templates/social");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toEqual({ name: "templates", id: "social" });
    await act(async () => {
      navigate("/design/d_1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toEqual({ name: "design", id: "d_1" });
  });

  it("asks before Back leaves a design that is not saved, and stays in the design when told to", async () => {
    window.location.hash = "#/";
    window.location.hash = "#/design/d_1";
    const { result, unmount } = renderHook(() => useRoute());
    try {
      leaving.saves = "failed";
      leaving.asked = 0;
      leaving.answer = false;
      window.history.back();
      await waitFor(() => expect(leaving.asked).toBe(1));
      await settle();
      expect(result.current).toEqual({ name: "design", id: "d_1" });
      expect(window.location.hash).toBe("#/design/d_1");
    } finally {
      leaving.saves = "saved";
      unmount();
    }
  });

  it("leaves a design that is not saved on Back when told to, in the entry Back went to, so that Back goes on from there", async () => {
    window.location.hash = "#/start";
    window.location.hash = "#/";
    window.location.hash = "#/design/d_2";
    const { result, unmount } = renderHook(() => useRoute());
    try {
      leaving.saves = "failed";
      leaving.answer = true;
      window.history.back();
      await waitFor(() => expect(result.current).toEqual({ name: "home" }));
      await settle();
      expect(window.location.hash).toBe("#/");
      // Back from there goes on to what came before, not to the design that was left
      leaving.saves = "saved";
      window.history.back();
      await waitFor(() => expect(window.location.hash).toBe("#/start"));
      // and Forward is still there: home, then the design
      window.history.forward();
      await waitFor(() => expect(window.location.hash).toBe("#/"));
    } finally {
      leaving.saves = "saved";
      unmount();
    }
  });

  it("stops listening when the component goes away", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useRoute());
    unmount();
    expect(remove.mock.calls.map((call) => call[0])).toContain("hashchange");
  });
});
