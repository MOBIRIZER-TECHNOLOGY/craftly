/**
 * The sync status beside the account menu and in the editor's top bar: its icon and words follow the state the engine writes,
 * a problem, going offline and changes held by a live room are announced, and its panel runs the engine again on Sync now.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySession, saveSession } from "@/cloud/state";
import { useSyncStatus, type SyncStatus as Status } from "@/cloud/syncStatus";
import { Hosts } from "@/test/dashuiUtils";
import { SyncStatus } from "./SyncStatus";

const engine = vi.hoisted(() => ({ syncNow: vi.fn<() => Promise<void>>() }));
vi.mock("@/cloud/sync", () => engine);

const ANN = { id: "u_ann", email: "ann@example.org", name: "Ann" };

const status = (next: Partial<Status>) => act(() => useSyncStatus.setState({ state: "synced", waiting: 0, problem: null, lastSyncedAt: null, ...next }));

beforeEach(() => {
  engine.syncNow.mockReset().mockResolvedValue(undefined);
  act(() => applySession({ server: "https://accounts.example.org", token: "T".repeat(43), user: ANN, device: "Test", teams: [], activeSpace: ANN.id }));
});

afterEach(async () => {
  status({ state: "off" });
  await act(async () => saveSession(null));
});

const mount = (props: { compact?: boolean } = {}) =>
  render(
    <>
      <SyncStatus {...props} />
      <Hosts />
    </>,
  );

describe("<SyncStatus>", () => {
  it("shows nothing while nobody is signed in, or while sync is off", async () => {
    status({ state: "off" });
    const { container, rerender } = mount();
    expect(container.querySelector(".cf-syncstatus")).toBeNull();
    status({ state: "synced" });
    await act(async () => saveSession(null));
    rerender(<SyncStatus />);
    expect(container.querySelector(".cf-syncstatus")).toBeNull();
  });

  it.each<[Partial<Status>, string, boolean]>([
    [{ state: "synced" }, "Synced", false],
    [{ state: "syncing" }, "Syncing…", false],
    [{ state: "offline", waiting: 0 }, "Offline", true],
    [{ state: "offline", waiting: 3 }, "Offline, 3 changes waiting", true],
    [{ state: "live", waiting: 1 }, "1 change waiting: the design is being edited live", true],
    [{ state: "problem", problem: "The server refused the change." }, "The server refused the change.", true],
    [{ state: "problem" }, "Sync has a problem", true],
  ])("for %j says “%s” on the button, and announces it only when the person should know at once (%s)", (next, words, announced) => {
    status(next);
    mount();
    const button = screen.getByRole("button", { name: `Sync: ${words}` });
    expect(button.classList.contains(`is-${next.state}`)).toBe(true);
    expect(button.textContent).toBe(words);
    expect(screen.getByRole("status").textContent).toBe(announced ? words : "");
  });

  it("keeps only the icon in the compact form, with the words in its name", () => {
    status({ state: "offline", waiting: 2 });
    mount({ compact: true });
    const button = screen.getByRole("button", { name: "Sync: Offline, 2 changes waiting" });
    expect(button.classList.contains("is-compact")).toBe(true);
    expect(button.textContent).toBe("");
  });

  it("opens a panel with the state and when it last synced, and Sync now runs the engine, once at a time", async () => {
    status({ state: "synced", lastSyncedAt: Date.UTC(2026, 10, 21, 9, 30) });
    let finish = () => undefined as void;
    engine.syncNow.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Sync: Synced" }));
    const panel = await screen.findByRole("dialog", { name: "Sync details" });
    expect(within(panel).getByText("Synced")).toBeTruthy();
    expect(within(panel).getByText(/^Last synced /)).toBeTruthy();
    const syncNow = within(panel).getByRole("button", { name: "Sync now" }) as HTMLButtonElement;
    await user.click(syncNow);
    await waitFor(() => expect(engine.syncNow).toHaveBeenCalledTimes(1));
    // while the run goes on, the button waits for it
    expect(syncNow.disabled).toBe(true);
    await act(async () => finish());
    await waitFor(() => expect(syncNow.disabled).toBe(false));
    // a run that fails says so in the status (the engine writes it), so the button only gets ready again
    engine.syncNow.mockRejectedValueOnce(new Error("offline"));
    await user.click(syncNow);
    await waitFor(() => expect(engine.syncNow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(syncNow.disabled).toBe(false));
  });

  it("offers no Sync now while a run is going on, and no time before the first run", async () => {
    status({ state: "syncing" });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Sync: Syncing…" }));
    const panel = await screen.findByRole("dialog", { name: "Sync details" });
    expect((within(panel).getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).queryByText(/^Last synced /)).toBeNull();
  });
});
