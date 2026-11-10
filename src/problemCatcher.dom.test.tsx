/** What nothing else catches: an error in a handler or a timer, a failure that nothing waited for. It is written down, and said once in a while. */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeProblemsDialog, useProblemsDialog } from "@/components/problemsDialogState";
import { clearProblems, listProblems } from "@/core/problems";
import { markCrashing } from "@/core/recovery";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost } from "@/ui";
import { installProblemCatcher } from "./problemCatcher";

const NOTICE = "Something unexpected went wrong. If something does not work, reload the page.";

let uninstall = () => undefined as void;
let clock = 1_000_000;

beforeEach(() => {
  localStorage.clear();
  clearProblems();
  clearToasts();
  closeProblemsDialog();
  markCrashing(false);
  clock = 1_000_000;
  uninstall = installProblemCatcher({ now: () => clock });
});

afterEach(() => uninstall());

const fail = (error: unknown, filename?: string) =>
  act(() => void window.dispatchEvent(new ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error), filename })));
/** the notices on show: a toast that was dismissed a moment ago is still there, leaving, for the length of its exit */
const notices = () => screen.queryAllByText(NOTICE).filter((el) => !el.closest(".is-leaving"));
const reject = (reason: unknown) => act(() => void window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason })));

describe("the problem catcher", () => {
  it("writes down an error that nothing caught", () => {
    fail(new Error("a handler failed"));
    expect(listProblems()[0]).toMatchObject({ kind: "script", message: "a handler failed" });
  });

  it("writes down a failure that nothing waited for", () => {
    reject(new Error("a promise failed"));
    reject("a plain text");
    expect(listProblems().map((p) => [p.kind, p.message])).toEqual([
      ["promise", "a plain text"],
      ["promise", "a promise failed"],
    ]);
  });

  it("uses the message when the browser gave no error, and leaves out what is not Craftly's", () => {
    act(() => void window.dispatchEvent(new ErrorEvent("error", { message: "Something odd", filename: "https://craftly.example.org/assets/index-A1.js" })));
    expect(listProblems()[0].message).toBe("Something odd");
    clearProblems();
    act(() => void window.dispatchEvent(new ErrorEvent("error", { message: "Script error." })));
    fail(new Error("from an extension"), "chrome-extension://abc/content.js");
    expect(listProblems()).toEqual([]);
  });

  it("tells the person, once, with a way to see the details", async () => {
    render(<ToastHost />);
    fail(new Error("the first"));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    const [problem] = listProblems();
    act(() => screen.getByRole("button", { name: "Details" }).click());
    expect(useProblemsDialog.getState()).toMatchObject({ open: true, problemId: problem.id });
  });

  it("does not tell again for the same problem, or for another one within a minute", () => {
    render(<ToastHost />);
    const same = new Error("the same");
    fail(same);
    fail(same);
    clock += 30_000;
    fail(new Error("another one, soon after"));
    expect(notices()).toHaveLength(1);
    expect(listProblems()).toHaveLength(2);
  });

  it("does not tell about a problem that came again, even when it was not told the first time", () => {
    render(<ToastHost />);
    const same = new Error("the same, twice");
    markCrashing(true);
    fail(same); // the crash screen is on show: no notice
    markCrashing(false);
    clock += 10_000;
    fail(same); // written down already: counted, not told as if it were new
    expect(notices()).toHaveLength(0);
    expect(listProblems()).toHaveLength(1);
    expect(listProblems()[0].count).toBe(2);
  });

  it("tells again a minute later, but never more than three times", () => {
    render(<ToastHost />);
    for (let i = 0; i < 5; i++) {
      fail(new Error(`problem ${i}`));
      clock += 61_000;
    }
    expect(notices()).toHaveLength(3);
    expect(listProblems()).toHaveLength(5);
  });

  it("says nothing while the screen that stopped is on show: it says it itself", () => {
    render(<ToastHost />);
    markCrashing(true);
    fail(new Error("while the crash screen shows"));
    expect(notices()).toHaveLength(0);
    expect(listProblems()).toHaveLength(1);
  });

  it("lets go of the page when it is removed: what it listens with, it stops listening with", () => {
    uninstall();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    uninstall = installProblemCatcher({ now: () => clock });
    const added = add.mock.calls.filter(([type]) => type === "error" || type === "unhandledrejection");
    expect(added.map(([type]) => type).sort()).toEqual(["error", "unhandledrejection"]);
    uninstall();
    for (const [type, handler] of added) expect(remove).toHaveBeenCalledWith(type, handler);
    add.mockRestore();
    remove.mockRestore();
    uninstall = installProblemCatcher({ now: () => clock }); // the one that afterEach removes
  });
});
