import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

type StorageStub = {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};

function stubStorage(storage: StorageStub | undefined) {
  Object.defineProperty(navigator, "storage", { configurable: true, value: storage });
}

afterEach(() => {
  delete (navigator as unknown as { storage?: unknown }).storage;
});

const dialog = () => screen.getByRole("dialog", { name: "About Craftly" });

describe("<AboutDialog>", () => {
  it("renders nothing while closed", () => {
    render(<AboutDialog open={false} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells people their work stays on this device", () => {
    render(<AboutDialog open onClose={() => undefined} />);
    expect(within(dialog()).getByText("Design anything, right in your browser.")).toBeTruthy();
    expect(dialog().textContent).toContain("Everything you make here is stored on this device.");
    expect(dialog().textContent).toContain("nothing is sent to a server or an account");
    expect(dialog().textContent).toContain("download the designs you care about");
  });

  it("is plain about the one thing that is downloaded: each AI model, once, with permission", () => {
    render(<AboutDialog open onClose={() => undefined} />);
    const text = dialog().textContent!;
    expect(text).toContain("The AI photo tools are the one exception");
    expect(text).toContain("download each model once");
    expect(text).toContain("never sent");
  });

  it("names the host the models come from, which is another one when the app was built with a mirror", () => {
    vi.stubEnv("VITE_CRAFTLY_MODEL_BASE", "https://models.example.org/craftly");
    try {
      render(<AboutDialog open onClose={() => undefined} />);
      expect(dialog().textContent).toContain("models.example.org");
      expect(dialog().textContent).not.toContain("huggingface.co");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("closes from the Close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AboutDialog open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("storage status", () => {
    it("shows a plain line when the browser cannot report storage", async () => {
      stubStorage(undefined);
      render(<AboutDialog open onClose={() => undefined} />);
      await waitFor(() => expect(dialog().textContent).toContain("Local browser storage"));
      expect(within(dialog()).getByText("Stored on this device")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Protect" })).toBeNull();
    });

    it("shows how much is stored and that it is protected", async () => {
      stubStorage({ estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }), persisted: async () => true });
      render(<AboutDialog open onClose={() => undefined} />);
      expect(await within(dialog()).findByText("5.0 MB stored on this device")).toBeTruthy();
      expect(dialog().textContent).toContain("Protected: your browser will not clear it automatically.");
      expect(screen.queryByRole("button", { name: "Protect" })).toBeNull();
    });

    it("warns that unprotected storage may be cleared, and offers to protect it", async () => {
      let persisted = false;
      const persist = vi.fn(async () => {
        persisted = true;
        return true;
      });
      stubStorage({ estimate: async () => ({ usage: 2048 }), persisted: async () => persisted, persist });
      const user = userEvent.setup();
      render(<AboutDialog open onClose={() => undefined} />);
      expect(await within(dialog()).findByText("2.0 KB stored on this device")).toBeTruthy();
      expect(dialog().textContent).toContain("Your browser may clear it when the device is low on space.");
      await user.click(screen.getByRole("button", { name: "Protect" }));
      await waitFor(() => expect(dialog().textContent).toContain("Protected: your browser will not clear it automatically."));
      expect(persist).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Protect" })).toBeNull();
    });

    it("keeps showing the status when the browser refuses to protect the storage", async () => {
      const persist = vi.fn(async () => {
        throw new Error("denied");
      });
      stubStorage({ estimate: async () => ({ usage: 100 }), persisted: async () => false, persist });
      const user = userEvent.setup();
      render(<AboutDialog open onClose={() => undefined} />);
      await user.click(await screen.findByRole("button", { name: "Protect" }));
      await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
      await waitFor(() => expect((screen.getByRole("button", { name: "Protect" }) as HTMLButtonElement).getAttribute("aria-busy")).toBeNull());
      expect(dialog().textContent).toContain("Your browser may clear it when the device is low on space.");
    });

    it("shows a busy button while the browser decides", async () => {
      let answer: (value: boolean) => void = () => undefined;
      const persist = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
      stubStorage({ estimate: async () => ({ usage: 100 }), persisted: async () => false, persist });
      const user = userEvent.setup();
      render(<AboutDialog open onClose={() => undefined} />);
      await user.click(await screen.findByRole("button", { name: "Protect" }));
      expect(screen.getByRole("button", { name: "Protect" }).getAttribute("aria-busy")).toBe("true");
      answer(false);
      await waitFor(() => expect(screen.getByRole("button", { name: "Protect" }).getAttribute("aria-busy")).toBeNull());
    });

    it("copes with a browser that has no persist() and with failing queries", async () => {
      stubStorage({ estimate: () => Promise.reject(new Error("no")), persisted: () => Promise.reject(new Error("no")) });
      render(<AboutDialog open onClose={() => undefined} />);
      await waitFor(() => expect(dialog().textContent).toContain("Local browser storage"));
      expect(within(dialog()).getByText("Stored on this device")).toBeTruthy();
    });

    it("copes with a browser that offers storage but neither estimate nor persisted", async () => {
      stubStorage({});
      render(<AboutDialog open onClose={() => undefined} />);
      await waitFor(() => expect(dialog().textContent).toContain("Local browser storage"));
    });

    it("lets people protect storage even when persist() is missing", async () => {
      stubStorage({ estimate: async () => ({ usage: 100 }), persisted: async () => false });
      const user = userEvent.setup();
      render(<AboutDialog open onClose={() => undefined} />);
      await user.click(await screen.findByRole("button", { name: "Protect" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Protect" }).getAttribute("aria-busy")).toBeNull());
    });

    it("does not show a status that arrives after the dialog was closed", async () => {
      let finish: (value: { usage: number }) => void = () => undefined;
      stubStorage({ estimate: () => new Promise((resolve) => (finish = resolve)), persisted: async () => true });
      const { rerender } = render(<AboutDialog open onClose={() => undefined} />);
      rerender(<AboutDialog open={false} onClose={() => undefined} />);
      await new Promise((resolve) => setTimeout(resolve, 250));
      finish({ usage: 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
