import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseWatcher } from "@/core/persistence";
import { toast, ToastHost } from "@/ui";
import { BLOCKED_NOTICE, installDatabaseNotices, REPLACED_NOTICE } from "./databaseNotices";
import { settleSaves } from "./settleSaves";

/** What the notices ask the database layer to tell them, and when the tab was asked to give its connection up. */
let watcher: DatabaseWatcher | null = null;
const stop = vi.fn();

vi.mock("@/core/persistence", () => ({
  watchDatabase: vi.fn((given: DatabaseWatcher) => {
    watcher = given;
    return stop;
  }),
}));
vi.mock("./settleSaves", () => ({ settleSaves: vi.fn(async () => undefined) }));

beforeEach(() => {
  watcher = null;
  stop.mockClear();
  vi.mocked(settleSaves).mockReset().mockResolvedValue("saved");
  render(<ToastHost />);
});

afterEach(async () => {
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
});

const notice = (text: string) => screen.queryByText(text);

describe("when another tab keeps an upgrade of the database waiting", () => {
  it("tells the person to close or reload it, once, and takes the notice away when the wait is over", async () => {
    installDatabaseNotices();
    act(() => watcher!.blocked!());
    act(() => watcher!.blocked!());
    expect(screen.getAllByText(BLOCKED_NOTICE)).toHaveLength(1);
    act(() => watcher!.unblocked!());
    await waitFor(() => expect(notice(BLOCKED_NOTICE)).toBeNull());
    // and a later wait is told again
    act(() => watcher!.blocked!());
    expect(notice(BLOCKED_NOTICE)).toBeTruthy();
  });

  it("has nothing to take away when no wait was announced", () => {
    installDatabaseNotices();
    expect(() => act(() => watcher!.unblocked!())).not.toThrow();
  });
});

describe("when another tab upgrades the database under this one", () => {
  it("writes what is unsaved, then asks for a reload", async () => {
    const reload = vi.fn();
    installDatabaseNotices({ reload });
    let saved!: () => void;
    vi.mocked(settleSaves).mockImplementation(() => new Promise<"saved">((resolve) => (saved = () => resolve("saved"))));

    let answered = false;
    const replaced = Promise.resolve(watcher!.replaced!()).then(() => (answered = true));
    await Promise.resolve();
    expect(settleSaves).toHaveBeenCalledWith(2000);
    expect(answered).toBe(false);
    expect(notice(REPLACED_NOTICE)).toBeNull();

    await act(async () => {
      saved();
      await replaced;
    });
    expect(notice(REPLACED_NOTICE)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads the page itself when no other way is given", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    try {
      installDatabaseNotices();
      await act(async () => {
        await watcher!.replaced!();
      });
      await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the notice until it is dismissed", async () => {
    installDatabaseNotices();
    await act(async () => {
      await watcher!.replaced!();
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(notice(REPLACED_NOTICE)).toBeTruthy();
  });
});

describe("installDatabaseNotices", () => {
  it("stops listening when it is uninstalled", () => {
    const uninstall = installDatabaseNotices();
    expect(stop).not.toHaveBeenCalled();
    uninstall();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
