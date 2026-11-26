/** The sounds of a design (design version 3) in a project file: kept, checked, counted when left out, and their uploads found and renamed. */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createVideo } from "@/core/factory";
import type { AudioTrack, Design } from "@/core/types";
import { buildProjectFile, collectAssetIds, parseProjectFile, parseStoredDesign, remapAssetSources, type ImportReport } from "./projectFormat";

const song: AudioTrack = { id: "au1", src: "asset:a_song", name: "Song", duration: 30, trimStart: 0, trimEnd: 30, startAt: 2, loop: true, volume: 0.5 };
const design = (audio: unknown[] = [song]): Design =>
  ({
    ...createDesign({ title: "Music", width: 400, height: 300, pages: [createPage({ elements: [createVideo({ src: "asset:a_clip", duration: 2 })] })] }),
    audio,
  }) as Design;

describe("the sounds of a design in a project file", () => {
  it("are uploads the design uses, but not for those who carry no clips", () => {
    expect(collectAssetIds(design())).toEqual(["a_clip", "a_song"]);
    expect(collectAssetIds(design(), { clips: false })).toEqual([]);
    expect(collectAssetIds({ pages: [] })).toEqual([]);
  });

  it("point at the new id of their upload when the uploads are renamed", () => {
    const moved = remapAssetSources(design(), { a_song: "a_new" });
    expect(moved.audio![0]).toEqual({ ...song, src: "asset:a_new" });
    expect(remapAssetSources(createDesign({ width: 10, height: 10 }), { a_song: "a_new" }).audio).toBeUndefined();
  });

  it("come back from a file as they were", () => {
    const back = parseProjectFile(JSON.stringify(buildProjectFile(design(), {})));
    expect(back.design.audio).toEqual([song]);
    expect(parseStoredDesign(design()).audio).toEqual([song]);
  });

  it("leave out a sound that cannot be used, and say how many", () => {
    const report: ImportReport = { skipped: 0 };
    const back = parseProjectFile(JSON.stringify(buildProjectFile(design([song, { ...song, id: "au2", src: "https://example.test/x.mp3" }, "x"]), {})), report);
    expect(back.design.audio).toEqual([song]);
    expect(report.audio).toBe(2);
    const none: ImportReport = { skipped: 0 };
    expect(parseProjectFile(JSON.stringify(buildProjectFile(design(["x"]), {})), none).design.audio).toBeUndefined();
    expect(none.audio).toBe(1);
  });
});
