/** Record in Uploads: the camera or the screen recorded, watched, and put on the page as a clip (on fakes of the devices). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, listAssets, restoreAssets } from "@/core/assets";
import type { Asset, VideoElement } from "@/core/types";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { emptyDesign, mountPanels, pageElements } from "@/test/tabsHarness";
import { FakeRecorder, installMedia, uninstallMedia } from "./fakeMedia";

/* The real asset store (fake IndexedDB). jsdom cannot read a clip, so its length is made up, and a test can fail an upload. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile), videoInfo: vi.fn(async () => ({ width: 1280, height: 720, duration: 4.5 })) };
});

let restoreLayout: () => void;
let asked: ReturnType<typeof installMedia>;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(340, 700);
  asked = installMedia();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  // the real upload reads the clip with a <video>, which jsdom cannot play: the recording is stored as it is
  vi.mocked(addAssetFromFile).mockImplementation(async (file: File) => {
    const asset: Asset = {
      id: "a_rec",
      name: file.name.replace(/\.[^.]+$/, ""),
      kind: "video",
      mime: file.type,
      size: file.size,
      width: 1280,
      height: 720,
      createdAt: Date.now(),
      blob: file,
    };
    await restoreAssets([asset]);
    return asset;
  });
});
afterEach(() => {
  restoreLayout();
  uninstallMedia();
  vi.restoreAllMocks();
});

async function openRecord() {
  const user = userEvent.setup();
  mountPanels({ tab: "uploads", design: emptyDesign() });
  await user.click(await screen.findByRole("button", { name: "Record" }));
  const dialog = await screen.findByRole("dialog", { name: "Record" });
  return { user, dialog, inside: within(dialog) };
}
const recorder = () => FakeRecorder.made[FakeRecorder.made.length - 1];

describe("Record in Uploads", () => {
  it("records the camera with its sound, shows the recording, and puts it on the page as a clip kept in the uploads", async () => {
    const { user, inside } = await openRecord();
    expect(inside.getByRole("radio", { name: "Camera" }).getAttribute("aria-checked")).toBe("true");
    expect(inside.getByRole("checkbox", { name: "Sound from the microphone" })).toHaveProperty("checked", true);
    expect(inside.getByText(/asks first whether this page may use the camera/)).toBeTruthy();

    await user.click(inside.getByRole("button", { name: "Start recording" }));
    expect(asked.user[0]).toMatchObject({ audio: true });
    expect(await inside.findByRole("timer")).toHaveProperty("textContent", "Recording 0:00 of 10:00");
    // the camera is shown as a mirror while it records
    expect(document.querySelector(".cf-record__stage")?.className).toContain("is-mirrored");
    const tracks = recorder().stream.tracks;

    await user.click(inside.getByRole("button", { name: "Stop recording" }));
    expect(tracks.every((t) => t.stopped)).toBe(true);
    const take = await waitFor(() => document.querySelector(".cf-record__take") as HTMLVideoElement);
    expect(take.getAttribute("src")).toMatch(/^blob:/);
    expect(inside.getByRole("status").textContent).toMatch(/recorded$/);

    await user.click(inside.getByRole("button", { name: "Add to the page" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record" })).toBeNull());
    const file = vi.mocked(addAssetFromFile).mock.calls[0][0];
    expect(file.type).toBe("video/webm");
    expect(file.name).toMatch(/^Recording \d{4}-\d\d-\d\d \d\d\.\d\d\.webm$/);
    const [asset] = await listAssets();
    expect(asset).toMatchObject({ kind: "video", mime: "video/webm" });
    const clip = pageElements().find((e) => e.type === "video") as VideoElement;
    expect(clip).toMatchObject({ src: `asset:${asset.id}`, duration: 4.5, name: asset.name });
  });

  it("records the screen without sound, and stops when sharing stops in the browser", async () => {
    const { user, inside } = await openRecord();
    await user.click(inside.getByRole("radio", { name: "Screen" }));
    expect(inside.getByText(/Stop sharing in the browser/)).toBeTruthy();
    await user.click(inside.getByRole("checkbox", { name: "Sound from the microphone" }));
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    expect(asked.display).toHaveLength(1);
    expect(asked.user).toHaveLength(0);
    await inside.findByRole("timer");
    expect(document.querySelector(".cf-record__stage")?.className).not.toContain("is-mirrored");
    recorder().stream.tracks[0].end();
    expect(await inside.findByRole("button", { name: "Add to the page" })).toBeTruthy();
  });

  it("records again, keeping nothing of the first take", async () => {
    const { user, inside } = await openRecord();
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await user.click(await inside.findByRole("button", { name: "Stop recording" }));
    await user.click(await inside.findByRole("button", { name: "Record again" }));
    expect(inside.getByRole("button", { name: "Start recording" })).toBeTruthy();
    expect(document.querySelector(".cf-record__take")).toBeNull();
    expect(await listAssets()).toHaveLength(0);
  });

  it("says why when the browser was not allowed the camera, and when there is none", async () => {
    const { user, inside } = await openRecord();
    asked.refuse = { name: "NotAllowedError" };
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    expect((await inside.findByRole("alert")).textContent).toMatch(/was not allowed to use it/);
    asked.refuse = { name: "NotFoundError" };
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(inside.getByRole("alert").textContent).toBe("No camera or microphone was found."));
  });

  it("says so when the recorder breaks down, or nothing was recorded", async () => {
    const { user, inside } = await openRecord();
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await inside.findByRole("timer");
    const tracks = recorder().stream.tracks;
    recorder().fail();
    expect((await inside.findByRole("alert")).textContent).toMatch(/recorder failed/);
    expect(tracks.every((t) => t.stopped)).toBe(true);
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await inside.findByRole("timer");
    recorder().pieces = [];
    await user.click(inside.getByRole("button", { name: "Stop recording" }));
    await waitFor(() => expect(inside.getByRole("alert").textContent).toBe("Nothing was recorded."));
  });

  it("keeps the recording to try again when it cannot be added to the uploads", async () => {
    vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("full"));
    const { user, inside } = await openRecord();
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await user.click(await inside.findByRole("button", { name: "Stop recording" }));
    await user.click(await inside.findByRole("button", { name: "Add to the page" }));
    expect((await inside.findByRole("alert")).textContent).toBe("The recording could not be added to your uploads.");
    expect(inside.getByRole("button", { name: "Add to the page" })).toBeTruthy();
  });

  it("stops the camera and keeps nothing when it is closed while recording", async () => {
    const { user, inside } = await openRecord();
    await user.click(inside.getByRole("button", { name: "Start recording" }));
    await inside.findByRole("timer");
    const tracks = recorder().stream.tracks;
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record" })).toBeNull());
    expect(tracks.every((t) => t.stopped)).toBe(true);
    expect(recorder().state).toBe("inactive");
    expect(await listAssets()).toHaveLength(0);
    // opened again, it starts afresh
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(within(await screen.findByRole("dialog", { name: "Record" })).getByRole("button", { name: "Start recording" })).toBeTruthy();
  });

  it("says that this browser cannot record, where it has no recorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { inside } = await openRecord();
    expect(inside.getByRole("alert").textContent).toMatch(/cannot record here/);
    expect(inside.queryByRole("button", { name: "Start recording" })).toHaveProperty("disabled", true);
  });

  it("offers only the screen where the browser has no camera", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: async () => null } });
    const { user, inside } = await openRecord();
    expect(inside.getByRole("radio", { name: "Screen" }).getAttribute("aria-checked")).toBe("true");
    await user.click(inside.getByRole("radio", { name: "Camera" }));
    expect(inside.getByText("This browser cannot record this.")).toBeTruthy();
    expect(inside.getByRole("button", { name: "Start recording" })).toHaveProperty("disabled", true);
  });
});
