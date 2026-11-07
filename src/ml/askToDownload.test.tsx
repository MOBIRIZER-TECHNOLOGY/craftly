import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmHost } from "@/ui";
import { askToDownload } from "./askToDownload";
import { getModelSpec } from "./registry";

const spec = getModelSpec("isnet-general")!;

/** Asks, and waits until the question is on screen. */
async function ask() {
  render(<ConfirmHost />);
  const answer = askToDownload(spec);
  const dialog = await screen.findByRole("dialog");
  return { answer, dialog };
}

describe("askToDownload", () => {
  it("says what is downloaded, from where, and that photos stay on the device", async () => {
    const { answer, dialog } = await ask();
    expect(dialog.textContent).toContain("88.1 MB");
    expect(dialog.textContent).toContain("huggingface.co");
    expect(dialog.textContent).toMatch(/never uploaded/);
    expect(dialog.textContent).toContain("Apache-2.0");
    // the question queue is shared by the whole page: settle it so the next test starts clean
    await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
    await answer;
  });

  it("starts on 'Not now', so a held or doubled Enter key cannot agree to a download of 88.1 MB by accident", async () => {
    const { answer } = await ask();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not now" }));
    await userEvent.setup().keyboard("{Enter}");
    await expect(answer).resolves.toBe(false);
  });

  it("names the mirror, not Hugging Face, when the app was built to download from one", async () => {
    vi.stubEnv("VITE_CRAFTLY_MODEL_BASE", "https://models.example.org/craftly");
    try {
      const { answer, dialog } = await ask();
      expect(dialog.textContent).toContain("models.example.org");
      expect(dialog.textContent).not.toContain("huggingface.co");
      await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
      await answer;
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves true when the person agrees", async () => {
    const { answer } = await ask();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download 88.1 MB" }));
    expect(await answer).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("resolves false when the person declines", async () => {
    const { answer } = await ask();
    await userEvent.setup().click(screen.getByRole("button", { name: "Not now" }));
    expect(await answer).toBe(false);
  });
});
