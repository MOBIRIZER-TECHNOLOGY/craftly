/**
 * The one door to an account server (api.ts): what is sent with a request, and how every kind of answer that is not a plain JSON
 * object comes back (a refusal with the server's code, no answer at all, an answer too long or not JSON). The screens show only
 * the words of `cloudErrorText`, never the server's own sentence. The endpoints themselves are tested against a real server in
 * src/server/accounts and src/dashboard/account.
 */
import { describe, expect, it, vi } from "vitest";
import { CloudError, cloudErrorText, hostOf, normalizeAccountServer, request, type Conn } from "./api";
import { BadAnswer } from "./validate";

/** A connection whose fetch answers `status` with `body` (a string as it is, anything else as JSON), and records what it was asked. */
function answering(status: number, body: unknown, token: string | null = "T".repeat(43)) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  return { conn: { server: "https://accounts.example.org", token, fetch: fetch as unknown as typeof globalThis.fetch } satisfies Conn, fetch };
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("the request did not fail");
};

describe("request", () => {
  it("sends the session as a bearer token and the body as JSON, with no cookie and nothing kept in a cache", async () => {
    const { conn, fetch } = answering(200, { ok: true });
    expect(await request(conn, "POST", "/api/teams", { name: "Studio" })).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://accounts.example.org/api/teams");
    expect(init).toMatchObject({ method: "POST", body: '{"name":"Studio"}', cache: "no-store", credentials: "omit" });
    expect(init?.headers).toEqual({ authorization: `Bearer ${"T".repeat(43)}`, "content-type": "application/json" });
  });

  it("sends neither a token nor a content type when there is no session and no body", async () => {
    const { conn, fetch } = answering(200, {}, null);
    await request(conn, "GET", "/api/health");
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: {}, body: undefined });
  });

  it("turns a refusal into a CloudError with the server's code, and keeps the revision and the room it names", async () => {
    const error = await refusal(request(answering(409, { code: "conflict", rev: 7, room: "r1", message: "the server's own words" }).conn, "PUT", "/x", {}));
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ code: "conflict", status: 409, extra: { rev: 7, room: "r1" } });
  });

  it.each([
    ["a server error without a code", 503, "", "server"],
    ["a refusal without a body", 404, "", "unknown"],
    ["a code that is not a code", 400, { code: "<script>" }, "unknown"],
    ["a code of the wrong type", 400, { code: 42, rev: "7", room: 3 }, "unknown"],
  ])("calls %s by a code of its own", async (_what, status, body, code) => {
    const error = await refusal(request(answering(status, body).conn, "GET", "/x"));
    expect(error).toMatchObject({ code, status, extra: {} });
  });

  it("calls a server that cannot be reached, or does not answer in time, offline", async () => {
    const unreachable: Conn = { server: "https://accounts.example.org", token: null, fetch: (async () => Promise.reject(new TypeError("failed to fetch"))) as typeof fetch };
    expect(await refusal(request(unreachable, "GET", "/x"))).toMatchObject({ code: "offline", status: 0 });
    vi.useFakeTimers();
    try {
      const silent: Conn = { server: "https://accounts.example.org", token: null, fetch: (() => new Promise<Response>(() => undefined)) as typeof fetch };
      const late = refusal(request(silent, "GET", "/x", undefined, 5_000));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await late).toMatchObject({ code: "offline" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses an answer that is not a JSON object, or is longer than any answer should be", async () => {
    for (const body of ["not json", "", "[1, 2]", "null"]) expect(await refusal(request(answering(200, body).conn, "GET", "/x"))).toBeInstanceOf(BadAnswer);
    expect(await refusal(request(answering(200, "x".repeat(20 * 1024 * 1024 + 1)).conn, "GET", "/x"))).toBeInstanceOf(BadAnswer);
  });
});

describe("cloudErrorText", () => {
  it("says a refusal in the words of its code, an unknown code and any other failure in general words, and a bad answer as such", () => {
    expect(cloudErrorText(new CloudError("wrong", 401, "x"))).toBe("That email and password do not match.");
    expect(cloudErrorText(new CloudError("no-such-code", 400, "x"))).toBe("Something went wrong. Try again.");
    // a code that is a property of every object is not taken for a word
    expect(cloudErrorText(new CloudError("constructor", 400, "x"))).toBe("Something went wrong. Try again.");
    expect(cloudErrorText(new BadAnswer("teams"))).toBe("The account server sent something Craftly cannot use. Nothing of it was kept.");
    expect(cloudErrorText(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});

describe("the address of a server", () => {
  it.each([
    ["accounts.example.org", "https://accounts.example.org"],
    ["  https://accounts.example.org/craftly/  ", "https://accounts.example.org/craftly"],
    ["HTTP://Accounts.Example.org", "http://accounts.example.org"],
    ["localhost:8787", "http://localhost:8787"],
    ["127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["192.168.1.20", "http://192.168.1.20"],
    ["[::1]:8787", "http://[::1]:8787"],
  ])("keeps %j as %s", (typed, kept) => {
    expect(normalizeAccountServer(typed)).toBe(kept);
  });

  it.each([
    "",
    "   ",
    "ftp://files.example.org",
    "javascript:alert(1)",
    "https://ann:secret@accounts.example.org",
    "https://accounts.example.org/?a=1",
    "https://accounts.example.org/#x",
    "https://",
  ])("refuses %j", (typed) => {
    expect(normalizeAccountServer(typed)).toBeNull();
  });

  it("shows the host of a server, and what it was given when that is no address", () => {
    expect(hostOf("https://accounts.example.org:8443/craftly")).toBe("accounts.example.org:8443");
    expect(hostOf("not an address")).toBe("not an address");
  });
});
