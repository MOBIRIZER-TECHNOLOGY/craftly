/** "Report a problem": the problems that Craftly wrote down on this device, one report at a time. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearProblems, listProblems, recordProblem, reportText } from "@/core/problems";
import { clearToasts } from "@/test/tabsHarness";
import { ProblemsDialog } from "./ProblemsDialog";
import { ProblemsHost } from "./ProblemsHost";
import { closeProblemsDialog, openProblemsDialog } from "./problemsDialogState";

vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));
const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  clearProblems();
  clearToasts();
  closeProblemsDialog();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

const record = (kind: Parameters<typeof recordProblem>[0], message: string, now: number) => recordProblem(kind, new Error(message), { now })!;
const dialog = () => screen.getByRole("dialog", { name: "Report a problem" });
/** the dialog has two buttons called Close: the round one in the corner and the one in the footer */
const footerClose = () => within(dialog()).getAllByRole("button", { name: "Close" }).at(-1)!;
const rows = () => within(screen.getByRole("listbox", { name: "Problems on this device" })).getAllByRole("option");

describe("<ProblemsDialog>", () => {
  it("shows nothing while it is closed", () => {
    render(<ProblemsDialog open={false} problemId={null} onClose={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says that nothing was written down when nothing was", () => {
    render(<ProblemsDialog open problemId={null} onClose={() => undefined} />);
    expect(within(dialog()).getByText("No problems have been recorded on this device.")).toBeTruthy();
    expect(within(dialog()).queryByLabelText("What a report holds")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "Clear the list" }).hasAttribute("disabled")).toBe(true);
  });

  it("lists the problems newest first, with what kind each was and how often it came, and shows the newest one's report", () => {
    record("script", "older failure", 1_000);
    const failure = new Error("newer failure"); // the same failure twice has the same stack
    const newest = recordProblem("save", failure, { now: 100_000_000 })!;
    recordProblem("save", failure, { now: 100_000_001 });
    render(<ProblemsDialog open problemId={null} onClose={() => undefined} />);
    const list = rows();
    expect(list).toHaveLength(2);
    expect(list[0].textContent).toContain("Saving failed");
    expect(list[0].textContent).toContain("newer failure");
    expect(list[0].textContent).toContain("×2");
    expect(list[1].textContent).toContain("Something failed");
    expect(list[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("What a report holds").textContent).toBe(reportText({ ...newest, count: 2, at: 100_000_001 }));
  });

  it("shows the report of the problem that is chosen", async () => {
    const user = userEvent.setup();
    const old = record("script", "older failure", 1_000);
    record("save", "newer failure", 100_000_000);
    render(<ProblemsDialog open problemId={null} onClose={() => undefined} />);
    await user.click(rows()[1]);
    expect(screen.getByLabelText("What a report holds").textContent).toBe(reportText(old));
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    expect(rows()[0].getAttribute("aria-selected")).toBe("false");
  });

  it("starts on the problem it was asked about", () => {
    const wanted = record("script", "the one from the toast", 1_000);
    record("save", "a newer one", 100_000_000);
    render(<ProblemsDialog open problemId={wanted.id} onClose={() => undefined} />);
    expect(screen.getByLabelText("What a report holds").textContent).toBe(reportText(wanted));
  });

  it("marks a problem as sent in the list after it was sent", async () => {
    const user = userEvent.setup();
    record("script", "to send", 1_000);
    render(<ProblemsDialog open problemId={null} onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(rows()[0].textContent).toContain("Sent"));
    expect(listProblems()[0].sent).toBe(true);
  });

  it("forgets all of them when asked", async () => {
    const user = userEvent.setup();
    record("script", "one", 1_000);
    record("save", "two", 100_000_000);
    render(<ProblemsDialog open problemId={null} onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Clear the list" }));
    expect(screen.getByText("No problems have been recorded on this device.")).toBeTruthy();
    expect(listProblems()).toEqual([]);
  });

  it("closes from the button and from Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProblemsDialog open problemId={null} onClose={onClose} />);
    await user.click(footerClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("<ProblemsHost>", () => {
  it("shows nothing until somebody opens it, then opens on the newest problem or the one asked for", async () => {
    const first = record("script", "first", 1_000);
    record("save", "second", 100_000_000);
    render(<ProblemsHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openProblemsDialog());
    expect(await screen.findByRole("dialog", { name: "Report a problem" })).toBeTruthy();
    expect(screen.getByLabelText("What a report holds").textContent).toContain("second");
    act(() => closeProblemsDialog());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => openProblemsDialog(first.id));
    await screen.findByRole("dialog", { name: "Report a problem" });
    expect(screen.getByLabelText("What a report holds").textContent).toContain("first");
  });

  it("closes from its own button", async () => {
    const user = userEvent.setup();
    render(<ProblemsHost />);
    act(() => openProblemsDialog());
    await screen.findByRole("dialog", { name: "Report a problem" });
    await user.click(footerClose());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
