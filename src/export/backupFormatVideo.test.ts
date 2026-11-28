/** Clips in a backup of the library: named by their type, and read back from the manifest as uploads of their own kind. */
import { describe, expect, it } from "vitest";
import { mimeForExtension, parseManifest, uploadEntryName } from "./backupFormat";

const manifestWith = (uploads: unknown[]) =>
  JSON.stringify({ craftlyBackup: 1, exportedAt: "2026-11-08T12:00:00.000Z", designs: [], uploads, folders: [], versions: [], brandKit: null });

describe("a clip in a backup", () => {
  it("is stored under the extension of its type and its type is known again from that name", () => {
    expect(uploadEntryName("a_1", "video/mp4")).toBe("uploads/a_1.mp4");
    expect(uploadEntryName("a_2", "video/webm")).toBe("uploads/a_2.webm");
    expect(uploadEntryName("a_3", "video/ogg")).toBe("uploads/a_3.ogv");
    expect(mimeForExtension("uploads/a_1.mp4")).toBe("video/mp4");
    expect(mimeForExtension("uploads/a_2.WEBM")).toBe("video/webm");
    expect(mimeForExtension("uploads/a_3.ogv")).toBe("video/ogg");
  });

  it("comes back as an upload of kind video, by the type it is given or by its file name", () => {
    const { manifest, skipped } = parseManifest(
      manifestWith([
        { id: "a_mp4", name: "Holiday", file: "uploads/a_mp4.mp4", mime: "video/mp4", size: 1234, width: 1920, height: 1080, createdAt: 7 },
        { id: "a_webm", file: "uploads/a_webm.webm" },
        { id: "a_ogv", file: "uploads/a_ogv.ogv" },
      ]),
    );
    expect(skipped).toBe(0);
    expect(manifest.uploads[0]).toEqual({
      id: "a_mp4",
      name: "Holiday",
      kind: "video",
      mime: "video/mp4",
      size: 1234,
      width: 1920,
      height: 1080,
      createdAt: 7,
      file: "uploads/a_mp4.mp4",
    });
    expect(manifest.uploads.slice(1).map((u) => [u.kind, u.mime])).toEqual([
      ["video", "video/webm"],
      ["video", "video/ogg"],
    ]);
  });

  it("is left out, and counted, when its type is a video type no upload may be", () => {
    const { manifest, skipped } = parseManifest(
      manifestWith([
        { id: "a_mov", file: "uploads/a_mov.mov", mime: "video/quicktime" },
        { id: "a_mp4", file: "uploads/a_mp4.mp4", mime: "video/mp4" },
      ]),
    );
    expect(manifest.uploads.map((u) => u.id)).toEqual(["a_mp4"]);
    expect(skipped).toBe(1);
  });

  it("does not make a picture whose name says mp4 a clip: the type it is given decides", () => {
    const { manifest } = parseManifest(manifestWith([{ id: "a_pic", file: "uploads/a_pic.mp4", mime: "image/png" }]));
    expect(manifest.uploads[0]).toMatchObject({ kind: "image", mime: "image/png" });
  });
});
