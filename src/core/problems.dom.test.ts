/** The log of problems on this device (localStorage, so that it still works when IndexedDB is what failed) and the one way out of it. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROBLEM_LIMIT, clearProblems, currentEnvironment, listProblems, markProblemSent, recordProblem, reportEndpoint, reportText, sendReport } from "./problems";

const KEY = "craftly.problems.v1";
const error = (message: string) => new Error(message);

beforeEach(() => {
  localStorage.clear();
  clearProblems();
  window.location.hash = "";
});

describe("recording a problem", () => {
  it("keeps the message, a cleaned stack, the screen and the time, newest first", () => {
    window.location.hash = "#/design/d_secret";
    const first = recordProblem("script", error("first"), { now: 1000 })!;
    const second = recordProblem("promise", error("second"), { now: 2000 })!;
    expect(first).toMatchObject({ kind: "script", message: "first", route: "design", count: 1, at: 1000 });
    expect(first.stack).not.toMatch(/https?:/);
    expect(listProblems().map((p) => p.message)).toEqual(["second", "first"]);
    expect(second.id).not.toBe(first.id);
  });

  it("writes it to localStorage as it goes, so that it is there after a reload", () => {
    recordProblem("script", error("kept"), { now: 1000 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject([{ message: "kept" }]);
  });

  it("counts the same problem again within a minute instead of listing it twice", () => {
    recordProblem("script", error("same"), { now: 1000 });
    const again = recordProblem("script", error("same"), { now: 30_000 })!;
    expect(again.count).toBe(2);
    expect(again.at).toBe(30_000);
    expect(listProblems()).toHaveLength(1);
  });

  it("lists it again when it comes back a minute later, or is a different kind", () => {
    recordProblem("script", error("same"), { now: 1000 });
    recordProblem("script", error("same"), { now: 1000 + 61_000 });
    recordProblem("promise", error("same"), { now: 1000 + 62_000 });
    expect(listProblems()).toHaveLength(3);
  });

  it("keeps the last twenty and lets the oldest go", () => {
    for (let i = 0; i < PROBLEM_LIMIT + 5; i++) recordProblem("script", error(`problem ${i}`), { now: i * 100_000 });
    const list = listProblems();
    expect(list).toHaveLength(PROBLEM_LIMIT);
    expect(list[0].message).toBe(`problem ${PROBLEM_LIMIT + 4}`);
    expect(list.at(-1)!.message).toBe("problem 5");
  });

  it("does not keep what is not Craftly's: an extension, a script of another site, a cancelled request", () => {
    expect(recordProblem("script", error("from an extension"), { source: "chrome-extension://abc/x.js" })).toBeNull();
    expect(recordProblem("script", error("Script error."))).toBeNull();
    expect(recordProblem("promise", Object.assign(error("The user aborted a request."), { name: "AbortError" }))).toBeNull();
    expect(listProblems()).toEqual([]);
  });

  it("calls a screen that stopped because a part of Craftly could not be fetched a load problem", () => {
    expect(recordProblem("screen", error("Failed to fetch dynamically imported module: https://x/y.js"))!.kind).toBe("load");
    expect(recordProblem("script", error("Failed to fetch dynamically imported module: https://x/y.js"))!.kind).toBe("script");
  });

  it("takes what is thrown, whatever it is: a text, an object with a message, nothing", () => {
    expect(recordProblem("promise", "just a text", { now: 1 })!.message).toBe("just a text");
    expect(recordProblem("promise", { message: "an object" }, { now: 2 })!.message).toBe("an object");
    expect(recordProblem("promise", undefined, { now: 3 })!.message).toBe("Something failed without saying what.");
    expect(recordProblem("promise", { odd: true }, { now: 4 })!.message).toBe("Something failed without saying what.");
  });

  it("goes on in memory when the browser will not store it", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const recorded = recordProblem("script", error("no room"), { now: 1 });
    set.mockRestore();
    expect(recorded).not.toBeNull();
    expect(listProblems().map((p) => p.message)).toEqual(["no room"]);
  });

  it("keeps the newest problems in memory for as long as the browser will not store them, and stores them again once it will", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    recordProblem("script", error("one"), { now: 1 });
    recordProblem("script", error("two"), { now: 2 });
    expect(listProblems().map((p) => p.message)).toEqual(["two", "one"]);
    set.mockRestore();
    recordProblem("script", error("three"), { now: 3 });
    expect(listProblems().map((p) => p.message)).toEqual(["three", "two", "one"]);
    expect((JSON.parse(localStorage.getItem(KEY)!) as Array<{ message: string }>).map((p) => p.message)).toEqual(["three", "two", "one"]);
    localStorage.removeItem(KEY); // storing works again, so what is stored is the truth again, whatever the page remembers
    expect(listProblems()).toEqual([]);
  });

  it("forgets what it kept in memory when the list is cleared, even if the browser will not be read afterwards", () => {
    recordProblem("script", error("old"), { now: 1 });
    clearProblems();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      expect(listProblems()).toEqual([]);
    } finally {
      get.mockRestore();
    }
  });

  it("does not bring back a list that was cleared elsewhere, in another tab say, when it writes the next problem", () => {
    recordProblem("script", error("old"), { now: 1000 });
    localStorage.removeItem(KEY); // the copy of this page must not come back
    expect(listProblems()).toEqual([]);
    recordProblem("script", error("new"), { now: 2000 });
    expect(listProblems().map((p) => p.message)).toEqual(["new"]);
    expect((JSON.parse(localStorage.getItem(KEY)!) as Array<{ message: string }>).map((p) => p.message)).toEqual(["new"]);
  });

  it("starts again from an empty list when what is stored cannot be read", () => {
    localStorage.setItem(KEY, "{not json");
    expect(listProblems()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ not: "a list" }));
    expect(listProblems()).toEqual([]);
    recordProblem("script", error("after"), { now: 1 });
    expect(listProblems().map((p) => p.message)).toEqual(["after"]);
  });

  it("marks a problem as sent, and forgets all of them on request", () => {
    const p = recordProblem("script", error("send me"), { now: 1 })!;
    markProblemSent(p.id);
    expect(listProblems()[0].sent).toBe(true);
    markProblemSent("nope");
    clearProblems();
    expect(listProblems()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("the build a report names", () => {
  const stamp = (content?: string) => {
    document.head.querySelectorAll('meta[name="craftly-build"]').forEach((meta) => meta.remove());
    if (content === undefined) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "craftly-build");
    meta.setAttribute("content", content);
    document.head.append(meta);
  };

  it("is the id stamped into the page, and says dev when there is none or the stamp was never filled in", () => {
    stamp();
    expect(currentEnvironment().build).toBe("dev");
    stamp("__BUILD_ID__");
    expect(currentEnvironment().build).toBe("dev");
    stamp("  ");
    expect(currentEnvironment().build).toBe("dev");
    stamp(" 20261109-ab12 ");
    expect(currentEnvironment().build).toBe("20261109-ab12");
    stamp();
  });
});

describe("where a report may go", () => {
  it("is where the site that hosts Craftly says, and nowhere otherwise", () => {
    expect(reportEndpoint({ VITE_CRAFTLY_REPORT_URL: "https://reports.example.org/in" })).toBe("https://reports.example.org/in");
    expect(reportEndpoint({ VITE_CRAFTLY_REPORT_URL: "/reports" })).toBe("/reports");
    expect(reportEndpoint({})).toBeNull();
    expect(reportEndpoint({ VITE_CRAFTLY_REPORT_URL: "" })).toBeNull();
    expect(reportEndpoint({ VITE_CRAFTLY_REPORT_URL: "   " })).toBeNull();
  });

  it("is the development server's own address when nothing else is said, so that the whole flow can be tried", () => {
    expect(reportEndpoint({ DEV: true })).toBe("/__report");
    expect(reportEndpoint({ DEV: true, VITE_CRAFTLY_REPORT_URL: "https://reports.example.org/in" })).toBe("https://reports.example.org/in");
    expect(reportEndpoint({ DEV: false })).toBeNull();
  });

  it("is only a web address or a path on this site", () => {
    for (const bad of ["javascript:alert(1)", "data:text/plain,x", "//evil.example.org/in", "ftp://x/in", "reports"])
      expect(reportEndpoint({ VITE_CRAFTLY_REPORT_URL: bad })).toBeNull();
  });
});

describe("sending a report", () => {
  const ok = () => Promise.resolve(new Response(null, { status: 204 }));

  it("sends nothing when there is nowhere to send it", async () => {
    const fetcher = vi.fn(ok);
    const p = recordProblem("script", error("boom"), { now: 1 })!;
    expect(await sendReport(p, null, fetcher)).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    expect(listProblems()[0].sent).toBeUndefined();
  });

  it("posts the text that the person saw, with no cookies, no referrer and no cache, and marks the problem as sent", async () => {
    const fetcher = vi.fn(ok);
    const p = recordProblem("script", error("boom"), { now: 1 })!;
    expect(await sendReport(p, "https://reports.example.org/in", fetcher)).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://reports.example.org/in");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain;charset=UTF-8");
    expect(init.body).toBe(reportText(p));
    expect(listProblems()[0].sent).toBe(true);
  });

  it("says that it failed, and leaves the problem unsent, when the answer is an error or there is no answer", async () => {
    const p = recordProblem("script", error("boom"), { now: 1 })!;
    expect(await sendReport(p, "https://r.example.org/in", () => Promise.resolve(new Response(null, { status: 500 })))).toBe("failed");
    expect(await sendReport(p, "https://r.example.org/in", () => Promise.reject(new TypeError("Failed to fetch")))).toBe("failed");
    expect(listProblems()[0].sent).toBeUndefined();
  });

  it("gives up after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const p = recordProblem("script", error("boom"), { now: 1 })!;
      const pending = sendReport(
        p,
        "https://r.example.org/in",
        (_url, init) => new Promise((_resolve, reject) => (init as RequestInit).signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await pending).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing of the design that is open, the person or the page title", async () => {
    document.title = "Priya's wedding invitation - Craftly";
    window.location.hash = "#/design/d_priyas_wedding";
    const fetcher = vi.fn(ok);
    const p = recordProblem("script", error("Cannot read properties of undefined"), { now: 1 })!;
    await sendReport(p, "https://reports.example.org/in", fetcher);
    const body = String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).not.toMatch(/Priya|wedding|d_priyas/);
    expect(JSON.parse(body).route).toBe("design");
  });
});
