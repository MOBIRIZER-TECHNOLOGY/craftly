import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconCell } from "./cells";

/*
 * The icon library "cannot be fetched" (offline, or - in a test run - the environment is already gone). Every icon cell of
 * an open panel asks for it, and a cell is not something anybody waits on: it stays a placeholder and must not report an
 * unhandled rejection. Inserting an icon from the cell is a user action and reports its own failure.
 */
const asked = vi.hoisted(() => ({ library: 0 }));
vi.mock("lucide", () => {
  asked.library += 1;
  throw new Error("the chunk could not be fetched");
});

describe("an icon cell when the icon library cannot be fetched", () => {
  it("stays a placeholder and does not report an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      render(<IconCell def={{ id: "bird", name: "Bird", tags: [] }} />);
      // node reports an unhandled rejection once the microtasks have run: give it a real turn of the event loop
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(asked.library).toBe(1);
      expect(screen.getByRole("button", { name: "Bird" }).querySelector(".cf-skeleton")).toBeTruthy();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
