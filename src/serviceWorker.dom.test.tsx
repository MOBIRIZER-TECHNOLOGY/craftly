import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { ToastHost, toast } from "@/ui";
import { registerServiceWorker } from "./serviceWorker";

/* ---- stand-ins for what the browser gives a page ---- */

class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  readonly sent: Array<{ type: string }> = [];
  constructor(
    readonly build: string | null,
    state: ServiceWorkerState = "installed",
    private readonly answers = true,
  ) {
    super();
    this.state = state;
  }
  postMessage(message: { type: string }, transfer?: unknown[]) {
    this.sent.push(message);
    if (message.type === "VERSION" && this.answers) {
      const port = transfer?.[0] as MessagePort;
      queueMicrotask(() => port.postMessage({ build: this.build }));
    }
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
}

class FakeContainer extends EventTarget {
  /** the worker that runs the page; null on the first visit */
  controller: object | null = {};
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(async (_url: string) => this.registration);
}

const PROMPT = "A new version of Craftly is ready. Reload to use it.";
const quiet = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const versionRequests = (worker: FakeWorker) => worker.sent.filter((m) => m.type === "VERSION").length;

let container: FakeContainer;
let stops: Array<() => void> = [];

beforeEach(() => {
  container = new FakeContainer();
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  window.location.hash = "";
  render(<ToastHost />);
});

afterEach(async () => {
  for (const stop of stops) stop();
  stops = [];
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull()); // the stack is global: the next test starts with none
  document.head.querySelectorAll('meta[name="craftly-build"]').forEach((meta) => meta.remove());
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  useEditor.setState({ saveState: "saved" });
  vi.restoreAllMocks();
  window.location.hash = "";
});

type Options = NonNullable<Parameters<typeof registerServiceWorker>[1]>;

/** Registers with short waits; the page is build "b1" unless told otherwise. */
async function start(options: Options = {}) {
  const reload = vi.fn();
  stops.push(await registerServiceWorker("/sw.js", { reload, pageBuild: () => "b1", versionTimeoutMs: 150, saveTimeoutMs: 150, takeOverTimeoutMs: 300, ...options }));
  return reload;
}

const reloadButton = () => screen.getByRole("button", { name: "Reload" });

describe("registerServiceWorker", () => {
  it("registers the worker file it is given", async () => {
    await start();
    expect(container.register).toHaveBeenCalledWith("/sw.js");
  });

  it("says nothing while no new version is waiting", async () => {
    await start();
    await quiet();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  describe("when a new version is waiting", () => {
    it("asks the person to reload when the waiting worker carries another build than this page", async () => {
      const info = vi.spyOn(toast, "info");
      container.registration.waiting = new FakeWorker("b2");
      await start();
      expect(await screen.findByText(PROMPT)).toBeTruthy();
      expect(reloadButton()).toBeTruthy();
      // it stays until the person has seen it: a toast that went away by itself would be missed
      expect(info).toHaveBeenCalledWith(PROMPT, expect.objectContaining({ actionLabel: "Reload", duration: 0 }));
    });

    it("says nothing when this page already is that build, as after a reload that fetched the new page from the network", async () => {
      const waiting = new FakeWorker("b2");
      container.registration.waiting = waiting;
      await start({ pageBuild: () => "b2" });
      await waitFor(() => expect(versionRequests(waiting)).toBe(1));
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
    });

    it("says nothing on the first visit, when no worker runs the page yet and there is nothing to go stale", async () => {
      container.controller = null;
      const waiting = new FakeWorker("b2");
      container.registration.waiting = waiting;
      await start();
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
      expect(versionRequests(waiting)).toBe(0);
    });

    it("asks when the worker does not say which build it is, rather than guess", async () => {
      container.registration.waiting = new FakeWorker("b2", "installed", false);
      await start();
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("asks when the worker answers with something that is not a build id", async () => {
      const odd = new FakeWorker(null);
      odd.postMessage = (message, transfer) => {
        odd.sent.push(message);
        queueMicrotask(() => (transfer?.[0] as MessagePort).postMessage({ build: 42 }));
      };
      container.registration.waiting = odd;
      await start();
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("asks when the page cannot tell which build it is", async () => {
      container.registration.waiting = new FakeWorker("b2");
      await start({ pageBuild: () => null });
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("asks when the worker cannot be reached any more", async () => {
      const gone = new FakeWorker("b2");
      gone.postMessage = () => {
        throw new DOMException("The worker is redundant", "InvalidStateError");
      };
      container.registration.waiting = gone;
      await start();
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("reads the build of the page from the tag the build writes into index.html", async () => {
      const meta = document.createElement("meta");
      meta.name = "craftly-build";
      meta.content = "b1";
      document.head.appendChild(meta);
      const same = new FakeWorker("b1");
      container.registration.waiting = same;
      await start({ pageBuild: undefined });
      await waitFor(() => expect(versionRequests(same)).toBe(1));
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();

      meta.content = "__BUILD_ID__"; // a page that was never stamped, as under a dev server
      container.registration.waiting = new FakeWorker("b1");
      stops.push(await registerServiceWorker("/sw.js", { reload: vi.fn(), pageBuild: undefined, versionTimeoutMs: 150 }));
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });
  });

  describe("when a new version finishes installing while the page is open", () => {
    it("asks once the worker has installed", async () => {
      await start();
      const installing = new FakeWorker("b2", "installing");
      container.registration.installing = installing;
      container.registration.dispatchEvent(new Event("updatefound"));
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
      installing.become("installed");
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("asks when the page opens while a new version is still installing", async () => {
      const installing = new FakeWorker("b2", "installing");
      container.registration.installing = installing;
      await start();
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
      installing.become("installed");
      expect(await screen.findByText(PROMPT)).toBeTruthy();
    });

    it("says nothing for a worker that fails to install", async () => {
      await start();
      const installing = new FakeWorker("b2", "installing");
      container.registration.installing = installing;
      container.registration.dispatchEvent(new Event("updatefound"));
      installing.become("redundant");
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
    });

    it("ignores an update that has no worker to show", async () => {
      await start();
      container.registration.dispatchEvent(new Event("updatefound"));
      await quiet();
      expect(screen.queryByText(PROMPT)).toBeNull();
    });

    it("asks once for a build however often it hears of it, and again for a newer one", async () => {
      const info = vi.spyOn(toast, "info");
      const first = new FakeWorker("b2");
      container.registration.waiting = first;
      await start();
      await screen.findByText(PROMPT);
      const again = new FakeWorker("b2", "installing");
      container.registration.installing = again;
      container.registration.dispatchEvent(new Event("updatefound"));
      again.become("installed");
      await waitFor(() => expect(versionRequests(again)).toBe(1));
      await quiet();
      expect(info).toHaveBeenCalledTimes(1);

      const newer = new FakeWorker("b3", "installing");
      container.registration.installing = newer;
      container.registration.dispatchEvent(new Event("updatefound"));
      newer.become("installed");
      await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
    });
  });

  describe("pressing Reload", () => {
    async function prompted(options: Options = {}, worker = new FakeWorker("b2")) {
      container.registration.waiting = worker;
      const reload = await start(options);
      await screen.findByText(PROMPT);
      return { reload, worker, user: userEvent.setup() };
    }

    it("asks the waiting worker to take over, and reloads once it has", async () => {
      const { reload, worker, user } = await prompted();
      await user.click(reloadButton());
      await waitFor(() => expect(worker.sent).toContainEqual({ type: "SKIP_WAITING" }));
      expect(reload).not.toHaveBeenCalled();
      container.dispatchEvent(new Event("controllerchange"));
      expect(reload).toHaveBeenCalledTimes(1);
      container.dispatchEvent(new Event("controllerchange"));
      await quiet(400);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("ignores a second Reload while the first is under way, whichever notice it comes from", async () => {
      const first = new FakeWorker("b2");
      container.registration.waiting = first;
      await start();
      await screen.findByText(PROMPT);
      const second = new FakeWorker("b3", "installing");
      container.registration.installing = second;
      container.registration.dispatchEvent(new Event("updatefound"));
      second.become("installed");
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Reload" })).toHaveLength(2));
      const [one, two] = screen.getAllByRole("button", { name: "Reload" });
      const user = userEvent.setup();
      await user.click(one);
      await user.click(two);
      await waitFor(() => expect(first.sent).toContainEqual({ type: "SKIP_WAITING" }));
      await quiet();
      expect(second.sent).not.toContainEqual({ type: "SKIP_WAITING" });
    });

    it("reloads once, at once, when the worker cannot be reached, and not again when the controller changes anyway", async () => {
      const unreachable = new FakeWorker("b2");
      const { reload, user } = await prompted({}, unreachable);
      unreachable.postMessage = () => {
        throw new DOMException("The worker is redundant", "InvalidStateError");
      };
      await user.click(reloadButton());
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      container.dispatchEvent(new Event("controllerchange"));
      await quiet(400);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("reloads the page itself when no other way of reloading is given", async () => {
      const reload = vi.fn();
      vi.stubGlobal("location", { ...window.location, reload });
      try {
        container.registration.waiting = new FakeWorker("b2");
        stops.push(await registerServiceWorker("/sw.js", { pageBuild: () => "b1", versionTimeoutMs: 150, takeOverTimeoutMs: 100 }));
        await screen.findByText(PROMPT);
        await userEvent.setup().click(reloadButton());
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("takes the prompt away", async () => {
      const { user } = await prompted();
      await user.click(reloadButton());
      await waitFor(() => expect(screen.queryByText(PROMPT)).toBeNull());
    });

    it("does not reload for a change of worker that it did not ask for, as when another tab updated the app", async () => {
      const { reload } = await prompted();
      container.dispatchEvent(new Event("controllerchange"));
      await quiet(400);
      expect(reload).not.toHaveBeenCalled();
    });

    it("reloads anyway when the worker does not take over in time, so the button never does nothing", async () => {
      const { reload, user } = await prompted({ takeOverTimeoutMs: 100 });
      await user.click(reloadButton());
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });

    it("reloads at once when the waiting worker was replaced in the meantime, which the new page will meet", async () => {
      const { reload, worker, user } = await prompted();
      worker.state = "redundant";
      await user.click(reloadButton());
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(worker.sent).not.toContainEqual({ type: "SKIP_WAITING" });
    });

    it("saves the open design first, and only then asks the worker to take over", async () => {
      window.location.hash = "#/design/d1";
      useEditor.setState({ saveState: "unsaved" });
      let order: string[] = [];
      const answer = () => {
        order.push("save requested");
        setTimeout(() => {
          order.push("saved");
          useEditor.setState({ saveState: "saved" });
        }, 40);
      };
      window.addEventListener("craftly:save-now", answer);
      try {
        const { worker, user } = await prompted();
        const sent = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          if (message.type === "SKIP_WAITING") order.push("asked the worker");
          sent(message, transfer);
        };
        await user.click(reloadButton());
        await waitFor(() => expect(order).toContain("asked the worker"));
        expect(order).toEqual(["save requested", "saved", "asked the worker"]);
      } finally {
        window.removeEventListener("craftly:save-now", answer);
        order = [];
      }
    });

    it("keeps the page and lets the user retry when the save times out", async () => {
      window.location.hash = "#/design/d1";
      useEditor.setState({ saveState: "unsaved" });
      const { worker, user, reload } = await prompted({ saveTimeoutMs: 80 });
      await user.click(reloadButton());
      const retry = await screen.findByRole("button", { name: "Retry update" });
      expect(worker.sent).not.toContainEqual({ type: "SKIP_WAITING" });
      expect(reload).not.toHaveBeenCalled();
      useEditor.setState({ saveState: "saved" });
      await user.click(retry);
      await waitFor(() => expect(worker.sent).toContainEqual({ type: "SKIP_WAITING" }));
    });

    it("does not wait for a save on the dashboard, where every change is written as it is made", async () => {
      const asked = vi.fn();
      window.addEventListener("craftly:save-now", asked);
      try {
        const { worker, user } = await prompted();
        await user.click(reloadButton());
        await waitFor(() => expect(worker.sent).toContainEqual({ type: "SKIP_WAITING" }));
        expect(asked).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("craftly:save-now", asked);
      }
    });
  });

  describe("looking for new versions", () => {
    const visible = () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    it("looks when the tab comes back into view, at most every half hour", async () => {
      let clock = 0;
      await start({ now: () => clock });
      const { update } = container.registration;
      visible();
      expect(update).not.toHaveBeenCalled(); // it was looked at when the page loaded
      clock = 31 * 60_000;
      visible();
      expect(update).toHaveBeenCalledTimes(1);
      clock += 60_000;
      visible();
      expect(update).toHaveBeenCalledTimes(1);
      clock += 31 * 60_000;
      visible();
      expect(update).toHaveBeenCalledTimes(2);
    });

    it("does not look while the tab is hidden", async () => {
      let clock = 0;
      await start({ now: () => clock });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      clock = 60 * 60_000;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(container.registration.update).not.toHaveBeenCalled();
    });

    it("looks when the connection comes back, if it has been a while", async () => {
      let clock = 0;
      await start({ now: () => clock });
      clock = 45 * 60_000;
      window.dispatchEvent(new Event("online"));
      expect(container.registration.update).toHaveBeenCalledTimes(1);
    });

    it("carries on when a look fails, as it does without a connection", async () => {
      let clock = 0;
      await start({ now: () => clock });
      container.registration.update.mockRejectedValue(new TypeError("Failed to fetch"));
      clock = 45 * 60_000;
      expect(() => window.dispatchEvent(new Event("online"))).not.toThrow();
      await quiet();
      expect(container.registration.update).toHaveBeenCalledTimes(1);
    });

    it("stops looking when told to stop", async () => {
      let clock = 0;
      const stop = await registerServiceWorker("/sw.js", { reload: vi.fn(), pageBuild: () => "b1", now: () => clock });
      stop();
      clock = 45 * 60_000;
      window.dispatchEvent(new Event("online"));
      expect(container.registration.update).not.toHaveBeenCalled();
    });
  });
});
