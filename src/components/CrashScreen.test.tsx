/** The screen that replaces Craftly when it stops: what happened, how to get back to work, and how to get a design out. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import * as library from "@/core/library";
import { saveDesign } from "@/core/library";
import { clearProblems, recordProblem } from "@/core/problems";
import { wipeDatabase } from "@/test/logicDb";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost } from "@/ui";
import { CrashScreen } from "./CrashScreen";

const reload = vi.fn();
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(async () => {
  await wipeDatabase();
  localStorage.clear();
  clearProblems();
  clearToasts();
  reload.mockReset();
  vi.stubGlobal("location", { ...window.location, reload, hash: "#/design/x" });
});

const storedDesign = async (elements = 2, updatedAt = Date.UTC(2026, 10, 9, 7, 41)) => {
  const base = createDesign({
    title: "Poster",
    width: 800,
    height: 600,
    pages: [createPage({ elements: Array.from({ length: elements }, () => createShape("rect", { width: 5, height: 5 })) })],
  });
  const design = { ...base, updatedAt };
  await saveDesign(design);
  return design;
};

const show = (extra: Partial<Parameters<typeof CrashScreen>[0]> = {}) => {
  const error = new Error("Cannot read properties of undefined (reading 'x')");
  const problem = recordProblem("screen", error, { now: 1_000 });
  return render(
    <>
      <CrashScreen error={error} problem={problem} designId={null} crashes={0} onGoToProjects={vi.fn()} {...extra} />
      <ToastHost />
    </>,
  );
};

describe("<CrashScreen> away from a design", () => {
  it("says calmly what happened, shows the message and offers the two ways on", () => {
    show();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(alert.textContent).toContain("Your designs are saved on this device");
    expect(alert.querySelector("pre")?.textContent).toBe("Cannot read properties of undefined (reading 'x')");
    expect(screen.getByRole("button", { name: "Reload Craftly" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to your projects" })).toBeTruthy();
  });

  it("puts the keyboard on the first button, because the screen it was on is gone", () => {
    show();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reload Craftly" }));
  });

  it("reloads from the first button and goes home from the second", () => {
    const onGoToProjects = vi.fn();
    show({ onGoToProjects });
    fireEvent.click(screen.getByRole("button", { name: "Reload Craftly" }));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Go to your projects" }));
    expect(onGoToProjects).toHaveBeenCalledTimes(1);
  });

  it("has the report of the problem to read, copy or download, folded away", () => {
    show();
    const details = screen.getByText("Report this problem").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByLabelText("What a report holds").textContent).toContain('"kind": "screen"');
  });

  it("has no report when none was written down, and no earlier versions to offer", () => {
    show({ problem: null });
    expect(screen.queryByText("Report this problem")).toBeNull();
    expect(screen.queryByText("Go back to an earlier version")).toBeNull();
  });

  it("says that a part of Craftly could not load, and that a reload may be all it takes, when that is what happened", () => {
    show({ error: new Error("Failed to fetch dynamically imported module: https://x/y.js") });
    expect(screen.getByRole("heading", { name: "A part of Craftly could not load" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Check your connection, then reload. Your designs are saved on this device.");
  });
});

describe("<CrashScreen> on a design", () => {
  it("says when the design was last saved, and that reloading should bring the person back", async () => {
    const design = await storedDesign();
    show({ designId: design.id, crashes: 1 });
    expect(await screen.findByText(new RegExp(`last saved at ${escape(time.format(design.updatedAt))}`))).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Craftly stopped unexpectedly.");
    expect(screen.getByText("Go back to an earlier version").closest("details")!.open).toBe(false);
  });

  it("says that it stopped again, and opens the earlier versions, when the design keeps stopping it", async () => {
    const design = await storedDesign();
    show({ designId: design.id, crashes: 2 });
    expect(screen.getByRole("alert").textContent).toContain("Craftly stopped again when this design was opened.");
    expect(screen.getByText("Go back to an earlier version").closest("details")!.open).toBe(true);
  });

  it("has the way back for the design on it: its earlier versions and a copy of it to save", async () => {
    const design = await storedDesign();
    show({ designId: design.id, crashes: 2 });
    expect(await screen.findByText("There are no earlier versions of this design yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a copy of the design to a file" })).toBeTruthy();
  });

  it("still says what happened, with no saved time and nothing to go back to, when the library cannot be read", async () => {
    const summary = vi.spyOn(library, "getSummary").mockRejectedValueOnce(new Error("The library is not available"));
    const versions = vi.spyOn(library, "listVersions").mockRejectedValueOnce(new Error("The library is not available"));
    try {
      const design = await storedDesign();
      show({ designId: design.id, crashes: 1 });
      expect(await screen.findByText("There are no earlier versions of this design yet.")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain("Craftly stopped unexpectedly. Your design is saved on this device, so reloading");
      expect(screen.getByRole("alert").textContent).not.toContain("last saved at");
      expect(screen.getByRole("button", { name: "Reload Craftly" })).toBeTruthy();
    } finally {
      summary.mockRestore();
      versions.mockRestore();
    }
  });
});
