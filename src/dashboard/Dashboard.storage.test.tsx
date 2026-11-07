import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

/**
 * The browser may refuse to open IndexedDB (a private window, blocked site data). This file must not touch the
 * library before the test does, so the first attempt to open it can fail.
 */
describe("<Dashboard> when the browser's storage is not available", () => {
  it("warns that designs cannot be saved, shows the reason, and recovers when the user tries again", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        Object.defineProperty(request, "error", { value: new DOMException("The user denied permission to access the database.", "SecurityError") });
        request.onerror?.(new Event("error"));
      });
      return request;
    });
    window.location.hash = "#/trash";
    render(<Dashboard />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Craftly can't reach this browser's local storage.");
    expect(alert.textContent).toContain("The user denied permission to access the database.");
    expect(screen.getByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();

    // the browser allows it now: Try again reads the library, and the warning goes away
    open.mockRestore();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("The trash is empty")).toBeTruthy();
  });
});
