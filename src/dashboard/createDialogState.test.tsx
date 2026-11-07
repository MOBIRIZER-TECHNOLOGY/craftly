import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_CREATE_KEY, closeCreateDialog, consumeOpenCreateRequest, openCreateDialog, useCreateDialog } from "./createDialogState";

afterEach(() => {
  act(() => closeCreateDialog());
});

describe("the Create dialog state", () => {
  it("starts closed on the For you tab with an empty search and no folder", () => {
    const { result } = renderHook(() => useCreateDialog());
    expect(result.current).toEqual({ open: false, tab: "for-you", query: "", folderId: null });
  });

  it("opens on the For you tab by default", () => {
    const { result } = renderHook(() => useCreateDialog());
    act(() => openCreateDialog());
    expect(result.current).toEqual({ open: true, tab: "for-you", query: "", folderId: null });
  });

  it("opens on a chosen tab, with a search and a folder to file the new design in", () => {
    const { result } = renderHook(() => useCreateDialog());
    act(() => openCreateDialog({ tab: "custom", query: "poster", folderId: "f_1" }));
    expect(result.current).toEqual({ open: true, tab: "custom", query: "poster", folderId: "f_1" });
  });

  it("forgets the options of the last opening when opened again", () => {
    const { result } = renderHook(() => useCreateDialog());
    act(() => openCreateDialog({ tab: "upload", query: "x", folderId: "f_1" }));
    act(() => openCreateDialog());
    expect(result.current).toEqual({ open: true, tab: "for-you", query: "", folderId: null });
  });

  it("closes without losing the rest of the state, so the dialog can fade out", () => {
    const { result } = renderHook(() => useCreateDialog());
    act(() => openCreateDialog({ tab: "social", folderId: "f_2" }));
    act(() => closeCreateDialog());
    expect(result.current).toEqual({ open: false, tab: "social", query: "", folderId: "f_2" });
  });

  it("does not notify anyone when closing a dialog that is already closed", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useCreateDialog();
    });
    const before = renders;
    act(() => closeCreateDialog());
    expect(renders).toBe(before);
  });

  it("tells every component that uses it", () => {
    const first = renderHook(() => useCreateDialog());
    const second = renderHook(() => useCreateDialog());
    act(() => openCreateDialog({ tab: "print" }));
    expect(first.result.current.tab).toBe("print");
    expect(second.result.current.tab).toBe("print");
  });

  it("can be rendered on a server, where the dialog is closed", () => {
    function Probe() {
      const { open, tab } = useCreateDialog();
      return <p>{`${open ? "open" : "closed"} on ${tab}`}</p>;
    }
    act(() => openCreateDialog());
    act(() => closeCreateDialog());
    expect(renderToString(<Probe />)).toContain("closed on for-you");
  });
});

describe("consumeOpenCreateRequest", () => {
  it("opens the dialog when another screen asked for it, and clears the request", () => {
    const { result } = renderHook(() => useCreateDialog());
    sessionStorage.setItem(OPEN_CREATE_KEY, "1");
    let opened = false;
    act(() => {
      opened = consumeOpenCreateRequest();
    });
    expect(opened).toBe(true);
    expect(result.current.open).toBe(true);
    expect(sessionStorage.getItem(OPEN_CREATE_KEY)).toBeNull();
  });

  it("does nothing without a request", () => {
    const { result } = renderHook(() => useCreateDialog());
    expect(consumeOpenCreateRequest()).toBe(false);
    expect(result.current.open).toBe(false);
  });

  it("answers a request only once", () => {
    sessionStorage.setItem(OPEN_CREATE_KEY, "yes");
    act(() => void consumeOpenCreateRequest());
    expect(consumeOpenCreateRequest()).toBe(false);
  });

  it("does nothing when the browser will not let the page read its session storage", () => {
    const { result } = renderHook(() => useCreateDialog());
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(consumeOpenCreateRequest()).toBe(false);
    expect(result.current.open).toBe(false);
  });
});
