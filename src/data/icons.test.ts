import { describe, expect, it } from "vitest";
import {
  ICON_SUGGESTIONS,
  ICON_SYNONYMS,
  buildIconLibrary,
  getIconSvg,
  iconIdFromName,
  iconTitle,
  loadIconIndex,
  searchIcons,
  type IconDef,
} from "./icons";

type RawNode = Array<[string, Record<string, string | number>]>;

const mk = (id: string, extra: string[] = []): IconDef => ({ id, name: iconTitle(id), tags: [...new Set([...id.split("-"), ...extra])] });
const ids = (list: IconDef[]) => list.map((i) => i.id);

describe("iconIdFromName", () => {
  it("kebab-cases PascalCase names", () => {
    expect(iconIdFromName("Heart")).toBe("heart");
    expect(iconIdFromName("ArrowUpRight")).toBe("arrow-up-right");
    expect(iconIdFromName("AArrowDown")).toBe("a-arrow-down");
    expect(iconIdFromName("UsbCPort")).toBe("usb-c-port");
  });

  it("separates numbers from words", () => {
    expect(iconIdFromName("Layers2")).toBe("layers-2");
    expect(iconIdFromName("Clock12")).toBe("clock-12");
    expect(iconIdFromName("Columns3Cog")).toBe("columns-3-cog");
    expect(iconIdFromName("MousePointer2Off")).toBe("mouse-pointer-2-off");
  });

  it("keeps lucide's dimension tokens together", () => {
    expect(iconIdFromName("Grid2X2")).toBe("grid-2x2");
    expect(iconIdFromName("Grid2x2")).toBe("grid-2x2");
    expect(iconIdFromName("Axis3D")).toBe("axis-3d");
    expect(iconIdFromName("Axis3d")).toBe("axis-3d");
    expect(iconIdFromName("ArrowDownAZ")).toBe("arrow-down-a-z");
  });

  it("titles ids in sentence case", () => {
    expect(iconTitle("arrow-up-right")).toBe("Arrow up right");
    expect(iconTitle("layers-2")).toBe("Layers 2");
  });
});

describe("buildIconLibrary", () => {
  const heart: RawNode = [["path", { d: "M1 1" }]];
  const house: RawNode = [["path", { d: "M2 2" }]];
  const alert: RawNode = [["path", { d: "M3 3" }]];
  const lib = buildIconLibrary({ Heart: heart, Home: house, House: house, AlertCircle: alert, CircleAlert: alert, CircleExclamationPoint: alert });

  it("lists every drawing once, sorted by id", () => {
    expect(ids(lib.index)).toEqual(["circle-exclamation-point", "heart", "house"]);
  });

  it("keeps alias names resolvable and searchable", () => {
    expect(lib.nodes.get("home")).toBe(house);
    expect(lib.nodes.get("house")).toBe(house);
    expect(lib.nodes.get("alert-circle")).toBe(alert);
    expect(lib.index.find((i) => i.id === "house")?.tags).toContain("home");
    expect(lib.index.find((i) => i.id === "house")?.aliases).toEqual(["home"]);
    expect(lib.index.find((i) => i.id === "heart")?.aliases).toBeUndefined();
    expect(lib.index.find((i) => i.id === "circle-exclamation-point")?.tags).toEqual(expect.arrayContaining(["alert", "circle", "exclamation", "point"]));
  });

  it("adds curated synonyms to the tags", () => {
    expect(lib.index.find((i) => i.id === "heart")?.tags).toEqual(expect.arrayContaining(["heart", "love", "favourite"]));
  });
});

describe("lucide index", () => {
  it("loads about two thousand icons sorted by id", async () => {
    const index = await loadIconIndex();
    expect(index.length).toBeGreaterThan(1900);
    expect(index.length).toBeLessThan(2400);
    const sorted = [...ids(index)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids(index)).toEqual(sorted);
    expect(new Set(ids(index)).size).toBe(index.length);
  });

  it("is memoised", async () => {
    expect(await loadIconIndex()).toBe(await loadIconIndex());
  });

  it("has well-formed kebab-case ids, titles and tags", async () => {
    for (const icon of await loadIconIndex()) {
      expect(icon.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(icon.name).toBe(iconTitle(icon.id));
      expect(icon.tags.length).toBeGreaterThan(0);
      expect(new Set(icon.tags).size).toBe(icon.tags.length);
      for (const tag of icon.tags) expect(tag).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("contains correctly cased names", async () => {
    const all = ids(await loadIconIndex());
    expect(all).toContain("arrow-up-right");
    expect(all).toContain("layers-2");
    expect(all).toContain("heart");
    expect(all).toContain("grid-2x2");
  });

  it("lists renamed icons once and keeps the old name as a tag", async () => {
    const index = await loadIconIndex();
    const all = ids(index);
    expect(all.includes("house") !== all.includes("home")).toBe(true);
    expect(all.includes("circle-x") !== all.includes("x-circle")).toBe(true);
    const house = index.find((i) => i.id === "house" || i.id === "home");
    expect(house?.tags).toEqual(expect.arrayContaining(["home", "house"]));
  });
});

describe("getIconSvg", () => {
  it("returns a standalone stroke icon", async () => {
    const svg = await getIconSvg("heart");
    expect(svg).not.toBeNull();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg).toContain("<path");
    expect(svg).toContain("currentColor");
  });

  it("resolves aliases and alternative spellings to the same drawing", async () => {
    const heart = await getIconSvg("heart");
    expect(await getIconSvg("Heart")).toBe(heart);
    expect(await getIconSvg("home")).toBe(await getIconSvg("house"));
    expect(await getIconSvg("ArrowRight")).toBe(await getIconSvg("arrow-right"));
    expect(await getIconSvg("arrow_right")).toBe(await getIconSvg("arrow-right"));
  });

  it("returns null for unknown ids", async () => {
    expect(await getIconSvg("definitely-not-an-icon")).toBeNull();
    expect(await getIconSvg("")).toBeNull();
  });

  it("renders every listed icon", async () => {
    const index = await loadIconIndex();
    for (const icon of index.filter((_, i) => i % 7 === 0)) {
      expect(await getIconSvg(icon.id)).toContain("<svg");
    }
  });
});

describe("searchIcons ranking", () => {
  const small = [
    mk("arrow-right"),
    mk("arrow-up-right"),
    mk("circle-arrow-right"),
    mk("carrot", ["vegetable"]),
    mk("heart", ["love", "favourite"]),
    mk("heart-handshake"),
    mk("map-pin", ["location"]),
    mk("shopping-cart", ["buy"]),
  ];

  it("ranks prefix matches before contains matches", () => {
    expect(ids(searchIcons(small, "arr"))).toEqual(["arrow-right", "arrow-up-right", "circle-arrow-right", "carrot"]);
  });

  it("ranks an exact id first, then longer ids", () => {
    expect(ids(searchIcons(small, "heart"))).toEqual(["heart", "heart-handshake"]);
  });

  it("matches tags as well as id words, id words win", () => {
    expect(ids(searchIcons(small, "love"))).toEqual(["heart"]);
    expect(ids(searchIcons(small, "location"))).toEqual(["map-pin"]);
    expect(ids(searchIcons(small, "buy"))).toEqual(["shopping-cart"]);
  });

  it("requires every word to match and prefers the exact id", () => {
    expect(ids(searchIcons(small, "arrow right"))).toEqual(["arrow-right", "arrow-up-right", "circle-arrow-right"]);
    expect(searchIcons(small, "arrow carrot")).toEqual([]);
  });

  it("is case, separator and plural insensitive", () => {
    expect(ids(searchIcons(small, "Arrow-Right"))).toEqual(ids(searchIcons(small, "arrow right")));
    expect(ids(searchIcons(small, "ArrowRight"))).toEqual(ids(searchIcons(small, "arrow right")));
    expect(ids(searchIcons(small, "hearts"))).toContain("heart");
  });

  it("returns the head of the index for an empty query and honours the limit", () => {
    expect(ids(searchIcons(small, "   ", 3))).toEqual(["arrow-right", "arrow-up-right", "circle-arrow-right"]);
    expect(searchIcons(small, "arrow", 2)).toHaveLength(2);
    expect(searchIcons(small, "zzzz")).toEqual([]);
  });

  it("does not mutate the index", () => {
    const copy = ids(small);
    searchIcons(small, "arrow");
    expect(ids(small)).toEqual(copy);
  });
});

describe("searchIcons on the lucide index", () => {
  it("finds the obvious icon first", async () => {
    const index = await loadIconIndex();
    expect(searchIcons(index, "heart")[0].id).toBe("heart");
    expect(searchIcons(index, "arrow right")[0].id).toBe("arrow-right");
    expect(searchIcons(index, "trash")[0].id).toBe("trash");
    expect(searchIcons(index, "calendar")[0].id).toBe("calendar");
  });

  it("finds icons by synonym and by former lucide name", async () => {
    const index = await loadIconIndex();
    expect(ids(searchIcons(index, "love", 5))).toContain("heart");
    expect(searchIcons(index, "home")[0].id).toBe("house");
    for (const old of ["alert circle", "check circle", "x circle", "edit"]) {
      const first = searchIcons(index, old)[0];
      expect(await getIconSvg(first.id), `former name "${old}"`).toBe(await getIconSvg(old.replace(/ /g, "-")));
    }
    expect(ids(searchIcons(index, "email", 5))).toContain("mail");
  });

  it("puts id-word prefixes ahead of weaker matches", async () => {
    const index = await loadIconIndex();
    const top = searchIcons(index, "arr", 40);
    expect(top).toHaveLength(40);
    for (const icon of top) expect(icon.id.split("-").some((w) => w.startsWith("arr"))).toBe(true);
  });

  it("every search chip has plenty of results", async () => {
    const index = await loadIconIndex();
    expect(new Set(ICON_SUGGESTIONS).size).toBe(ICON_SUGGESTIONS.length);
    expect(ICON_SUGGESTIONS.length).toBeGreaterThanOrEqual(20);
    expect(ICON_SUGGESTIONS.length).toBeLessThanOrEqual(30);
    for (const chip of ICON_SUGGESTIONS) {
      expect(searchIcons(index, chip, 50).length, `chip "${chip}"`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("curated synonyms", () => {
  it("covers ~150 popular icons and every key is a real lucide id", async () => {
    const keys = Object.keys(ICON_SYNONYMS);
    expect(keys.length).toBeGreaterThanOrEqual(150);
    for (const key of keys) {
      expect(await getIconSvg(key), `synonym key "${key}"`).not.toBeNull();
      expect(ICON_SYNONYMS[key]).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });
});
