/**
 * Uploading the images of a shared design: which answers of the server mean that trying again cannot help (the edit is then given
 * up, src/collab/live.ts) and which are taken for a passing problem (the edit is tried again later).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermanentSendError } from "@/collab/live";
import * as assets from "@/core/assets";
import { createDesign, createImage, createPage } from "@/core/factory";
import type { Asset, Design, LiveLink } from "@/core/types";
import { wipeDatabase } from "@/test/logicDb";
import { sharedMedia } from "./media";

vi.mock("@/core/assets", async (original) => ({ ...(await original<typeof import("@/core/assets")>()), getAsset: vi.fn() }));

const link: LiveLink = { server: "https://live.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "WjGO30NJy5udhntaj-8j9w", role: "edit" };
const design = (): Design => createDesign({ title: "With a picture", width: 800, height: 600, pages: [createPage({ elements: [createImage({ id: "i", src: "asset:pic" })] })] });
const picture: Asset = { id: "pic", name: "Picture", kind: "image", mime: "image/png", size: 3, width: 1, height: 1, createdAt: 0, blob: new Blob(["png"], { type: "image/png" }) };
const getAsset = vi.mocked(assets.getAsset);
const answering = (status: number) => vi.fn(async () => ({ ok: status < 400, status }) as Response);
/** How the upload ended: nothing when it went well, otherwise what it rejected with. */
const outcome = (request: typeof fetch) =>
  sharedMedia(link, request)
    .upload(design())
    .then(
      () => null,
      (error: unknown) => error as Error,
    );

beforeEach(() => {
  getAsset.mockReset();
  getAsset.mockResolvedValue(picture);
});

describe("uploading the images of a shared design", () => {
  it("sends an image once, with the key in a header", async () => {
    const request = answering(201);
    const media = sharedMedia(link, request);
    await media.upload(design());
    await media.upload(design());
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://live.example.test/api/rooms/TW-FaxWt8edjpnT-bGQyjA/assets/pic");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["x-craftly-key"]).toBe(link.key);
    expect(JSON.parse(String(init.body))).toEqual({ mime: "image/png", base64: "cG5n" });
  });

  it("leaves out an image that this person did not add", async () => {
    const request = answering(201);
    await sharedMedia(link, request).upload(design(), new Set(["another"]));
    expect(request).not.toHaveBeenCalled();
  });

  it.each([413, 409, 400, 403])("says that trying again cannot help when the server refuses the image itself (%i)", async (status) => {
    const error = await outcome(answering(status));
    expect(error).toBeInstanceOf(PermanentSendError);
    expect(error?.message).toContain(String(status));
  });

  it.each([500, 503, 429, 408])("takes a server that is broken or busy for a passing problem (%i)", async (status) => {
    const error = await outcome(answering(status));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSendError);
  });

  it("takes a server that cannot be reached for a passing problem", async () => {
    const error = await outcome(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(error).toBeInstanceOf(TypeError);
  });
});

describe("an image that is not on this device", () => {
  beforeEach(() => getAsset.mockResolvedValue(null));

  it("is not sent when the room has it already: somebody else added it", async () => {
    const request = answering(200);
    expect(await outcome(request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect((request.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBeUndefined();
  });

  it("cannot be helped by trying again when the room does not have it either", async () => {
    const error = await outcome(answering(404));
    expect(error).toBeInstanceOf(PermanentSendError);
    expect(error?.message).toMatch(/missing/);
  });

  it("is asked for again later when the server could not say whether it has it", async () => {
    const error = await outcome(answering(503));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSendError);
  });
});

describe("an image that somebody else added", () => {
  beforeEach(async () => {
    getAsset.mockResolvedValue(null);
    await wipeDatabase();
  });
  const serving = (mime: string, content: string) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ mime, base64: btoa(content) }) }) as Response);

  it("is kept on this device under its id", async () => {
    await sharedMedia(link, serving("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"/>`)).download(design());
    expect(await assets.listAssets()).toMatchObject([{ id: "pic", kind: "svg", mime: "image/svg+xml", width: 30, height: 20 }]);
  });

  it("is kept as a PNG picture, not as an SVG, when it is an SVG that is more than plain drawing", async () => {
    const scripted = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><script>alert(document.domain)</script></svg>`;
    await sharedMedia(link, serving("image/svg+xml", scripted)).download(design());
    expect(await assets.listAssets()).toMatchObject([{ id: "pic", kind: "image", mime: "image/png", width: 1024, height: 683 }]);
  });
});
