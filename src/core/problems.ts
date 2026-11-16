/**
 * What Craftly remembers about things that go wrong, and the one report that a person may choose to send.
 *
 * The problems are kept on this device, in localStorage rather than IndexedDB: a problem with the database is the kind that
 * has to be written down. Nothing here talks to the network except `sendReport`, which runs when somebody presses Send, and
 * only where the site that hosts Craftly has said a report may go (`VITE_CRAFTLY_REPORT_URL`, see docs/CRASH-RECOVERY.md). A
 * report has the fields of `Report` and no others: the error, the screen it happened on (never which design), the build, the
 * browser and the size of the window.
 */
import { m } from "@/i18n";

/** `screen`: the screen stopped. `panel`: a side panel stopped. `script`: an error nothing caught. `promise`: a failure nothing waited for. `save`: autosave failed. `load`: a part of Craftly could not be fetched. */
export type ProblemKind = "screen" | "panel" | "script" | "promise" | "save" | "load";

export interface Problem {
  id: string;
  at: number;
  kind: ProblemKind;
  message: string;
  /** frames only, without the address of the site */
  stack: string;
  /** the screen, not the design: "design", "projects" ... */
  route: string;
  /** how many times it happened within a minute of the one before */
  count: number;
  sent?: boolean;
}

export const PROBLEM_LIMIT = 20;

const STORAGE_KEY = "craftly.problems.v1";
const SAME_PROBLEM_WINDOW = 60_000;
const MESSAGE_LIMIT = 300;
const STACK_LINES = 12;
const STACK_LIMIT = 1500;
const SEND_TIMEOUT = 10_000;
const UNKNOWN_MESSAGE = "Something failed without saying what.";

/** The title a person reads for each kind of problem. (The message and the report stay as they were written: they are for whoever fixes it.) */
export const PROBLEM_TITLES: Record<ProblemKind, string> = m.core.problems;

/* ---------------- cleaning what is kept ---------------- */

/** A message on one line, without addresses or e-mail addresses, and at most 300 characters. */
export function cleanMessage(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
  const oneLine = text
    .replace(/(?:https?|blob|file|data):[^\s)'"]*/gi, "[address]")
    .replace(/[^\s@'"<>()]+@[^\s@'"<>()]+\.[^\s@'"<>()]+/g, "[e-mail]")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > MESSAGE_LIMIT ? `${oneLine.slice(0, MESSAGE_LIMIT - 1)}…` : oneLine;
}

// an address of the page that ends in the file and the place in it: "https://host/assets/Editor-A1.js?t=1:45:6" -> "Editor-A1.js:45:6"
const FRAME_ADDRESS = /(?:blob:)?(?:https?|file):\/\/[^\s)?]*\/([^\s/)?:]+)(?:\?[^\s):]*)?(:\d+(?::\d+)?)/g;
const IS_FRAME = /^(?:at |[^\s@]*@\S)/;

/** The frames of a stack: which function, in which file, at which place. The address and the folders of the site are left out. */
export function cleanStack(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const frames = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => IS_FRAME.test(line))
    .slice(0, STACK_LINES)
    .map((line) => line.replace(FRAME_ADDRESS, "$1$2"));
  return frames.join("\n").slice(0, STACK_LIMIT);
}

/** What is not Craftly's to report: an extension's error, the browser's word for a failure in a script of another site, a notice that is no failure, something that was cancelled. */
export function isNoise(message: string, source?: string, name?: string): boolean {
  if (source && /^(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i.test(source)) return true;
  if (/^Script error\.?$/i.test(message.trim())) return true;
  if (/ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/.test(message)) return true;
  return name === "AbortError";
}

/** The words with which browsers say that a file of the app could not be fetched (a deployment replaced it, or the network is gone). */
export function kindOfLoadFailure(message: string): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS|Failed to load module script/i.test(
    message,
  );
}

const KNOWN_ROUTES = new Set(["design", "projects", "templates", "brand", "trash"]);

/** The screen that a hash is, and never which design it is. */
export function routeOf(hash: string): string {
  const first = /^#\/([^/?#]*)/.exec(hash)?.[1];
  if (first === undefined) return hash === "" || hash === "#" ? "home" : "other";
  if (first === "") return "home";
  return KNOWN_ROUTES.has(first) ? first : "other";
}

/** "Chrome 152 on Windows": the browser and its main version, and the system, and no more. */
export function describeBrowser(userAgent: string): string {
  const match =
    /Edg(?:e|A|iOS)?\/(\d+)/.exec(userAgent)?.slice(1, 2).concat("Edge") ??
    /OPR\/(\d+)/.exec(userAgent)?.slice(1, 2).concat("Opera") ??
    /Firefox\/(\d+)/.exec(userAgent)?.slice(1, 2).concat("Firefox") ??
    /(?:Chrome|CriOS)\/(\d+)/.exec(userAgent)?.slice(1, 2).concat("Chrome") ??
    (/Safari\//.test(userAgent) ? /Version\/(\d+)/.exec(userAgent)?.slice(1, 2).concat("Safari") : undefined);
  if (!match) return "an unknown browser";
  const system = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "macOS"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux|X11/.test(userAgent)
              ? "Linux"
              : "";
  return `${match[1]} ${match[0]}${system ? ` on ${system}` : ""}`;
}

/* ---------------- the report ---------------- */

export interface ReportEnvironment {
  build: string;
  userAgent: string;
  width: number;
  height: number;
  online: boolean;
}

/** The only thing that can leave the device, and only when somebody presses Send. These fields and no others. */
export interface Report {
  format: 1;
  app: "craftly";
  build: string;
  at: string;
  kind: ProblemKind;
  message: string;
  stack: string;
  count: number;
  route: string;
  browser: string;
  window: string;
  online: boolean;
}

const BUILD_PLACEHOLDER = "__BUILD_ID__";

export function currentEnvironment(): ReportEnvironment {
  const stamped = document.querySelector('meta[name="craftly-build"]')?.getAttribute("content")?.trim();
  return {
    build: stamped && stamped !== BUILD_PLACEHOLDER ? stamped : "dev",
    userAgent: navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    online: navigator.onLine,
  };
}

export function buildReport(problem: Problem, env: ReportEnvironment = currentEnvironment()): Report {
  return {
    format: 1,
    app: "craftly",
    build: env.build,
    at: new Date(problem.at).toISOString(),
    kind: problem.kind,
    message: problem.message,
    stack: problem.stack,
    count: problem.count,
    route: problem.route,
    browser: describeBrowser(env.userAgent),
    window: `${env.width}x${env.height}`,
    online: env.online,
  };
}

/** The report as the person sees it and as it is sent: indented JSON. */
export function reportText(problem: Problem, env?: ReportEnvironment): string {
  return JSON.stringify(buildReport(problem, env), null, 2);
}

/**
 * Where a report may go: the address that the site hosting Craftly named when it was built (VITE_CRAFTLY_REPORT_URL), which is
 * a web address or a path on the site itself. Nowhere when none was named; the development server has one of its own so that
 * the whole flow can be tried.
 */
export function reportEndpoint(env: { DEV?: boolean; VITE_CRAFTLY_REPORT_URL?: string } = import.meta.env): string | null {
  const named = env.VITE_CRAFTLY_REPORT_URL?.trim();
  if (named) return /^https?:\/\/\S+$/i.test(named) || /^\/(?!\/)\S*$/.test(named) ? named : null;
  return env.DEV ? "/__report" : null;
}

/** Sends one report. Nothing goes without an address, with no cookies and no referrer; a problem that was sent is marked so. */
export async function sendReport(
  problem: Problem,
  endpoint: string | null = reportEndpoint(),
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<"sent" | "failed" | "unavailable"> {
  if (!endpoint) return "unavailable";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: reportText(problem),
      signal: controller.signal,
    });
    if (!response.ok) return "failed";
    markProblemSent(problem.id);
    return "sent";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- the list ---------------- */

let memory: Problem[] = [];
let counter = 0;

const isProblem = (value: unknown): value is Problem => {
  const p = value as Problem | null;
  return (
    !!p &&
    typeof p === "object" &&
    typeof p.id === "string" &&
    typeof p.at === "number" &&
    typeof p.kind === "string" &&
    typeof p.message === "string" &&
    typeof p.count === "number"
  );
};

/** True when the last attempt to store the list failed: the copy in memory is then the only one that is up to date. */
let unstored = false;

function read(): Problem[] {
  if (unstored) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return []; // never written, or cleared elsewhere (in another tab): the copy in memory must not come back
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isProblem) : [];
  } catch {
    return memory;
  }
}

function write(list: Problem[]): void {
  memory = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    unstored = false;
  } catch {
    unstored = true; // the list goes on in memory for as long as the page lives, or until the browser will store it again
  }
}

/** The problems on this device, newest first. */
export const listProblems = (): Problem[] => read();

export function clearProblems(): void {
  memory = [];
  unstored = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing was stored */
  }
}

export function markProblemSent(id: string): void {
  write(read().map((p) => (p.id === id ? { ...p, sent: true } : p)));
}

function describeThrown(thrown: unknown): { message: string; stack: string; name: string } {
  if (typeof thrown === "string") return { message: thrown, stack: "", name: "" };
  if (thrown && typeof thrown === "object" && typeof (thrown as { message?: unknown }).message === "string") {
    const error = thrown as { message: string; stack?: unknown; name?: unknown };
    return { message: error.message, stack: typeof error.stack === "string" ? error.stack : "", name: typeof error.name === "string" ? error.name : "" };
  }
  return { message: "", stack: "", name: "" };
}

/**
 * Writes a problem down. Gives back the entry (the one before it, counted again, when it is the same problem within a minute),
 * or null when it is not Craftly's to keep.
 */
export function recordProblem(kind: ProblemKind, thrown: unknown, options: { source?: string; now?: number } = {}): Problem | null {
  const { message: raw, stack: rawStack, name } = describeThrown(thrown);
  if (isNoise(raw, options.source, name)) return null;
  const now = options.now ?? Date.now();
  const message = cleanMessage(raw) || UNKNOWN_MESSAGE;
  const stack = cleanStack(rawStack);
  const list = read();
  const newest = list[0];
  const sameKind = kind === "screen" && kindOfLoadFailure(raw) ? "load" : kind;
  if (newest && newest.kind === sameKind && newest.message === message && newest.stack.split("\n")[0] === stack.split("\n")[0] && now - newest.at < SAME_PROBLEM_WINDOW) {
    const again = { ...newest, at: now, count: newest.count + 1 };
    write([again, ...list.slice(1)]);
    return again;
  }
  const problem: Problem = { id: `${now}-${++counter}`, at: now, kind: sameKind, message, stack, route: routeOf(window.location.hash), count: 1 };
  write([problem, ...list].slice(0, PROBLEM_LIMIT));
  return problem;
}
