/**
 * The link of an invite (inviteLink.ts): it carries the account server after the `#`, as a live link does, and is read back
 * strictly.
 */
import { describe, expect, it } from "vitest";
import { inviteUrl, parseInvite } from "./inviteLink";

const CODE = "AbCdEfGhIjKlMnOpQrStUv";
const b64 = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("an invite link", () => {
  it("carries the code and the server, all of it after the # (sent to no server, in no Referer)", () => {
    const url = inviteUrl("https://app.example.org/craftly/#/team/t1", CODE, "https://accounts.example.org");
    const [page, hash] = url.split("#");
    expect(page).toBe("https://app.example.org/craftly/");
    expect(hash.startsWith(`/invite/${CODE}.`)).toBe(true);
    expect(parseInvite(hash.slice("/invite/".length))).toEqual({ code: CODE, server: "https://accounts.example.org" });
  });

  it("keeps a server with a port and a path, and one on this machine", () => {
    for (const server of ["http://127.0.0.1:8787", "https://example.org/accounts", "http://localhost:3000"]) {
      const part = inviteUrl("https://app.example.org/", CODE, server).split("#/invite/")[1];
      expect(parseInvite(part)).toEqual({ code: CODE, server });
    }
  });

  it("reads a link of before, which names no server", () => {
    expect(parseInvite(CODE)).toEqual({ code: CODE, server: null });
  });

  it("is refused when the code or the server is not one", () => {
    for (const part of [
      "",
      "short",
      `${CODE}.`,
      `${CODE}.${b64("javascript:alert(1)")}`,
      `${CODE}.${b64("data:text/html,hi")}`,
      `${CODE}.${b64("https://user:pw@evil.example")}`,
      `${CODE}.${b64("https://example.org/?q=1")}`,
      `${CODE}.not base64!`,
      `${CODE}.${"A".repeat(800)}`,
      `bad code here!.${b64("https://example.org")}`,
    ]) {
      expect(parseInvite(part)).toBeNull();
    }
  });
});
