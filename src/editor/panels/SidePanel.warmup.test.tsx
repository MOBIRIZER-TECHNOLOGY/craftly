import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPanels } from "@/test/tabsHarness";
import { preloadTab } from "./SidePanel";

/*
 * The Elements chunk "cannot be fetched" (offline, or - in a test run - the environment is already gone). Both the idle
 * warm-up and a hover on the rail ask for a chunk nobody is waiting for yet, so a failure must stay quiet: it is not an
 * unhandled rejection. Opening the tab later asks again and shows the retry panel (see SidePanel.test.tsx).
 */
const asked = vi.hoisted(() => ({ elements: 0 }));
vi.mock("./tabs/ElementsTab", () => {
  asked.elements += 1;
  throw new Error("the chunk could not be fetched");
});

/** Node reports an unhandled rejection once the microtasks have run: give it a real turn of the event loop. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function watchRejections() {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  return { unhandled, stop: () => process.off("unhandledRejection", unhandled) };
}

afterEach(() => vi.useRealTimers());

describe("asking for a tab's chunk ahead of need", () => {
  it("keeps quiet when the idle warm-up cannot fetch the chunk", async () => {
    const rejections = watchRejections();
    try {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      // the Tools tab opens no panel, so nothing but the warm-up asks for the Elements chunk
      mountPanels({ tab: "tools" });
      expect(asked.elements).toBe(0);
      await act(async () => void (await vi.advanceTimersByTimeAsync(850)));
      expect(asked.elements).toBe(1);
      vi.useRealTimers();
      await settle();
      expect(rejections.unhandled).not.toHaveBeenCalled();
    } finally {
      rejections.stop();
    }
  });

  it("keeps quiet when the chunk of a hovered rail tab cannot be fetched", async () => {
    const rejections = watchRejections();
    try {
      expect(() => preloadTab("elements")).not.toThrow();
      await settle();
      expect(rejections.unhandled).not.toHaveBeenCalled();
    } finally {
      rejections.stop();
    }
  });
});
