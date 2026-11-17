/**
 * What every set of HTTP routes of the server needs: answering in JSON, reading a body up to a limit, the CORS headers, the
 * refusal of pages of other origins, the address a request names, comparing a secret, and the check of an uploaded picture.
 * The rooms (live.ts) and the accounts (accounts/routes.ts) both use these, so that a rule is written once and is the same in
 * both. Nothing here keeps state.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SharedAsset } from "./storage";

/** The origins that may call the HTTP interface from a page: "*", or a list. None: no CORS headers at all. */
export type AllowOrigin = string | string[] | undefined;

export const sha256 = (text: string) => createHash("sha256").update(text).digest();
export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Whether what was shown is the secret, in a time that does not depend on how much of it is right. Both are hashed first, so that
 * they are compared at one length whatever was sent; that the secret has a length is no secret.
 */
export const sameSecret = (secret: string, shown: unknown): boolean => typeof shown === "string" && timingSafeEqual(sha256(secret), sha256(shown));

export const reply = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Answers 413 for a body that was longer than allowed, and drops the connection once the answer has gone: the rest of the body
 * is still arriving, and reading it to the end is the work the limit is there to spare.
 */
export const replyTooBig = (req: IncomingMessage, res: ServerResponse, body: unknown) => {
  res.setHeader("connection", "close");
  reply(res, 413, body);
  res.once("finish", () => req.socket.destroy());
};

/** The body of a request as text, or null when it is longer than allowed (the request is then dropped). */
export const readBody = (req: IncomingMessage, limit: number): Promise<string | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit)
        resolve(null); // the rest is read and thrown away until the answer has gone, then the connection is dropped
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });

/** What a preflight is told, beyond the origin: the methods and the headers a page may use. */
export interface CorsAllowance {
  methods: string;
  headers: string;
}

/** What the rooms need: their own headers for the keys, and no PATCH. */
export const ROOM_CORS: CorsAllowance = {
  methods: "GET, POST, PUT, DELETE, OPTIONS",
  headers: "content-type, x-craftly-key, x-craftly-create-key",
};

export const cors = (req: IncomingMessage, res: ServerResponse, allow: AllowOrigin, allowance: CorsAllowance = ROOM_CORS) => {
  if (!allow) return;
  const origin = req.headers.origin;
  if (allow === "*") res.setHeader("access-control-allow-origin", "*");
  else if (origin && (Array.isArray(allow) ? allow : [allow]).includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-methods", allowance.methods);
  res.setHeader("access-control-allow-headers", allowance.headers);
  res.setHeader("access-control-max-age", "600");
};

/**
 * Whether a request comes from a page that may not use this server: the server was given a list of origins, the request names
 * its origin, as every browser does for a WebSocket and for anything that is not a plain GET, and that origin is not on the list.
 * The CORS headers above do not do this. They stop a page from reading an answer, not from sending the request: making a room
 * needs no permission beforehand (its body has no content type that would), and a WebSocket is not subject to CORS at all.
 * It keeps the pages of other sites out, not a program, which names whatever origin it likes or none.
 */
export const foreign = (req: IncomingMessage, allow: AllowOrigin): boolean => {
  if (!allow || allow === "*") return false;
  const origin = req.headers.origin;
  return origin !== undefined && !(Array.isArray(allow) ? allow : [allow]).includes(origin);
};

/** The address a request names, as a URL of this server, or null for one that is no path of it. */
export const requestTarget = (req: IncomingMessage): URL | null => {
  const raw = req.url ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    return new URL(raw, "http://localhost");
  } catch {
    return null;
  }
};

/* ---------------- uploaded pictures ---------------- */

export const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif|bmp)$/;
/** base64 for up to 9 MiB */
export const ASSET_LIMIT = 12 * 1024 * 1024;

/**
 * An uploaded picture as it came, if it is one that may be kept: a picture type, and base64 that is exactly what its bytes
 * write (so that what is stored and served back is what was checked), up to `ASSET_LIMIT`. Null otherwise.
 */
export function checkAsset(value: unknown): SharedAsset | null {
  const asset = value as Partial<SharedAsset> | null;
  const mime = asset?.mime;
  const base64 = asset?.base64;
  if (
    typeof mime !== "string" ||
    !IMAGE_TYPE.test(mime) ||
    typeof base64 !== "string" ||
    !base64 ||
    base64.length > ASSET_LIMIT ||
    base64.length % 4 ||
    /[^A-Za-z0-9+/=]/.test(base64) ||
    Buffer.from(base64, "base64").toString("base64") !== base64
  ) {
    return null;
  }
  return { mime, base64 };
}
