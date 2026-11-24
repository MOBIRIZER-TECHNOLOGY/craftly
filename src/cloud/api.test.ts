import { describe, expect, it } from "vitest";
import { request } from "./api";
import { BadAnswer } from "./validate";

const conn = { server: "https://accounts.example.test", token: null };

describe("account requests", () => {
  it("reads a JSON object", async () => {
    const answer = await request({ ...conn, fetch: async () => new Response('{"ok":true}') }, "GET", "/api/me");
    expect(answer).toEqual({ ok: true });
  });

  it("refuses an answer as soon as its body is over the limit", async () => {
    const body = new Uint8Array(20 * 1024 * 1024 + 1);
    await expect(request({ ...conn, fetch: async () => new Response(body) }, "GET", "/api/big")).rejects.toBeInstanceOf(BadAnswer);
  });

  it("times out and aborts while the body is still arriving", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          },
        }),
      );
    };
    await expect(request({ ...conn, fetch: fetcher }, "GET", "/api/slow", undefined, 20)).rejects.toMatchObject({ code: "offline" });
    expect(signal?.aborted).toBe(true);
  });

  it("decodes multi-byte text split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"word":"हिन्दी"}');
    const fetcher = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 12));
            controller.enqueue(bytes.slice(12, 15));
            controller.enqueue(bytes.slice(15));
            controller.close();
          },
        }),
      );
    await expect(request({ ...conn, fetch: fetcher }, "GET", "/api/i18n")).resolves.toEqual({ word: "हिन्दी" });
  });
});
