import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImage, createShape } from "@/core/factory";
import { checkSupport } from "@/ml/device";
import { MlError } from "@/ml/errors";
import { getModelSpec } from "@/ml/registry";
import { blurBackground, colourPop, removeBackground, restoreOriginal, upscale } from "@/ml/service";
import { useMlStore } from "@/ml/state";
import { openElements, selectElements, showPanel, store } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { toast } from "@/ui";

vi.mock("@/ml/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ml/service")>()),
  removeBackground: vi.fn(),
  blurBackground: vi.fn(),
  colourPop: vi.fn(),
  upscale: vi.fn(),
  restoreOriginal: vi.fn(),
  refreshModels: vi.fn(async () => undefined),
}));
vi.mock("@/ml/device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ml/device")>()),
  checkSupport: vi.fn(async () => ({ ok: true })),
}));

const spec = getModelSpec("isnet-general")!;
const larger = getModelSpec("realesrgan-general")!;
const photo = (extra = {}) => createImage({ src: "asset:p", x: 10, y: 10, width: 300, height: 200, naturalWidth: 300, naturalHeight: 200, ...extra });
const record = (s: typeof spec, sha256 = s.sha256) => ({ id: s.id, sha256, bytes: s.bytes, revision: s.revision, installedAt: 1 });
const installedBoth = () => ({ [spec.id]: record(spec), [larger.id]: record(larger) });

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
  vi.mocked(removeBackground).mockReset();
  vi.mocked(blurBackground).mockReset();
  vi.mocked(colourPop).mockReset();
  vi.mocked(upscale).mockReset();
  vi.mocked(restoreOriginal).mockReset();
  vi.mocked(checkSupport).mockReset().mockResolvedValue({ ok: true });
  useMlStore.setState({ loaded: true, installed: installedBoth(), installing: {}, job: null, storage: {} });
  return () => restoreLayout();
});

function openTools(selected = [photo()]) {
  openElements(selected, { selected });
  showPanel({ kind: "filters", tab: "tools" });
  return selected;
}
const removeButton = () => screen.getByRole("button", { name: "Remove background" });
const blurButton = () => screen.getByRole("button", { name: "Blur background" });
const popButton = () => screen.getByRole("button", { name: "Colour pop" });
const upscaleButton = () => screen.getByRole("button", { name: "Upscale" });
const factor = (name: string) => screen.getByRole("radio", { name });
const strength = (name: string) => screen.getByRole("radio", { name });
const popStyle = (name: string) => screen.getByRole("radio", { name });
const section = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}`) }).parentElement as HTMLElement;

describe("the Tools tab", () => {
  it("is the third tab of the Edit image panel", async () => {
    const user = userEvent.setup();
    const [p] = [photo()];
    openElements([p], { selected: [p] });
    showPanel({ kind: "filters", tab: "filters" });
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    expect(store().context).toEqual({ kind: "filters", tab: "tools" });
    expect(screen.getByRole("region", { name: "Photo tools" })).toBeTruthy();
  });

  it("asks for a photo like the other tabs do", () => {
    const box = createShape("rect");
    openElements([box], { selected: [box] });
    showPanel({ kind: "filters", tab: "tools" });
    expect(screen.getByText("No photo selected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove background" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Blur background" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Colour pop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upscale" })).toBeNull();
  });

  it("offers all four tools for one photo, and says nothing about a download when both models are installed", () => {
    openTools();
    expect(removeButton().hasAttribute("disabled")).toBe(false);
    expect(blurButton().hasAttribute("disabled")).toBe(false);
    expect(popButton().hasAttribute("disabled")).toBe(false);
    expect(upscaleButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/download/i)).toBeNull();
  });

  it("says what the first use costs when a model is not on the device, for each tool on its own", () => {
    useMlStore.setState({ installed: { [larger.id]: record(larger) } });
    openTools();
    expect(within(section("Remove background")).getByText(/88.1 MB/)).toBeTruthy();
    expect(within(section("Blur background")).getByText(/88.1 MB/)).toBeTruthy(); // the same model: the same cost
    expect(within(section("Colour pop")).getByText(/88.1 MB/)).toBeTruthy();
    expect(within(section("Upscale")).queryByText(/download/i)).toBeNull();

    act(() => useMlStore.setState({ installed: { [spec.id]: record(spec) } }));
    expect(within(section("Upscale")).getByText(/4.9 MB/)).toBeTruthy();
    expect(within(section("Remove background")).queryByText(/download/i)).toBeNull();
    expect(within(section("Blur background")).queryByText(/download/i)).toBeNull();
    expect(within(section("Colour pop")).queryByText(/download/i)).toBeNull();
  });

  it("also mentions the download when the stored model is not the one the app now pins", () => {
    useMlStore.setState({ installed: { ...installedBoth(), [spec.id]: record(spec, "0".repeat(64)) } });
    openTools();
    expect(screen.getAllByText(/88.1 MB/)).toHaveLength(3); // for Remove background, Blur background and Colour pop
  });

  it("says nothing about a download until it knows what is installed", () => {
    useMlStore.setState({ loaded: false, installed: {} });
    openTools();
    expect(screen.queryByText(/MB/)).toBeNull();
    expect(removeButton().hasAttribute("disabled")).toBe(false);
    expect(blurButton().hasAttribute("disabled")).toBe(false);
    expect(popButton().hasAttribute("disabled")).toBe(false);
    expect(upscaleButton().hasAttribute("disabled")).toBe(false);
  });

  it("works on one photo at a time, and says so once", () => {
    const a = photo();
    const b = photo({ x: 400 });
    openTools([a, b]);
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Select one photo to use these tools.")).toHaveLength(1);
  });

  it("explains a browser that cannot run the models, once, instead of offering buttons that fail", async () => {
    vi.mocked(checkSupport).mockResolvedValue({ ok: false, reason: "no-webgpu", message: "This browser doesn't support WebGPU." });
    openTools();
    expect(await screen.findByText("This browser doesn't support WebGPU.")).toBeTruthy();
    expect(screen.getAllByText("This browser doesn't support WebGPU.")).toHaveLength(1);
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
  });

  it("holds back only the tool whose model needs a graphics-card feature the device lacks", async () => {
    const half = "This graphics card can't do half-precision maths, which the model needs.";
    vi.mocked(checkSupport).mockImplementation(async (_env, needs = []) => (needs.includes("shader-f16") ? { ok: false, reason: "missing-feature", message: half } : { ok: true }));
    openTools();
    expect(await within(section("Remove background")).findByText(half)).toBeTruthy();
    expect(await within(section("Blur background")).findByText(half)).toBeTruthy(); // the same model needs the same card
    expect(await within(section("Colour pop")).findByText(half)).toBeTruthy();
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(false); // full precision: it needs nothing special
    expect(within(section("Upscale")).queryByText(half)).toBeNull();
  });

  it("does not offer a locked photo, and says how to change that", () => {
    openTools([photo({ locked: true })]);
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Unlock the photo to remove its background.")).toBeTruthy();
    expect(screen.getByText("Unlock the photo to blur its background.")).toBeTruthy();
    expect(screen.getByText("Unlock the photo to take the colour out of its background.")).toBeTruthy();
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Unlock the photo to make it larger.")).toBeTruthy();
  });

  it("opens the models dialog", async () => {
    const user = userEvent.setup();
    openTools();
    await user.click(screen.getByRole("button", { name: "Manage models" }));
    expect(store().dialog).toBe("models");
  });

  it("follows the selection from one photo to the next", () => {
    const a = photo();
    const b = photo({ x: 400 });
    openElements([a, b], { selected: [a] });
    showPanel({ kind: "filters", tab: "tools" });
    expect(removeButton().hasAttribute("disabled")).toBe(false);
    expect(blurButton().hasAttribute("disabled")).toBe(false);
    expect(popButton().hasAttribute("disabled")).toBe(false);
    expect(upscaleButton().hasAttribute("disabled")).toBe(false);
    selectElements(a, b);
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("Remove background", () => {
  it("starts the job for the selected photo and offers the download prompt", async () => {
    const user = userEvent.setup();
    vi.mocked(removeBackground).mockResolvedValue({ applied: true, scaled: false });
    const [p] = openTools();
    await user.click(removeButton());
    expect(removeBackground).toHaveBeenCalledWith(p.id, expect.objectContaining({ askToDownload: expect.any(Function) }));
  });

  it("confirms with a message that can be undone", async () => {
    const user = userEvent.setup();
    vi.mocked(removeBackground).mockResolvedValue({ applied: true, scaled: false });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    const undo = vi.spyOn(store().actions, "undo");
    openTools();
    await user.click(removeButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    const options = show.mock.calls[0]![0];
    expect(options).toMatchObject({ message: "Background removed.", kind: "success", actionLabel: "Undo" });
    options.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("mentions it when a very large photo had to be reduced", async () => {
    const user = userEvent.setup();
    vi.mocked(removeBackground).mockResolvedValue({ applied: true, scaled: true });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    openTools();
    await user.click(removeButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(String(show.mock.calls[0]![0].message)).toMatch(/25 megapixels/);
  });

  it("explains it when the whole photo is the subject", async () => {
    const user = userEvent.setup();
    vi.mocked(removeBackground).mockResolvedValue({ applied: false, reason: "whole-photo" });
    const info = vi.spyOn(toast, "info").mockReturnValue(1);
    openTools();
    await user.click(removeButton());
    await waitFor(() => expect(info).toHaveBeenCalled());
    expect(String(info.mock.calls[0]![0])).toMatch(/whole photo/i);
  });

  it("shows the plain reason when the job fails, and stays quiet when the person cancelled", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    openTools();
    vi.mocked(removeBackground).mockRejectedValueOnce(new MlError("out-of-memory"));
    await user.click(removeButton());
    await waitFor(() => expect(error).toHaveBeenCalledWith("This device ran out of graphics memory. Close other tabs and try again."));
    vi.mocked(removeBackground).mockRejectedValueOnce(new MlError("aborted"));
    await user.click(removeButton());
    await waitFor(() => expect(removeBackground).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows the step the job is on, with a way to cancel it, and keeps the other tool out of the way", async () => {
    const user = userEvent.setup();
    const [p] = openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ job: { kind: "remove-background", elementId: p.id, stage: "inference", cancel } }));
    expect(screen.getByText("Finding the subject…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove background" })).toBeNull();
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("A photo tool is working on this photo.")).toHaveLength(1); // once, not under every tool
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1); // one Cancel, for the job that is running
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("puts the keyboard on Cancel when the work starts, because the button that was pressed is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(removeBackground).mockImplementation(async (id) => {
      useMlStore.setState({ job: { kind: "remove-background", elementId: id, stage: "inference", cancel: vi.fn() } });
      return new Promise(() => undefined); // never finishes
    });
    openTools();
    removeButton().focus();
    // the dialog that may open meanwhile gives focus back to whatever carries this key, whichever of the two is on the page
    expect(removeButton().getAttribute("data-focus-key")).toBe("tool:remove-background");
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute("data-focus-key")).toBe("tool:remove-background");
  });

  it("lets the person stop while the engine is being prepared after a download", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: {} });
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "preparing", received: 1, total: 1, cancel } } }));
    expect(screen.getByText("Getting the engine ready…")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("announces a step when it changes, not every update of the progress", () => {
    useMlStore.setState({ installed: {} });
    openTools();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 1_000_000, total: 88_141_111, cancel: vi.fn() } } }));
    const live = screen.getAllByRole("status");
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe("Downloading the model"); // no percentage, no sizes, no button in the announcement
  });

  it("shows the download as it happens, with a way to cancel it", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: {} });
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 44_070_555, total: 88_141_111, cancel } } }));
    expect(screen.getByRole("progressbar", { name: "Downloading the model" }).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(/44\.1 MB of 88\.1 MB/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not hold up the other tool while its model downloads", () => {
    useMlStore.setState({ installed: { [larger.id]: record(larger) } });
    openTools();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 1, total: 2, cancel: vi.fn() } } }));
    expect(upscaleButton().hasAttribute("disabled")).toBe(false);
    expect(blurButton().hasAttribute("disabled")).toBe(true); // it shares that model
    expect(popButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("another job on another photo", () => {
  it("keeps the tools unavailable, and lets the person stop that job from here", async () => {
    const user = userEvent.setup();
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: "someone-else", stage: "model", cancel } }));
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(popButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Another photo is being processed.")).toHaveLength(1);
    expect(screen.queryByText("A photo tool is working on this photo.")).toBeNull(); // it works on another one
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Blur background", () => {
  it("says what it does, and offers three strengths with the middle one chosen", () => {
    openTools();
    const own = within(section("Blur background"));
    expect(own.getByText("On-device")).toBeTruthy();
    expect(own.getByText(/sharp/i)).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Blur strength" })).toBeTruthy();
    expect(strength("Light").getAttribute("aria-checked")).toBe("false");
    expect(strength("Medium").getAttribute("aria-checked")).toBe("true");
    expect(strength("Strong").getAttribute("aria-checked")).toBe("false");
  });

  it("starts the job for the selected photo with the strength that is chosen, and offers the download prompt", async () => {
    const user = userEvent.setup();
    vi.mocked(blurBackground).mockResolvedValue({ applied: true, scaled: false, width: 300, height: 200 });
    const [p] = openTools();
    await user.click(blurButton());
    expect(blurBackground).toHaveBeenLastCalledWith(p.id, expect.objectContaining({ strength: "medium", askToDownload: expect.any(Function) }));
    await user.click(strength("Strong"));
    expect(strength("Strong").getAttribute("aria-checked")).toBe("true");
    await user.click(blurButton());
    expect(blurBackground).toHaveBeenLastCalledWith(p.id, expect.objectContaining({ strength: "strong" }));
    await user.click(strength("Light"));
    await user.click(blurButton());
    expect(blurBackground).toHaveBeenLastCalledWith(p.id, expect.objectContaining({ strength: "light" }));
  });

  it("keeps the strength when the selection moves to another photo", async () => {
    const user = userEvent.setup();
    const a = photo();
    const b = photo({ x: 400 });
    openElements([a, b], { selected: [a] });
    showPanel({ kind: "filters", tab: "tools" });
    await user.click(strength("Light"));
    selectElements(b);
    expect(strength("Light").getAttribute("aria-checked")).toBe("true");
  });

  it("confirms with a message that can be undone", async () => {
    const user = userEvent.setup();
    vi.mocked(blurBackground).mockResolvedValue({ applied: true, scaled: false, width: 300, height: 200 });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    const undo = vi.spyOn(store().actions, "undo");
    openTools();
    await user.click(blurButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    const options = show.mock.calls[0]![0];
    expect(options).toMatchObject({ message: "Background blurred.", kind: "success", actionLabel: "Undo" });
    options.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("mentions it when a very large photo had to be reduced", async () => {
    const user = userEvent.setup();
    vi.mocked(blurBackground).mockResolvedValue({ applied: true, scaled: true, width: 5477, height: 4564 });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    openTools();
    await user.click(blurButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(String(show.mock.calls[0]![0].message)).toMatch(/25 megapixels/);
  });

  it.each([
    ["whole-photo", /whole photo.*no background to blur/i],
    ["transparent", /already transparent.*nothing to blur/i],
  ] as const)("explains it when there is nothing to blur (%s), and does not call it a success", async (reason, words) => {
    const user = userEvent.setup();
    vi.mocked(blurBackground).mockResolvedValue({ applied: false, reason });
    const info = vi.spyOn(toast, "info").mockReturnValue(1);
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    openTools();
    await user.click(blurButton());
    await waitFor(() => expect(info).toHaveBeenCalled());
    expect(String(info.mock.calls[0]![0])).toMatch(words);
    expect(show).not.toHaveBeenCalled();
  });

  it("shows the plain reason when the job fails, and stays quiet when the person cancelled", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    openTools();
    vi.mocked(blurBackground).mockRejectedValueOnce(new MlError("no-subject"));
    await user.click(blurButton());
    await waitFor(() => expect(error).toHaveBeenCalledWith("No subject was found in this photo."));
    vi.mocked(blurBackground).mockRejectedValueOnce(new MlError("aborted"));
    await user.click(blurButton());
    await waitFor(() => expect(blurBackground).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows the step the job is on, with a way to cancel it, and keeps the other tools out of the way", async () => {
    const user = userEvent.setup();
    const [p] = openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ job: { kind: "blur-background", elementId: p.id, stage: "inference", cancel } }));
    expect(screen.getByText("Finding the subject…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Blur background" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Blur strength" })).toBeNull(); // nothing to choose while it works
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("names the last step in its own words", () => {
    const [p] = openTools();
    act(() => useMlStore.setState({ job: { kind: "blur-background", elementId: p.id, stage: "finishing", cancel: vi.fn() } }));
    expect(screen.getByText("Blurring the background…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Blurring the background" })).toBeTruthy();
  });

  it("puts the keyboard on Cancel when the work starts, because the button that was pressed is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(blurBackground).mockImplementation(async (id) => {
      useMlStore.setState({ job: { kind: "blur-background", elementId: id, stage: "inference", cancel: vi.fn() } });
      return new Promise(() => undefined); // never finishes
    });
    openTools();
    blurButton().focus();
    // the dialog that may open meanwhile gives focus back to whatever carries this key, whichever of the two is on the page
    expect(blurButton().getAttribute("data-focus-key")).toBe("tool:blur-background");
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute("data-focus-key")).toBe("tool:blur-background");
  });

  it("announces the step, not every change of anything else", () => {
    const [p] = openTools();
    act(() => useMlStore.setState({ job: { kind: "blur-background", elementId: p.id, stage: "inference", cancel: vi.fn() } }));
    const live = screen.getAllByRole("status");
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe("Finding the subject…");
  });

  it("shows the download of the model it shares under the tool that asked for it, and only there", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: {} });
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 44_070_555, total: 88_141_111, requestedBy: "blur-background", cancel } } }));
    expect(within(section("Blur background")).getByRole("progressbar", { name: "Downloading the model" })).toBeTruthy();
    expect(within(section("Remove background")).queryByRole("progressbar")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows a download that no tool asked for (from the models dialog) under Remove background, the first tool of that model", () => {
    useMlStore.setState({ installed: {} });
    openTools();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 1, total: 2, cancel: vi.fn() } } }));
    expect(within(section("Remove background")).getByRole("progressbar", { name: "Downloading the model" })).toBeTruthy();
    expect(within(section("Blur background")).queryByRole("progressbar")).toBeNull();
  });

  it("shows the download under Remove background when that tool asked for it", () => {
    useMlStore.setState({ installed: {} });
    openTools();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 1, total: 2, requestedBy: "remove-background", cancel: vi.fn() } } }));
    expect(within(section("Remove background")).getByRole("progressbar", { name: "Downloading the model" })).toBeTruthy();
    expect(within(section("Blur background")).queryByRole("progressbar")).toBeNull();
  });
});

describe("Colour pop", () => {
  it("says what it does, and offers black and white or faded, with black and white chosen", () => {
    openTools();
    const own = within(section("Colour pop"));
    expect(own.getByText("On-device")).toBeTruthy();
    expect(own.getByText(/in colour/i)).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Background style" })).toBeTruthy();
    expect(popStyle("Black & white").getAttribute("aria-checked")).toBe("true");
    expect(popStyle("Faded").getAttribute("aria-checked")).toBe("false");
  });

  it("starts the job for the selected photo with the style that is chosen, and offers the download prompt", async () => {
    const user = userEvent.setup();
    vi.mocked(colourPop).mockResolvedValue({ applied: true, scaled: false, width: 300, height: 200 });
    const [p] = openTools();
    await user.click(popButton());
    expect(colourPop).toHaveBeenLastCalledWith(p.id, expect.objectContaining({ style: "black-and-white", askToDownload: expect.any(Function) }));
    await user.click(popStyle("Faded"));
    expect(popStyle("Faded").getAttribute("aria-checked")).toBe("true");
    await user.click(popButton());
    expect(colourPop).toHaveBeenLastCalledWith(p.id, expect.objectContaining({ style: "faded" }));
  });

  it("keeps the style when the selection moves to another photo", async () => {
    const user = userEvent.setup();
    const a = photo();
    const b = photo({ x: 400 });
    openElements([a, b], { selected: [a] });
    showPanel({ kind: "filters", tab: "tools" });
    await user.click(popStyle("Faded"));
    selectElements(b);
    expect(popStyle("Faded").getAttribute("aria-checked")).toBe("true");
  });

  it("confirms with a message that can be undone", async () => {
    const user = userEvent.setup();
    vi.mocked(colourPop).mockResolvedValue({ applied: true, scaled: false, width: 300, height: 200 });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    const undo = vi.spyOn(store().actions, "undo");
    openTools();
    await user.click(popButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    const options = show.mock.calls[0]![0];
    expect(options).toMatchObject({ message: "Colour pop applied.", kind: "success", actionLabel: "Undo" });
    options.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("mentions it when a very large photo had to be reduced", async () => {
    const user = userEvent.setup();
    vi.mocked(colourPop).mockResolvedValue({ applied: true, scaled: true, width: 5477, height: 4564 });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    openTools();
    await user.click(popButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(String(show.mock.calls[0]![0].message)).toMatch(/25 megapixels/);
  });

  it.each([
    ["whole-photo", /whole photo.*no background to change/i],
    ["no-colour", /no colour to take out.*already black and white, or transparent/i],
  ] as const)("explains it when there is nothing to change (%s), and does not call it a success", async (reason, words) => {
    const user = userEvent.setup();
    vi.mocked(colourPop).mockResolvedValue({ applied: false, reason });
    const info = vi.spyOn(toast, "info").mockReturnValue(1);
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    openTools();
    await user.click(popButton());
    await waitFor(() => expect(info).toHaveBeenCalled());
    expect(String(info.mock.calls[0]![0])).toMatch(words);
    expect(show).not.toHaveBeenCalled();
  });

  it("shows the plain reason when the job fails, and stays quiet when the person cancelled", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    openTools();
    vi.mocked(colourPop).mockRejectedValueOnce(new MlError("no-subject"));
    await user.click(popButton());
    await waitFor(() => expect(error).toHaveBeenCalledWith("No subject was found in this photo."));
    vi.mocked(colourPop).mockRejectedValueOnce(new MlError("aborted"));
    await user.click(popButton());
    await waitFor(() => expect(colourPop).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows the step the job is on, with a way to cancel it, and keeps the other tools out of the way", async () => {
    const user = userEvent.setup();
    const [p] = openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ job: { kind: "colour-pop", elementId: p.id, stage: "inference", cancel } }));
    expect(screen.getByText("Finding the subject…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Colour pop" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Background style" })).toBeNull(); // nothing to choose while it works
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    expect(blurButton().hasAttribute("disabled")).toBe(true);
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("names the last step in its own words", () => {
    const [p] = openTools();
    act(() => useMlStore.setState({ job: { kind: "colour-pop", elementId: p.id, stage: "finishing", cancel: vi.fn() } }));
    expect(screen.getByText("Taking the colour out of the background…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Taking the colour out" })).toBeTruthy();
  });

  it("puts the keyboard on Cancel when the work starts, because the button that was pressed is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(colourPop).mockImplementation(async (id) => {
      useMlStore.setState({ job: { kind: "colour-pop", elementId: id, stage: "inference", cancel: vi.fn() } });
      return new Promise(() => undefined); // never finishes
    });
    openTools();
    popButton().focus();
    // the dialog that may open meanwhile gives focus back to whatever carries this key, whichever of the two is on the page
    expect(popButton().getAttribute("data-focus-key")).toBe("tool:colour-pop");
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute("data-focus-key")).toBe("tool:colour-pop");
  });

  it("shows the download of the model it shares under the tool that asked for it, and only there", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: {} });
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 44_070_555, total: 88_141_111, requestedBy: "colour-pop", cancel } } }));
    expect(within(section("Colour pop")).getByRole("progressbar", { name: "Downloading the model" })).toBeTruthy();
    expect(within(section("Remove background")).queryByRole("progressbar")).toBeNull();
    expect(within(section("Blur background")).queryByRole("progressbar")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Upscale", () => {
  it("shows what the photo is now and what the result would be, starting with twice as large", () => {
    openTools();
    expect(factor("2×").getAttribute("aria-checked")).toBe("true");
    expect(factor("4×").getAttribute("aria-checked")).toBe("false");
    expect(within(section("Upscale")).getByText("300 × 200 px → 600 × 400 px")).toBeTruthy();
  });

  it("shows the size of the other choice when the person picks it", async () => {
    const user = userEvent.setup();
    openTools([photo({ naturalWidth: 1200, naturalHeight: 800 })]);
    await user.click(factor("4×"));
    expect(factor("4×").getAttribute("aria-checked")).toBe("true");
    expect(within(section("Upscale")).getByText("1,200 × 800 px → 4,800 × 3,200 px")).toBeTruthy();
  });

  it("starts the job with the chosen factor and offers the download prompt", async () => {
    const user = userEvent.setup();
    vi.mocked(upscale).mockResolvedValue({ factor: 4, width: 1200, height: 800 });
    const [p] = openTools();
    await user.click(factor("4×"));
    await user.click(upscaleButton());
    expect(upscale).toHaveBeenCalledWith(p.id, expect.objectContaining({ factor: 4, askToDownload: expect.any(Function) }));
  });

  it("confirms with the new size, in a message that can be undone", async () => {
    const user = userEvent.setup();
    vi.mocked(upscale).mockResolvedValue({ factor: 2, width: 2400, height: 1600 });
    const show = vi.spyOn(toast, "show").mockReturnValue(1);
    const undo = vi.spyOn(store().actions, "undo");
    openTools();
    await user.click(upscaleButton());
    await waitFor(() => expect(show).toHaveBeenCalled());
    const options = show.mock.calls[0]![0];
    expect(options).toMatchObject({ message: "Enlarged to 2,400 × 1,600 px.", kind: "success", actionLabel: "Undo" });
    options.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("shows the plain reason when the job fails, and stays quiet when the person cancelled", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    openTools();
    vi.mocked(upscale).mockRejectedValueOnce(new MlError("out-of-memory"));
    await user.click(upscaleButton());
    await waitFor(() => expect(error).toHaveBeenCalledWith("This device ran out of graphics memory. Close other tabs and try again."));
    vi.mocked(upscale).mockRejectedValueOnce(new MlError("aborted"));
    await user.click(upscaleButton());
    await waitFor(() => expect(upscale).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not offer a factor that would make the result too large, and says why", () => {
    openTools([photo({ naturalWidth: 1500, naturalHeight: 1500 })]); // 4x would be 36 megapixels
    expect(factor("2×").hasAttribute("disabled")).toBe(false);
    expect(factor("4×").hasAttribute("disabled")).toBe(true);
    expect(within(section("Upscale")).getByText("4× is not available: the result would be over 25 megapixels.")).toBeTruthy();
    expect(upscaleButton().hasAttribute("disabled")).toBe(false);
  });

  it("moves to a factor that fits when the selection changes to a photo that is too large for the chosen one", async () => {
    const user = userEvent.setup();
    const small = photo({ naturalWidth: 400, naturalHeight: 300 });
    const big = photo({ x: 400, naturalWidth: 1500, naturalHeight: 1500 });
    openElements([small, big], { selected: [small] });
    showPanel({ kind: "filters", tab: "tools" });
    await user.click(factor("4×"));
    expect(factor("4×").getAttribute("aria-checked")).toBe("true");
    selectElements(big);
    expect(factor("2×").getAttribute("aria-checked")).toBe("true");
    expect(within(section("Upscale")).getByText("1,500 × 1,500 px → 3,000 × 3,000 px")).toBeTruthy();
  });

  it("says so when the photo is too large to be made larger at all, and offers no button that fails", () => {
    openTools([photo({ naturalWidth: 5000, naturalHeight: 4000 })]);
    expect(factor("2×").hasAttribute("disabled")).toBe(true);
    expect(factor("4×").hasAttribute("disabled")).toBe(true);
    expect(within(section("Upscale")).getByText(/too large to enlarge/)).toBeTruthy();
    expect(upscaleButton().hasAttribute("disabled")).toBe(true);
  });

  it("warns that a large photo takes a while, and that the work can be cancelled", () => {
    openTools([photo({ naturalWidth: 1600, naturalHeight: 1200 })]); // 1.9 megapixels
    expect(within(section("Upscale")).getByText(/minute or more/)).toBeTruthy();
  });

  it("does not warn about a small photo", () => {
    openTools();
    expect(within(section("Upscale")).queryByText(/minute/)).toBeNull();
  });

  it("shows the step the job is on, how far it has come and how long is left, with a way to cancel it", async () => {
    const user = userEvent.setup();
    const [p] = openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: p.id, stage: "inference", progress: 0.4, remainingMs: 42_000, cancel } }));
    expect(screen.getByText("Making it larger…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Making the photo larger" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("40 % done, about 40 seconds left")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upscale" })).toBeNull();
    expect(removeButton().hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows no percentage until it knows how far the work has come, and no time left before it can tell", () => {
    const [p] = openTools();
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: p.id, stage: "model", cancel: vi.fn() } }));
    expect(screen.getByText("Loading the model…")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Making the photo larger" }).getAttribute("aria-valuenow")).toBeNull();
    expect(screen.queryByText(/% done/)).toBeNull();
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: p.id, stage: "inference", progress: 0.1, cancel: vi.fn() } }));
    expect(screen.getByText("10 % done")).toBeTruthy();
  });

  it("announces only the step, not the changing percentage", () => {
    const [p] = openTools();
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: p.id, stage: "inference", progress: 0.4, remainingMs: 42_000, cancel: vi.fn() } }));
    const live = screen.getAllByRole("status");
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe("Making it larger…");
  });

  it("puts the keyboard on Cancel when the work starts, because the button that was pressed is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(upscale).mockImplementation(async (id) => {
      useMlStore.setState({ job: { kind: "upscale", elementId: id, stage: "inference", cancel: vi.fn() } });
      return new Promise(() => undefined);
    });
    openTools();
    upscaleButton().focus();
    // the dialog that may open meanwhile gives focus back to whatever carries this key, whichever of the two is on the page
    expect(upscaleButton().getAttribute("data-focus-key")).toBe("tool:upscale");
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute("data-focus-key")).toBe("tool:upscale");
  });

  it("shows the download of its own model as it happens, with a way to cancel it", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: { [spec.id]: record(spec) } });
    openTools();
    const cancel = vi.fn();
    act(() => useMlStore.setState({ installing: { [larger.id]: { phase: "downloading", received: 2_433_214, total: 4_866_428, cancel } } }));
    const mine = within(section("Upscale"));
    expect(mine.getByRole("progressbar", { name: "Downloading the model" }).getAttribute("aria-valuenow")).toBe("50");
    expect(mine.getByText(/2\.4 MB of 4\.9 MB/)).toBeTruthy();
    await user.click(mine.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not hold up the other tool while its model downloads", () => {
    useMlStore.setState({ installed: { [spec.id]: record(spec) } });
    openTools();
    act(() => useMlStore.setState({ installing: { [larger.id]: { phase: "downloading", received: 1, total: 2, cancel: vi.fn() } } }));
    expect(removeButton().hasAttribute("disabled")).toBe(false);
  });
});

describe("the original of a changed photo", () => {
  it("is offered back, once, for a photo that a tool changed, and only then", async () => {
    const user = userEvent.setup();
    const changed = photo({ src: "asset:cut", originalSrc: "asset:p" });
    openTools([changed]);
    expect(screen.getByText("Original photo kept")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore original" }));
    expect(restoreOriginal).toHaveBeenCalledWith(changed.id);
  });

  it("is not offered for an ordinary photo", () => {
    openTools();
    expect(screen.queryByRole("button", { name: "Restore original" })).toBeNull();
    expect(screen.queryByText("Original photo kept")).toBeNull();
  });

  it("is not offered while a job is working on the photo", () => {
    const changed = photo({ src: "asset:cut", originalSrc: "asset:p" });
    openTools([changed]);
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: changed.id, stage: "inference", cancel: vi.fn() } }));
    expect(screen.queryByRole("button", { name: "Restore original" })).toBeNull();
  });

  it("waits for another photo's job to end before it can be restored", () => {
    openTools([photo({ src: "asset:cut", originalSrc: "asset:p" })]);
    act(() => useMlStore.setState({ job: { kind: "upscale", elementId: "someone-else", stage: "inference", cancel: vi.fn() } }));
    expect(screen.getByRole("button", { name: "Restore original" }).hasAttribute("disabled")).toBe(true);
  });

  it("reports a failed restore", async () => {
    const user = userEvent.setup();
    vi.mocked(restoreOriginal).mockRejectedValue(new MlError("image", "The original picture is no longer available."));
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    openTools([photo({ src: "asset:cut", originalSrc: "asset:p" })]);
    await user.click(screen.getByRole("button", { name: "Restore original" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("The original picture is no longer available."));
  });
});
