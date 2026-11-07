import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost, toast } from "./Toast";

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const run = (fn: () => void) => act(fn);
const messages = () =>
  within(screen.getByRole("region", { name: "Notifications" }))
    .getAllByText(/^toast /)
    .map((el) => el.textContent);
const toastEl = (text: string) => screen.getByText(text).closest(".cf-toast") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // the list of toasts lives outside React: empty it so the next test starts clean
  act(() => {
    toast.clear();
    vi.advanceTimersByTime(1000);
  });
});

describe("toast", () => {
  describe("showing", () => {
    it("shows an info message as a status in the notifications region", () => {
      render(<ToastHost />);
      run(() => void toast.info("Saved your work"));
      const region = screen.getByRole("region", { name: "Notifications" });
      expect(region.closest("#cf-overlay-root")).toBeTruthy();
      expect(within(region).getByRole("status").textContent).toContain("Saved your work");
      expect(toastEl("Saved your work").classList.contains("cf-toast--info")).toBe(true);
    });

    it("announces an error as an alert", () => {
      render(<ToastHost />);
      run(() => void toast.error("Could not save"));
      expect(screen.getByRole("alert").textContent).toContain("Could not save");
      expect(toastEl("Could not save").classList.contains("cf-toast--error")).toBe(true);
    });

    it("marks a success", () => {
      render(<ToastHost />);
      run(() => void toast.success("Done"));
      expect(toastEl("Done").classList.contains("cf-toast--success")).toBe(true);
      expect(screen.getByRole("status")).toBeTruthy();
    });

    it("takes the kind from the options of show()", () => {
      render(<ToastHost />);
      run(() => void toast.show({ message: "Custom", kind: "error" }));
      expect(screen.getByRole("alert")).toBeTruthy();
      run(() => void toast.show({ message: "Plain" }));
      expect(toastEl("Plain").classList.contains("cf-toast--info")).toBe(true);
    });

    it("draws an icon for each kind and accepts rich content", () => {
      render(<ToastHost />);
      run(() => {
        toast.info(<b>Bold news</b>);
        toast.success("Yes");
        toast.error("No");
      });
      for (const el of Array.from(document.querySelectorAll(".cf-toast"))) expect(el.querySelector(".cf-toast__icon svg")).toBeTruthy();
      expect(screen.getByText("Bold news").tagName).toBe("B");
    });

    it("lists the toasts in the order they were raised and returns distinct ids", () => {
      render(<ToastHost />);
      let first = 0;
      let second = 0;
      run(() => {
        first = toast.info("toast one");
        second = toast.info("toast two");
      });
      expect(first).not.toBe(second);
      expect(messages()).toEqual(["toast one", "toast two"]);
    });

    it("renders nothing while there are no toasts", () => {
      render(<ToastHost />);
      expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    });

    it("keeps a toast raised before the host exists and shows it once the host mounts", () => {
      run(() => void toast.info("early toast"));
      expect(screen.queryByText("early toast")).toBeNull();
      render(<ToastHost />);
      expect(screen.getByText("early toast")).toBeTruthy();
    });

    it("keeps at most four on screen, retiring the oldest first", () => {
      render(<ToastHost />);
      run(() => {
        for (let i = 1; i <= 5; i += 1) toast.info(`toast ${i}`, { duration: 0 });
      });
      expect(toastEl("toast 1").classList.contains("is-leaving")).toBe(true);
      advance(250);
      expect(messages()).toEqual(["toast 2", "toast 3", "toast 4", "toast 5"]);
    });
  });

  describe("dismissing", () => {
    it("leaves by itself after four seconds, with a short exit animation", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast timed"));
      advance(3999);
      expect(toastEl("toast timed").classList.contains("is-leaving")).toBe(false);
      advance(1);
      expect(toastEl("toast timed").classList.contains("is-leaving")).toBe(true);
      advance(199);
      expect(screen.getByText("toast timed")).toBeTruthy();
      advance(1);
      expect(screen.queryByText("toast timed")).toBeNull();
    });

    it("waits as long as its duration says", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast brief", { duration: 1000 }));
      advance(1000);
      expect(toastEl("toast brief").classList.contains("is-leaving")).toBe(true);
    });

    it("stays until dismissed when the duration is zero", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast sticky", { duration: 0 }));
      advance(60_000);
      expect(toastEl("toast sticky").classList.contains("is-leaving")).toBe(false);
    });

    it("leaves when its close button is pressed", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast closable", { duration: 0 }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
      expect(toastEl("toast closable").classList.contains("is-leaving")).toBe(true);
      advance(200);
      expect(screen.queryByText("toast closable")).toBeNull();
    });

    it("leaves when dismissed by id, and a second dismissal does nothing", () => {
      render(<ToastHost />);
      let id = 0;
      run(() => void (id = toast.info("toast byid", { duration: 0 })));
      run(() => toast.dismiss(id));
      run(() => toast.dismiss(id));
      run(() => toast.dismiss(id + 1000));
      advance(200);
      expect(screen.queryByText("toast byid")).toBeNull();
    });

    it("clears everything at once", () => {
      render(<ToastHost />);
      run(() => {
        toast.info("toast a", { duration: 0 });
        toast.error("toast b", { duration: 0 });
      });
      run(() => toast.clear());
      advance(200);
      expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    });
  });

  describe("action", () => {
    it("runs the action and dismisses the toast", () => {
      render(<ToastHost />);
      const onAction = vi.fn();
      run(() => void toast.info("toast undoable", { actionLabel: "Undo", onAction, duration: 0 }));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(toastEl("toast undoable").classList.contains("is-leaving")).toBe(true);
    });

    it("dismisses even when there is no handler, and has no action button without a label", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast labelled", { actionLabel: "Open", duration: 0 }));
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(toastEl("toast labelled").classList.contains("is-leaving")).toBe(true);
      run(() => void toast.info("toast plain", { duration: 0 }));
      expect(within(toastEl("toast plain")).queryByRole("button", { name: "Open" })).toBeNull();
    });
  });

  describe("pausing while the user is looking", () => {
    it("holds the toast while the pointer is over it and gives it time to be read afterwards", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast hovered"));
      advance(3500);
      fireEvent.pointerEnter(toastEl("toast hovered"));
      advance(60_000);
      expect(toastEl("toast hovered").classList.contains("is-leaving")).toBe(false);
      fireEvent.pointerLeave(toastEl("toast hovered"));
      advance(1199);
      expect(toastEl("toast hovered").classList.contains("is-leaving")).toBe(false);
      advance(1);
      expect(toastEl("toast hovered").classList.contains("is-leaving")).toBe(true);
    });

    it("keeps the rest of the time when more than a second and a half was left", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast early", { duration: 6000 }));
      advance(1000);
      fireEvent.pointerEnter(toastEl("toast early"));
      fireEvent.pointerLeave(toastEl("toast early"));
      advance(4999);
      expect(toastEl("toast early").classList.contains("is-leaving")).toBe(false);
      advance(1);
      expect(toastEl("toast early").classList.contains("is-leaving")).toBe(true);
    });

    it("also holds while the keyboard focus is inside it", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast focused"));
      const close = screen.getByRole("button", { name: "Dismiss notification" });
      act(() => close.focus());
      advance(30_000);
      expect(toastEl("toast focused").classList.contains("is-leaving")).toBe(false);
      act(() => close.blur());
      advance(3999);
      expect(toastEl("toast focused").classList.contains("is-leaving")).toBe(false);
      advance(1);
      expect(toastEl("toast focused").classList.contains("is-leaving")).toBe(true);
    });

    it("has nothing to pause or restart on a toast that stays until dismissed", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast forever", { duration: 0 }));
      fireEvent.pointerEnter(toastEl("toast forever"));
      fireEvent.pointerLeave(toastEl("toast forever"));
      advance(30_000);
      expect(toastEl("toast forever").classList.contains("is-leaving")).toBe(false);
    });

    it("does not restart a toast that is already leaving", () => {
      render(<ToastHost />);
      run(() => void toast.info("toast going", { duration: 0 }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
      fireEvent.pointerLeave(toastEl("toast going"));
      advance(200);
      expect(screen.queryByText("toast going")).toBeNull();
    });
  });
});
