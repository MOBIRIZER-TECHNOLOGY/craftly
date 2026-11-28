/** The clips of video elements in a project file: found and renamed with the pictures, left out when only pictures may travel. */
import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createImage, createPage, createVideo } from "@/core/factory";
import type { Design, GroupElement, VideoElement } from "@/core/types";
import { collectAssetIds, extensionForMime, remapAssetSources } from "./projectFormat";

/** A picture, a clip on the page, a clip inside a group inside a group, and a clip that is no upload. */
function withClips(): Design {
  const page = createPage({ background: { type: "image", src: "asset:bg", fit: "cover" } });
  page.elements.push(
    createImage({ src: "asset:photo", width: 50, height: 50 }),
    createVideo({ id: "v1", src: "asset:clip1" }),
    createGroup([createGroup([createVideo({ id: "v2", src: "asset:clip2" }), createImage({ src: "asset:nested", width: 10, height: 10 })])]),
    createVideo({ id: "v3", src: "builtin:not-an-upload" }),
  );
  return createDesign({ width: 800, height: 600, pages: [page] });
}

describe("the clips of a design", () => {
  it("are among the uploads a design uses, inside groups too, in first-use order", () => {
    expect(collectAssetIds(withClips())).toEqual(["bg", "photo", "clip1", "clip2", "nested"]);
  });

  it("are left out when only pictures are asked for, wherever they are", () => {
    expect(collectAssetIds(withClips(), { clips: false })).toEqual(["bg", "photo", "nested"]);
  });

  it("are counted once however many video elements play the same clip", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(createVideo({ src: "asset:same" }), createVideo({ src: "asset:same" }));
    expect(collectAssetIds(d, { clips: true })).toEqual(["same"]);
  });

  it("are pointed at their new ids when the uploads are renamed, inside groups too, and the input is left alone", () => {
    const d = withClips();
    const before = JSON.stringify(d);
    const out = remapAssetSources(d, { clip1: "NEW1", clip2: "NEW2" });
    expect(JSON.stringify(d)).toBe(before);
    const [, top, group, other] = out.pages[0].elements;
    expect((top as VideoElement).src).toBe("asset:NEW1");
    expect((((group as GroupElement).children[0] as GroupElement).children[0] as VideoElement).src).toBe("asset:NEW2");
    // what is not in the map, or not an upload, stays as it was
    expect((other as VideoElement).src).toBe("builtin:not-an-upload");
    expect(collectAssetIds(out)).toEqual(["bg", "photo", "NEW1", "NEW2", "nested"]);
  });

  it("keep the rest of a video element when its clip is renamed", () => {
    const d = createDesign({ width: 10, height: 10 });
    d.pages[0].elements.push(createVideo({ src: "asset:clip", trimStart: 1, trimEnd: 3, duration: 5, speed: 2, muted: true }));
    const clip = remapAssetSources(d, { clip: "NEW" }).pages[0].elements[0] as VideoElement;
    expect(clip).toMatchObject({ src: "asset:NEW", trimStart: 1, trimEnd: 3, duration: 5, speed: 2, muted: true });
  });
});

describe("the file extension of a clip", () => {
  it("is mp4, webm or ogv for the clips an upload may be, whatever the case of the type", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("video/webm")).toBe("webm");
    expect(extensionForMime("VIDEO/OGG")).toBe("ogv");
  });
});
