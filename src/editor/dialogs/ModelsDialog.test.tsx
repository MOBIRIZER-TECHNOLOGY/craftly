import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSupport } from "@/ml/device";
import { MlError } from "@/ml/errors";
import { getModelSpec } from "@/ml/registry";
import { importModelFile, installModel, refreshModels, removeModel } from "@/ml/service";
import { useMlStore } from "@/ml/state";
import { ConfirmHost, toast } from "@/ui";
import { ModelsDialog } from "./ModelsDialog";

vi.mock("@/ml/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ml/service")>()),
  installModel: vi.fn(async () => ({})),
  removeModel: vi.fn(async () => undefined),
  importModelFile: vi.fn(async () => undefined),
  refreshModels: vi.fn(async () => undefined),
}));
vi.mock("@/ml/device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ml/device")>()),
  checkSupport: vi.fn(async () => ({ ok: true })),
}));

const spec = getModelSpec("isnet-general")!;
const upscaler = getModelSpec("realesrgan-general")!;
const record = (sha256 = spec.sha256) => ({ id: spec.id, sha256, bytes: spec.bytes, revision: spec.revision, installedAt: 1 });
/** The list entry of one model, found by its name. */
const row = (name: string) => screen.getByText(name, { selector: "strong" }).closest("li") as HTMLElement;

beforeEach(() => {
  vi.mocked(installModel).mockReset().mockResolvedValue({});
  vi.mocked(removeModel).mockReset().mockResolvedValue(undefined);
  vi.mocked(importModelFile).mockReset().mockResolvedValue({});
  vi.mocked(refreshModels).mockReset().mockResolvedValue(undefined);
  vi.mocked(checkSupport).mockReset().mockResolvedValue({ ok: true });
  useMlStore.setState({ loaded: true, installed: {}, installing: {}, job: null, storage: {} });
});

function open() {
  const onClose = vi.fn();
  render(
    <>
      <ModelsDialog open onClose={onClose} />
      <ConfirmHost />
    </>,
  );
  return { onClose, dialog: () => screen.getByRole("dialog", { name: "On-device models" }) };
}

describe("the On-device models dialog", () => {
  it("renders nothing while closed", () => {
    render(<ModelsDialog open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads what is installed when it opens", () => {
    open();
    expect(refreshModels).toHaveBeenCalled();
  });

  it("describes each model: what it does, its size, its licence and where it comes from", () => {
    open();
    const remover = row("ISNet general-use");
    expect(remover.textContent).toContain("so it can be cut out, or the background behind it blurred or turned black and white");
    expect(remover.textContent).toContain("Used by the Background remover.");
    expect(remover.textContent).toContain("88.1 MB");
    expect(remover.textContent).toContain("Apache-2.0 licence");
    expect(remover.textContent).toContain(spec.licence.notice);
    expect(within(remover).getByRole("link", { name: "Licence" }).getAttribute("href")).toBe(spec.licence.url);
    const source = within(remover).getByRole("link", { name: "Source" });
    expect(source.getAttribute("href")).toBe(spec.credit.url);
    expect(source.getAttribute("rel")).toContain("noopener");

    const larger = row("Real-ESRGAN general x4 v3");
    expect(larger.textContent).toContain("Used by the Upscaler.");
    expect(larger.textContent).toContain("4.9 MB");
    expect(larger.textContent).toContain("BSD-3-Clause licence");
    expect(larger.textContent).toContain("Copyright (c) 2021, Xintao Wang");
    expect(within(larger).getByRole("link", { name: "Licence" }).getAttribute("href")).toBe(upscaler.licence.url);
    expect(within(larger).getByRole("link", { name: "Source" }).getAttribute("href")).toBe(upscaler.credit.url);
  });

  it("says in plain words that photos stay on the device", () => {
    const { dialog } = open();
    expect(dialog().textContent).toMatch(/never uploaded/);
  });

  it.each([
    ["not downloaded", {}, "Not downloaded"],
    ["installed", { [spec.id]: record() }, "Installed"],
    ["outdated", { [spec.id]: record("0".repeat(64)) }, "Needs update"],
  ])("shows a model that is %s", (_name, installed, badge) => {
    useMlStore.setState({ installed });
    open();
    expect(within(row("ISNet general-use")).getByText(badge)).toBeTruthy();
  });

  it("keeps the models apart: one installed does not make the other look installed", () => {
    useMlStore.setState({ installed: { [spec.id]: record() } });
    open();
    expect(within(row("ISNet general-use")).getByText("Installed")).toBeTruthy();
    expect(within(row("Real-ESRGAN general x4 v3")).getByText("Not downloaded")).toBeTruthy();
    expect(within(row("Real-ESRGAN general x4 v3")).getByRole("button", { name: "Download 4.9 MB" })).toBeTruthy();
  });

  it("downloads the upscaler by its own button", async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    open();
    await user.click(screen.getByRole("button", { name: "Download 4.9 MB" }));
    expect(installModel).toHaveBeenCalledWith(upscaler.id);
    await waitFor(() => expect(success).toHaveBeenCalledWith("Real-ESRGAN general x4 v3 is ready."));
  });

  it("downloads a model, tells the person when it is ready, and offers nothing else to do with it", async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    open();
    await user.click(screen.getByRole("button", { name: "Download 88.1 MB" }));
    expect(installModel).toHaveBeenCalledWith(spec.id);
    await waitFor(() => expect(success).toHaveBeenCalledWith("ISNet general-use is ready."));
  });

  it("keeps the model but says so when it could not be tried out on this device", async () => {
    const user = userEvent.setup();
    vi.mocked(installModel).mockResolvedValue({ warmError: new MlError("out-of-memory") });
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    open();
    await user.click(screen.getByRole("button", { name: "Download 88.1 MB" }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(String(error.mock.calls[0]![0])).toMatch(/downloaded/i);
    expect(String(error.mock.calls[0]![0])).toContain("graphics memory");
  });

  it("shows why a download failed, and says nothing when the person cancelled it", async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    open();
    vi.mocked(installModel).mockRejectedValueOnce(new MlError("network"));
    await user.click(screen.getByRole("button", { name: "Download 88.1 MB" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("The download was interrupted. Check your connection and try again."));
    vi.mocked(installModel).mockRejectedValueOnce(new MlError("aborted"));
    await user.click(screen.getByRole("button", { name: "Download 88.1 MB" }));
    await waitFor(() => expect(installModel).toHaveBeenCalledTimes(2));
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("shows the download as it happens and lets the person stop it", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 22_035_278, total: 88_141_111, cancel } } });
    open();
    expect(screen.getByRole("progressbar", { name: "Downloading ISNet general-use" }).getAttribute("aria-valuenow")).toBe("25");
    expect(within(row("ISNet general-use")).queryByRole("button", { name: /^Download/ })).toBeNull();
    expect(within(row("Real-ESRGAN general x4 v3")).getByRole("button", { name: /^Download/ })).toBeTruthy(); // the other model is not affected
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("removes a model only after the person confirms", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: { [spec.id]: record() } });
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    open();
    await user.click(screen.getByRole("button", { name: "Remove ISNet general-use" }));
    const confirm = await screen.findByText("Remove the model?");
    expect(confirm).toBeTruthy();
    expect(removeModel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeModel).toHaveBeenCalledWith(spec.id));
    await waitFor(() => expect(success).toHaveBeenCalledWith("ISNet general-use was removed."));
  });

  it("keeps the model when the person changes their mind", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: { [spec.id]: record() } });
    open();
    await user.click(screen.getByRole("button", { name: "Remove ISNet general-use" }));
    await user.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(removeModel).not.toHaveBeenCalled();
  });

  it("says so when a model could not be removed", async () => {
    const user = userEvent.setup();
    useMlStore.setState({ installed: { [spec.id]: record() } });
    vi.mocked(removeModel).mockRejectedValue(new MlError("storage"));
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    open();
    await user.click(screen.getByRole("button", { name: "Remove ISNet general-use" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("The browser would not store the model. Private windows often block this."));
  });

  it("does nothing when the file chooser is closed without a file", async () => {
    const { dialog } = open();
    const input = within(dialog()).getByLabelText("Choose a model file for ISNet general-use") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(importModelFile).not.toHaveBeenCalled();
  });

  it("opens the file chooser from the 'Add from a file' button", async () => {
    const user = userEvent.setup();
    const { dialog } = open();
    const input = within(dialog()).getByLabelText("Choose a model file for ISNet general-use") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    await user.click(within(row("ISNet general-use")).getByRole("button", { name: "Add from a file" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("adds a model from a file, for a computer that is offline", async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    const { dialog } = open();
    const file = new File([new Uint8Array([1, 2, 3])], "model.onnx");
    await user.upload(within(dialog()).getByLabelText("Choose a model file for ISNet general-use"), file);
    await waitFor(() => expect(importModelFile).toHaveBeenCalledWith(spec.id, file));
    await waitFor(() => expect(success).toHaveBeenCalledWith("ISNet general-use was added from the file."));
  });

  it("keeps a file that was added but says so when the engine could not be prepared", async () => {
    const user = userEvent.setup();
    vi.mocked(importModelFile).mockResolvedValue({ warmError: new MlError("engine") });
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    const { dialog } = open();
    await user.upload(within(dialog()).getByLabelText("Choose a model file for ISNet general-use"), new File(["x"], "model.onnx"));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(String(error.mock.calls[0]![0])).toContain("was added from the file");
    expect(String(error.mock.calls[0]![0])).toContain("engine could not be loaded");
  });

  it("shows that a file is being added, and does not take a second one meanwhile", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.mocked(importModelFile).mockReturnValue(new Promise((resolve) => (finish = () => resolve({}))));
    const { dialog } = open();
    await user.upload(within(dialog()).getByLabelText("Choose a model file for ISNet general-use"), new File(["x"], "model.onnx"));
    const add = await screen.findByRole("button", { name: /Adding/ });
    expect(add.hasAttribute("disabled") || add.getAttribute("aria-busy") === "true").toBe(true);
    finish();
    await waitFor(() => expect(within(row("ISNet general-use")).getByRole("button", { name: "Add from a file" }).hasAttribute("disabled")).toBe(false));
  });

  it("says when the file is not the model", async () => {
    const user = userEvent.setup();
    vi.mocked(importModelFile).mockRejectedValue(new MlError("hash"));
    const error = vi.spyOn(toast, "error").mockReturnValue(1);
    const { dialog } = open();
    await user.upload(within(dialog()).getByLabelText("Choose a model file for ISNet general-use"), new File(["x"], "other.onnx"));
    await waitFor(() => expect(error).toHaveBeenCalledWith("The file does not match the expected checksum, so it was not used."));
  });

  it("explains a browser that cannot run the models, without hiding what is installed", async () => {
    vi.mocked(checkSupport).mockResolvedValue({ ok: false, reason: "no-webgpu", message: "This browser doesn't support WebGPU." });
    useMlStore.setState({ installed: { [spec.id]: record() } });
    const { dialog } = open();
    expect(await within(dialog()).findByText("This browser doesn't support WebGPU.")).toBeTruthy();
    expect(within(dialog()).getByText("Installed")).toBeTruthy();
  });

  it("shows the room left on the device and whether the browser will keep the models", () => {
    useMlStore.setState({ storage: { usage: 250_000_000, quota: 4_000_000_000, persisted: true } });
    const { dialog } = open();
    expect(dialog().textContent).toContain("250.0 MB of 4.0 GB used");
    expect(dialog().textContent).toMatch(/kept/i);
  });

  it("warns when the browser may clear the models to make room", () => {
    useMlStore.setState({ storage: { usage: 1, quota: 1000, persisted: false } });
    const { dialog } = open();
    expect(dialog().textContent).toMatch(/may remove/i);
  });

  it("closes with Done", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers nothing to download in a browser that cannot run the models, and says so once", async () => {
    vi.mocked(checkSupport).mockResolvedValue({ ok: false, reason: "no-webgpu", message: "This browser doesn't support WebGPU." });
    const { dialog } = open();
    await within(dialog()).findByText("This browser doesn't support WebGPU.");
    expect(within(dialog()).getAllByText("This browser doesn't support WebGPU.")).toHaveLength(1);
    for (const button of screen.getAllByRole("button", { name: /^Download/ })) expect(button.hasAttribute("disabled")).toBe(true);
    for (const button of screen.getAllByRole("button", { name: "Add from a file" })) expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Add from a file" })).toHaveLength(2);
  });

  it("holds back only the model whose graphics-card feature is missing, and says why", async () => {
    const half = "This graphics card can't do half-precision maths, which the model needs.";
    vi.mocked(checkSupport).mockImplementation(async (_env, needs = []) => (needs.includes("shader-f16") ? { ok: false, reason: "missing-feature", message: half } : { ok: true }));
    open();
    const remover = row("ISNet general-use");
    await within(remover).findByText(half);
    expect(within(remover).getByRole("button", { name: "Download 88.1 MB" }).hasAttribute("disabled")).toBe(true);
    expect(within(remover).getByRole("button", { name: "Add from a file" }).hasAttribute("disabled")).toBe(true);
    const larger = row("Real-ESRGAN general x4 v3"); // needs nothing special: it stays available
    expect(within(larger).queryByText(half)).toBeNull();
    expect(within(larger).getByRole("button", { name: "Download 4.9 MB" }).hasAttribute("disabled")).toBe(false);
    expect(within(larger).getByRole("button", { name: "Add from a file" }).hasAttribute("disabled")).toBe(false);
  });

  it("lets the person stop while the engine is being prepared", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    useMlStore.setState({ installing: { [spec.id]: { phase: "preparing", received: 1, total: 1, cancel } } });
    open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("announces only the step, not the changing sizes", () => {
    useMlStore.setState({ installing: { [spec.id]: { phase: "downloading", received: 5_000_000, total: 88_141_111, cancel: vi.fn() } } });
    open();
    const live = screen.getAllByRole("status");
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe("Downloading the model");
  });

  it("puts the keyboard on Cancel once the download starts, because the button that started it is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(installModel).mockImplementation(async (id) => {
      useMlStore.setState({ installing: { [id]: { phase: "downloading", received: 0, total: 88_141_111, cancel: vi.fn() } } });
      return new Promise(() => undefined);
    });
    open();
    screen.getByRole("button", { name: "Download 88.1 MB" }).focus();
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
  });

  it("follows the store: a download started elsewhere shows up here", () => {
    open();
    expect(screen.getByRole("button", { name: "Download 88.1 MB" })).toBeTruthy();
    act(() => useMlStore.setState({ installing: { [spec.id]: { phase: "saving", received: 1, total: 1, cancel: () => undefined } } }));
    expect(screen.queryByRole("button", { name: "Download 88.1 MB" })).toBeNull();
    expect(screen.getByText("Saving the model…")).toBeTruthy();
  });
});
