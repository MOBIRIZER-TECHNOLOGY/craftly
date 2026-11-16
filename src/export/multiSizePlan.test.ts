import { describe, expect, it } from "vitest";
import { DESIGN_TYPES } from "@/data/designTypes";
import {
  CURRENT_SIZE_ID,
  MAX_SIZES,
  MAX_TOTAL_PIXELS,
  defaultSizeIds,
  multiSizeFileName,
  multiSizeOptions,
  multiSizeZipName,
  planMultiSize,
  sizeChoices,
  sizeLabel,
} from "./multiSizePlan";

const story = { width: 1080, height: 1920, typeId: "instagram-story" };
const custom = { width: 400, height: 300, typeId: "custom" };

describe("sizeChoices", () => {
  it("puts the size of the design first, under the name of its format", () => {
    const [first] = sizeChoices(story);
    expect(first).toEqual({ id: CURRENT_SIZE_ID, name: "Instagram Story", fileName: "Instagram Story", width: 1080, height: 1920, current: true });
  });

  it("names the files in English whatever the language of the page, and shows the name of the page's language", () => {
    const shown = { ...sizeChoices(story)[0], name: "इंस्टाग्राम स्टोरी" };
    expect(multiSizeFileName("Menu", shown, null, "png")).toBe("Menu - Instagram Story 1080x1920.png");
  });

  it("calls a size that is no format the original size", () => {
    expect(sizeChoices(custom)[0]).toMatchObject({ id: CURRENT_SIZE_ID, name: "Original size", width: 400, height: 300 });
    // a format id that does not match the size any more (the design was resized) is not believed
    expect(sizeChoices({ width: 500, height: 900, typeId: "instagram-story" })[0].name).toBe("Original size");
  });

  it("names a design by the format whose size it has, even when it was made as a custom one", () => {
    expect(sizeChoices({ width: 1280, height: 720, typeId: "custom" })[0].name).toBe("YouTube Thumbnail");
  });

  it("lists the family of the design before the other formats", () => {
    const names = sizeChoices(story).map((c) => c.name);
    expect(names.slice(1, 4)).toEqual(["Instagram Post (4:5)", "Instagram Post (Square)", "Facebook Post"]);
    expect(names.indexOf("Presentation (16:9)")).toBeGreaterThan(names.indexOf("YouTube Banner"));
    // a design of the print family starts with the printables
    expect(sizeChoices({ width: 794, height: 1123, typeId: "flyer-a4" })[1].name).toBe("Poster (18 × 24 in)");
  });

  it("offers every size once: not the size of the design again, and not two formats of one size", () => {
    const choices = sizeChoices(story);
    const keys = choices.map((c) => `${c.width}x${c.height}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(choices.filter((c) => c.width === 1080 && c.height === 1920)).toHaveLength(1);
    expect(choices.some((c) => c.id === "instagram-story")).toBe(false);
    // US Letter is a flyer, a menu, a document and a resume: one line
    expect(choices.filter((c) => c.width === 816 && c.height === 1056)).toHaveLength(1);
    expect(new Set(choices.map((c) => c.id)).size).toBe(choices.length);
    expect(choices.length).toBeLessThanOrEqual(DESIGN_TYPES.length + 1);
  });

  it("puts a design of an unknown family with the social formats", () => {
    expect(sizeChoices(custom)[1].name).toBe("Instagram Post (4:5)");
  });
});

describe("defaultSizeIds", () => {
  it("ticks the size of the design and three of its family, the popular ones first", () => {
    expect(defaultSizeIds(story)).toEqual([CURRENT_SIZE_ID, "instagram-post", "facebook-post", "youtube-thumbnail"]);
  });

  it("takes what a small family has", () => {
    expect(defaultSizeIds({ width: 1920, height: 1080, typeId: "presentation" })).toEqual([CURRENT_SIZE_ID, "presentation-4-3"]);
  });
});

describe("names", () => {
  it("writes the size in pixels", () => {
    expect(sizeLabel({ width: 1080, height: 1920 })).toBe("1080 × 1920 px");
  });

  it("names a file after the design, the format and the size", () => {
    const choice = sizeChoices(custom).find((c) => c.id === "instagram-story")!;
    expect(multiSizeFileName("Menu", choice, null, "png")).toBe("Menu - Instagram Story 1080x1920.png");
    expect(multiSizeFileName("Menu", choice, 3, "jpg")).toBe("Menu - Instagram Story 1080x1920 - 3.jpg");
  });

  it("keeps a name that every file system takes, whatever the title and the format are called", () => {
    const twitter = sizeChoices(custom).find((c) => c.id === "twitter-post")!;
    expect(multiSizeFileName('a/b:c*?"<>|', twitter, null, "png")).toBe("a b c - X Twitter Post 1600x900.png");
    expect(multiSizeFileName("", twitter, 1, "pdf")).toBe("Untitled design - X Twitter Post 1600x900 - 1.pdf");
    // a very long title keeps the part that tells the sizes apart
    expect(multiSizeFileName("x".repeat(300), twitter, 2, "png")).toMatch(/^x{100} - X Twitter Post 1600x900 - 2\.png$/);
  });

  it("gives every file of an export its own name", () => {
    const plan = planMultiSize(
      { ...custom, pages: [{}, {}] },
      sizeChoices(custom).map((c) => c.id),
      [0, 1],
      "png",
    );
    const names = plan.sizes.flatMap((s) => [1, 2].map((n) => multiSizeFileName("Menu", s, n, "png").toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });

  it("names the archive after the design and the number of sizes", () => {
    expect(multiSizeZipName("Menu", 4)).toBe("Menu - 4 sizes.zip");
    expect(multiSizeZipName("Menu", 1)).toBe("Menu - 1 size.zip");
  });
});

describe("planMultiSize", () => {
  const design = { ...custom, pages: [{}, {}, {}] };

  it("keeps the chosen sizes in the order of the list and counts files and pixels", () => {
    const plan = planMultiSize(design, ["youtube-thumbnail", CURRENT_SIZE_ID, "nonsense"], [0, 2], "png");
    expect(plan.sizes.map((s) => s.id)).toEqual([CURRENT_SIZE_ID, "youtube-thumbnail"]);
    expect(plan.files).toBe(4);
    expect(plan.totalPixels).toBe(2 * (400 * 300 + 1280 * 720));
    expect(plan.problem).toBeNull();
  });

  it("makes one PDF for a size, however many pages, and counts the larger pictures of its pages", () => {
    const plan = planMultiSize(design, [CURRENT_SIZE_ID], [0, 1, 2], "pdf");
    expect(plan.files).toBe(1);
    expect(plan.totalPixels).toBe(3 * 600 * 450);
  });

  it("asks for a size when none is ticked, and for a page when none is chosen", () => {
    expect(planMultiSize(design, [], [0], "png").problem).toBe("Tick at least one size.");
    expect(planMultiSize(design, [CURRENT_SIZE_ID], [], "png").problem).toBe("Select at least one page to download.");
  });

  it("ignores pages the design does not have", () => {
    expect(planMultiSize(design, [CURRENT_SIZE_ID], [0, 7, -1, 0], "png").files).toBe(1);
  });

  it(`refuses more than ${MAX_SIZES} sizes at once`, () => {
    const ids = sizeChoices(design).map((c) => c.id);
    expect(planMultiSize(design, ids.slice(0, MAX_SIZES), [0], "png").problem).toBeNull();
    expect(planMultiSize(design, ids.slice(0, MAX_SIZES + 1), [0], "png").problem).toBe(`${MAX_SIZES + 1} sizes are ticked; one download holds ${MAX_SIZES} at most.`);
  });

  it("refuses more pixels than a browser can be trusted to hold, and says what would help", () => {
    const pages = Array.from({ length: 80 }, () => ({}));
    const big = planMultiSize(
      { ...custom, pages },
      [CURRENT_SIZE_ID, "youtube-banner"],
      pages.map((_p, i) => i),
      "png",
    );
    expect(big.totalPixels).toBeGreaterThan(MAX_TOTAL_PIXELS);
    expect(big.problem).toBe("That is 305 million pixels in all; one download holds 250 million. Choose fewer sizes or fewer pages.");
    expect(planMultiSize({ ...custom, pages }, [CURRENT_SIZE_ID, "youtube-banner"], [0, 1], "png").problem).toBeNull();
  });
});

describe("multiSizeOptions", () => {
  it("exports a picture at exactly the size that was chosen, a JPG with the chosen quality", () => {
    expect(multiSizeOptions("png", 0.5, [0, 1])).toMatchObject({ format: "png", scale: 1, transparent: false, pages: [0, 1] });
    expect(multiSizeOptions("jpg", 0.5, [1])).toMatchObject({ format: "jpg", scale: 1, quality: 0.5 });
  });

  it("makes a PDF for screens, as the panel does", () => {
    expect(multiSizeOptions("pdf", 0.5, [0])).toMatchObject({ format: "pdf", pdfMode: "standard", scale: 1.5, quality: 0.92 });
  });
});
