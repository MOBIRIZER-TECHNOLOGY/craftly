/**
 * The editor keeps a design that carries a link in step with its server for as long as it is open: it connects when the design is
 * ready, lets go when it is closed or when sharing stops, and connects again when sharing starts.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { LiveLink } from "@/core/types";
import { mountEditorOn } from "@/test/ctxUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import * as connection from "./live/connection";

vi.mock("./live/connection", async (original) => ({ ...(await original<typeof import("./live/connection")>()), connectLive: vi.fn() }));

const link: LiveLink = { server: "https://live.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "WjGO30NJy5udhntaj-8j9w", role: "edit", viewKey: "BXQddjRR35eABAbZ6Hib_Q" };
const connect = vi.mocked(connection.connectLive);
const stops: Array<ReturnType<typeof vi.fn>> = [];

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout();
  stops.length = 0;
  connect.mockReset();
  connect.mockImplementation(() => {
    const stop = vi.fn();
    stops.push(stop);
    return stop;
  });
});
afterEach(() => restoreLayout());

const design = (live?: LiveLink) =>
  createDesign({
    title: "Together",
    width: 1000,
    height: 600,
    pages: [createPage({ elements: [createShape("rect", { x: 10, y: 10, width: 100, height: 50 })] })],
    ...(live ? { live } : {}),
  } as never);

describe("a design that is shared", () => {
  it("connects when the design is ready, with its link, and lets go when the editor is closed", async () => {
    const view = await mountEditorOn({ ...design(), live: link });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(link);
    expect(stops[0]).not.toHaveBeenCalled();
    view.unmount();
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it("does not connect a design that is not shared", async () => {
    await mountEditorOn(design());
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects when sharing starts and lets go when it stops, and shows the state of the connection in the top bar", async () => {
    const view = await mountEditorOn(design());
    expect(view.container.querySelector(".cf-live-badge")).toBeNull();
    act(() => useEditor.getState().actions.setLiveLink(link));
    expect(connect).toHaveBeenCalledWith(link);
    expect(view.container.querySelector(".cf-live-badge")).toBeTruthy();
    act(() => useEditor.getState().actions.setLiveLink(null));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".cf-live-badge")).toBeNull();
  });

  it("does not connect again for a change of the design that is not a change of the link", async () => {
    await mountEditorOn({ ...design(), live: link });
    act(() => useEditor.getState().actions.setTitle("Renamed"));
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
