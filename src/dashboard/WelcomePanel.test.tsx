import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloud, type CloudSession } from "@/cloud/state";
import { firstRunKey, isFirstRunDone, resetFirstRun } from "@/components/firstRun";
import { listDesigns, moveToTrash } from "@/core/library";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, resetDashboardStores, seedDesign, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeCreateDialog, useCreateDialog } from "./createDialogState";
import { Home } from "./Home";
import { isProjectFile } from "./openFile";
import { WelcomePanel } from "./WelcomePanel";

const welcome = () => screen.findByRole("region", { name: "Welcome to Craftly" });
const ways = () => within(screen.getByRole("list", { name: "Ways to begin" })).getAllByRole("button");

beforeEach(async () => {
  resetFirstRun();
  await emptyLibrary();
  await resetDashboardStores();
  window.location.hash = "#/";
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    toast.clear();
    useCloud.setState({ session: null });
  });
  await emptyLibrary();
  resetFirstRun();
  vi.unstubAllEnvs();
});

describe("<WelcomePanel> on a first visit", () => {
  it("greets a library with no designs: a heading under the page's, three ways to begin, and where the work is kept", async () => {
    render(<Home />);
    const panel = await welcome();
    expect(within(panel).getByRole("heading", { level: 2, name: "Welcome to Craftly" })).toBeTruthy();
    expect(ways().map((way) => way.querySelector(".cf-welcome__way-title")?.textContent)).toEqual(["Start from a blank size", "Start from a template", "Open a file"]);
    expect(within(panel).getByText(/Your work stays on this device, and Craftly keeps working offline/)).toBeTruthy();
    // no account server was built in: nothing about signing in
    expect(within(panel).queryByRole("button", { name: /Sign in/ })).toBeNull();
    // it sits above the shortcut row, which stays as it was
    expect(panel.compareDocumentPosition(screen.getByRole("group", { name: "Start a design" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the Create dialog for a blank size", async () => {
    const user = userEvent.setup();
    render(
      <>
        <WelcomePanel />
        <Hosts />
      </>,
    );
    const dialog = renderHook(() => useCreateDialog());
    await welcome();
    await user.click(ways()[0]);
    expect(dialog.result.current.open).toBe(true);
  });

  it("goes to the templates for a template", async () => {
    const user = userEvent.setup();
    render(<WelcomePanel />);
    await welcome();
    await user.click(ways()[1]);
    expect(window.location.hash).toBe("#/templates");
  });

  it("starts a design from a picture chosen with Open a file, and offers project files in the same picker", async () => {
    const user = userEvent.setup();
    const picker = stubFilePicker([imageFile("sunset.png")]);
    render(<WelcomePanel />);
    await welcome();
    await user.click(ways()[2]);
    expect(picker.lastAccept()).toContain(".craftly");
    expect(picker.lastAccept()).toContain("image/png");
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].title).toBe("sunset");
  });

  it("tells a project file from a picture", () => {
    expect(isProjectFile(new File(["{}"], "poster.craftly"))).toBe(true);
    expect(isProjectFile(new File(["{}"], "POSTER.JSON"))).toBe(true);
    expect(isProjectFile(new File(["{}"], "data", { type: "application/json" }))).toBe(true);
    expect(isProjectFile(imageFile("photo.png"))).toBe(false);
  });

  it("is put away by its close button, for good, and the keyboard stays where it was", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Home />);
    await welcome();
    const close = screen.getByRole("button", { name: "Dismiss the welcome" });
    close.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull());
    expect(document.activeElement?.classList.contains("cf-welcome-slot")).toBe(true);
    expect(localStorage.getItem(firstRunKey("welcome"))).toBe("1");
    unmount();
    // the next visit to Home, with the library still empty
    render(<Home />);
    await screen.findByRole("region", { name: "Popular on Craftly" });
    expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull();
  });
});

describe("<WelcomePanel> for a returning person", () => {
  it("is not shown when there is a design", async () => {
    await seedDesign({ title: "Made before" });
    render(<Home />);
    await screen.findByRole("region", { name: "Recent designs" });
    expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull();
  });

  it("is not shown when the only design is in the trash", async () => {
    const design = await seedDesign({ title: "Thrown away" });
    await moveToTrash(design.id);
    render(<Home />);
    await screen.findByRole("region", { name: "Popular on Craftly" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull();
  });

  it("goes by itself once the first design is made, without being marked as dismissed", async () => {
    render(<WelcomePanel />);
    await welcome();
    await act(async () => {
      await seedDesign({ title: "First one" });
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull());
    expect(isFirstRunDone("welcome")).toBe(false);
  });

  it("is not shown to somebody who is signed in", async () => {
    act(() => useCloud.setState({ session: { user: { id: "u".repeat(20), name: "Asha", email: "asha@example.org" }, teams: [] } as unknown as CloudSession }));
    render(<Home />);
    await screen.findByRole("region", { name: "Popular on Craftly" });
    expect(screen.queryByRole("region", { name: "Welcome to Craftly" })).toBeNull();
  });
});

describe("<WelcomePanel> with an account server built in", () => {
  it("offers to sign in to sync, and nothing more", async () => {
    vi.stubEnv("VITE_CRAFTLY_ACCOUNT_SERVER", "https://accounts.example.org");
    vi.resetModules();
    const fresh = await import("./WelcomePanel");
    const user = userEvent.setup();
    render(<fresh.WelcomePanel />);
    const panel = await screen.findByRole("region", { name: "Welcome to Craftly" });
    await user.click(within(panel).getByRole("button", { name: "Sign in to sync" }));
    expect(window.location.hash).toBe("#/signin");
  });
});
