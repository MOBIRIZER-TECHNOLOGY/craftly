/**
 * Registers the service worker and offers the person a new version without pulling code out from under an open tab.
 *
 * A new build installs a new worker, which then WAITS (public/sw.js): every tab keeps the code it started with, and the
 * files that code may still ask for, until the person presses Reload in the toast this file shows, or closes the tabs.
 * Pressing Reload saves the open design, asks the waiting worker to take over, and reloads once it has.
 *
 * The toast only appears in a tab that is OLDER than the waiting worker. A page that was opened after the update (the
 * worker fetches pages from the network first) already runs the new build, and asking it to reload would be noise: the
 * build writes its id into a meta tag of index.html and into the worker, and the page asks the worker for its id.
 */
import { toast } from "@/ui";
import { settleSaves } from "./settleSaves";

const PROMPT = "A new version of Craftly is ready. Reload to use it.";
const PLACEHOLDER = "__BUILD_ID__";

export interface RegisterOptions {
  /** replaces the page (default: location.reload) */
  reload?: () => void;
  /** the id of the build this page came from (default: the meta tag of index.html) */
  pageBuild?: () => string | null;
  now?: () => number;
  /** how long to wait for a worker to say which build it is, in ms (default 2,000) */
  versionTimeoutMs?: number;
  /** how long to wait for the open design to be saved before going ahead, in ms (default 4,000) */
  saveTimeoutMs?: number;
  /** how long to wait for the worker to take over before reloading anyway, in ms (default 5,000) */
  takeOverTimeoutMs?: number;
  /** the least time between two looks for a new version, in ms (default half an hour) */
  checkEveryMs?: number;
}

/** The build this page came from, or null when the page was never stamped (a dev server) or has no such tag. */
function buildOfPage(): string | null {
  const content = document.querySelector('meta[name="craftly-build"]')?.getAttribute("content")?.trim();
  return content && content !== PLACEHOLDER ? content : null;
}

/** Asks a worker which build it is; null when it does not answer in time or cannot be reached. */
function buildOfWorker(worker: ServiceWorker, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let timer = 0;
    const answer = (build: string | null) => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(build);
    };
    timer = window.setTimeout(() => answer(null), timeoutMs);
    channel.port1.onmessage = (event) => answer(typeof event.data?.build === "string" ? event.data.build : null);
    try {
      worker.postMessage({ type: "VERSION" }, [channel.port2]);
    } catch {
      answer(null);
    }
  });
}

/**
 * Registers the worker, offers a waiting new version (see the top of the file) and looks for one now and then, because a
 * tab that is never reloaded would otherwise only hear of a new build when the browser happens to check. Resolves with a
 * function that stops watching.
 */
export async function registerServiceWorker(url: string, options: RegisterOptions = {}): Promise<() => void> {
  const {
    reload = () => window.location.reload(),
    pageBuild = buildOfPage,
    now = Date.now,
    versionTimeoutMs = 2000,
    saveTimeoutMs = 4000,
    takeOverTimeoutMs = 5000,
    checkEveryMs = 30 * 60_000,
  } = options;
  const container = navigator.serviceWorker;
  const registration = await container.register(url);
  let stopped = false;
  let reloading = false;
  const offered = new Set<string>();

  /** The person pressed Reload: save, let the waiting worker take over, reload once it has (or when it does not). */
  const takeOver = async (worker: ServiceWorker) => {
    if (reloading) return;
    reloading = true;
    if ((await settleSaves(saveTimeoutMs)) !== "saved") {
      reloading = false;
      toast.error("Craftly could not save your changes. Save or download a project file before updating.");
      toast.info(PROMPT, { actionLabel: "Retry update", duration: 0, onAction: () => void takeOver(worker) });
      return;
    }
    let reloaded = false;
    let timer = 0;
    const replace = () => {
      if (reloaded) return;
      reloaded = true;
      window.clearTimeout(timer);
      reload();
    };
    // a worker that another build replaced meanwhile is gone: the reload fetches the newest page from the network anyway
    if (worker.state === "redundant") return replace();
    container.addEventListener("controllerchange", replace, { once: true });
    timer = window.setTimeout(replace, takeOverTimeoutMs);
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
    } catch {
      replace();
    }
  };

  const offer = async (worker: ServiceWorker) => {
    // no worker runs this page yet (the first visit): nothing that is running can have gone stale
    if (stopped || !container.controller) return;
    const theirs = await buildOfWorker(worker, versionTimeoutMs);
    if (stopped || (theirs !== null && theirs === pageBuild())) return;
    const key = theirs ?? "unknown";
    if (offered.has(key)) return;
    offered.add(key);
    // no time limit: a notice that went away by itself would be missed, and nothing is lost by leaving it
    toast.info(PROMPT, { actionLabel: "Reload", duration: 0, onAction: () => void takeOver(worker) });
  };

  const watch = (worker: ServiceWorker) => {
    const installed = () => {
      if (worker.state === "installed") void offer(worker);
    };
    worker.addEventListener("statechange", installed);
    installed();
  };

  if (registration.waiting) watch(registration.waiting);
  if (registration.installing) watch(registration.installing);
  const onUpdateFound = () => {
    if (registration.installing) watch(registration.installing);
  };
  registration.addEventListener("updatefound", onUpdateFound);

  let lastLook = now();
  const look = () => {
    if (stopped || now() - lastLook < checkEveryMs) return;
    lastLook = now();
    registration.update().catch(() => undefined); // no connection, or the host is down: the next look tries again
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") look();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", look);

  return () => {
    stopped = true;
    registration.removeEventListener("updatefound", onUpdateFound);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", look);
  };
}
