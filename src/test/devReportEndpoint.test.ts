import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import config, { answerReport, devReportEndpoint } from "../../vite.config";

/**
 * The development server answers a report that the page sends to /__report, so that the whole flow (the Send button, the
 * request, the toast) can be tried without a server of one's own. It prints the report in the terminal and keeps nothing.
 */
function ask(method: string, body: string | Buffer[] = "") {
  const chunks = typeof body === "string" ? [Buffer.from(body)] : body;
  const req = Object.assign(Readable.from(chunks), { method, url: "/" }) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  const res = { statusCode: 0, setHeader: (name: string, value: string) => (headers[name] = value), end: vi.fn() } as unknown as ServerResponse & { end: ReturnType<typeof vi.fn> };
  const log = vi.fn();
  return { req, res, headers, log, done: () => answerReport(req, res, log) };
}

describe("the development server's address for reports", () => {
  it("is part of the project's configuration, for the dev server only", () => {
    const plugin = (config.plugins as Array<{ name?: string; apply?: string }>).find((p) => p?.name === "craftly-dev-report-endpoint");
    expect(plugin).toMatchObject({ apply: "serve" });
  });

  it("answers a report with no content, and prints it", async () => {
    const report = JSON.stringify({ app: "craftly", message: "boom" });
    const { res, log, done } = ask("POST", report);
    await done();
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('"message":"boom"');
  });

  it("takes the body in pieces", async () => {
    const { res, done } = ask("POST", [Buffer.from('{"a":'), Buffer.from('"b"}')]);
    await done();
    expect(res.statusCode).toBe(204);
  });

  it("refuses anything but a POST", async () => {
    const { res, headers, log, done } = ask("GET");
    await done();
    expect(res.statusCode).toBe(405);
    expect(headers.Allow).toBe("POST");
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses what is not JSON", async () => {
    const { res, log, done } = ask("POST", "not json at all");
    await done();
    expect(res.statusCode).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses a body that is too long", async () => {
    const { res, log, done } = ask("POST", [Buffer.alloc(15_000, "a"), Buffer.alloc(15_000, "a")]);
    await done();
    expect(res.statusCode).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it("is wired to /__report when the server is configured", () => {
    const use = vi.fn();
    const plugin = devReportEndpoint(vi.fn());
    (plugin.configureServer as (server: unknown) => void)({ middlewares: { use } });
    expect(use).toHaveBeenCalledWith("/__report", expect.any(Function));
  });
});
