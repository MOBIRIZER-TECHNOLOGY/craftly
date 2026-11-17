import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, solid } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { DownloadPanel } from "./DownloadPanel";

// A browser that records video as MP4 and not as WebM, as Safari does. (The panel looks this up once per page, so this file has
// its own copy of the panel.)
vi.mock("./animated/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./animated/video")>();
  return { ...actual, detectVideoSupport: () => ({ ok: true, mimeType: "video/mp4;codecs=avc1", reason: null }) };
});

afterEach(() => {
  cleanup();
  resetEditor();
});

describe("<DownloadPanel> in a browser that records MP4 (Safari)", () => {
  it("offers the video as an MP4, and lets it be chosen", async () => {
    const user = userEvent.setup();
    resetEditor();
    useEditor.getState().actions.openDesign(createDesign({ title: "Reel", width: 400, height: 300, pages: [createPage({ background: solid("#ffffff") })] }));
    render(<DownloadPanel />);
    await user.click(screen.getByRole("combobox", { name: "File type" }));
    const option = screen.getByRole("option", { name: /Video \(MP4\)/ });
    expect(option.getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.queryByRole("option", { name: /WebM/ })).toBeNull();
    await user.click(option);
    expect(screen.getByRole("combobox", { name: "File type" }).textContent).toContain("Video (MP4)");
  });
});
