import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignSummary, Template } from "@/core/types";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS } from "@/data/templates";
import { CATEGORY_ORDER, templateCategories, templatesForYou } from "./templateLists";

function summary(typeId: string, id = typeId): DesignSummary {
  return { id, title: id, typeId, width: 100, height: 100, pageCount: 1, createdAt: 1, updatedAt: 1, folderId: null, starred: false, trashedAt: null };
}

describe("CATEGORY_ORDER", () => {
  it("lists every template category label in catalogue order", () => {
    expect(CATEGORY_ORDER).toEqual(Object.keys(TEMPLATE_CATEGORY_LABELS));
    expect(CATEGORY_ORDER).toContain("presentation");
  });
});

describe("templateCategories", () => {
  it("lists the categories that have templates, in catalogue order, with label, count and an example", () => {
    const categories = templateCategories();
    expect(categories.length).toBeGreaterThan(0);
    const ids = categories.map((category) => category.id);
    expect(ids).toEqual(CATEGORY_ORDER.filter((id) => TEMPLATES.some((template) => template.category === id)));
    for (const category of categories) {
      const members = TEMPLATES.filter((template) => template.category === category.id);
      expect(category.label).toBe(TEMPLATE_CATEGORY_LABELS[category.id]);
      expect(category.count).toBe(members.length);
      expect(category.example).toBe(members[0]);
    }
  });

  it("accounts for every template exactly once", () => {
    expect(templateCategories().reduce((total, category) => total + category.count, 0)).toBe(TEMPLATES.length);
  });
});

describe("templatesForYou", () => {
  it("returns no more than the limit, each template once", () => {
    const list = templatesForYou([], 10);
    expect(list).toHaveLength(Math.min(10, TEMPLATES.length));
    expect(new Set(list.map((template) => template.id)).size).toBe(list.length);
  });

  it("returns an empty list for a limit of zero", () => {
    expect(templatesForYou([], 0)).toEqual([]);
  });

  it("returns every template when the limit is larger than the catalogue", () => {
    const all = templatesForYou([], TEMPLATES.length + 50);
    expect(all).toHaveLength(TEMPLATES.length);
    expect(new Set(all.map((template) => template.id))).toEqual(new Set(TEMPLATES.map((template) => template.id)));
  });

  it("mixes the categories, one template per category per round", () => {
    const categories = templateCategories();
    const list = templatesForYou([], categories.length);
    expect(new Set(list.map((template) => template.category)).size).toBe(categories.length);
  });

  it("starts with the category of the designs the user made recently", () => {
    const list = templatesForYou([summary("instagram-post")], 5);
    expect(list[0].category).toBe("social");
    const poster = templatesForYou([summary("poster")], 5);
    expect(poster[0].category).toBe("poster");
  });

  it("puts the category of the newest design first, then the next one", () => {
    const list = templatesForYou([summary("resume", "a"), summary("instagram-post", "b"), summary("resume", "c")], 4);
    expect(list.slice(0, 2).map((template) => template.category)).toEqual(["resume", "social"]);
  });

  it("only looks at the eight most recent designs", () => {
    const recent = Array.from({ length: 8 }, (_unused, index) => summary("presentation", `p${index}`));
    const list = templatesForYou([...recent, summary("resume", "old")], 2);
    expect(list[0].category).toBe("presentation");
    expect(list[1].category).not.toBe("resume");
  });

  it("ignores designs of a type that has no catalogue entry", () => {
    const list = templatesForYou([summary("custom"), summary("nonsense")], 3);
    expect(list).toHaveLength(Math.min(3, TEMPLATES.length));
  });
});

describe("with a different catalogue", () => {
  afterEach(() => {
    vi.doUnmock("@/data/templates");
    vi.resetModules();
  });

  function fake(id: string, category: string): Template {
    return { id, name: id, category, typeId: "custom", width: 10, height: 10, tags: [], accent: "#000000", pages: [] } as unknown as Template;
  }

  async function withCatalogue(templates: Template[]) {
    vi.resetModules();
    vi.doMock("@/data/templates", () => ({ TEMPLATES: templates, TEMPLATE_CATEGORY_LABELS: { social: "Social media", poster: "Posters" } }));
    return import("./templateLists");
  }

  it("has nothing to show while the catalogue is empty", async () => {
    const lists = await withCatalogue([]);
    expect(lists.templateCategories()).toEqual([]);
    expect(lists.templatesForYou([], 10)).toEqual([]);
  });

  it("still lists a category that is missing from the label table, after the known ones, labelled by its id", async () => {
    const lists = await withCatalogue([fake("m1", "mystery"), fake("p1", "poster"), fake("s1", "social")]);
    const categories = lists.templateCategories();
    expect(categories.map((category) => category.id)).toEqual(["social", "poster", "mystery"]);
    expect(categories[2]).toMatchObject({ label: "mystery", count: 1 });
  });

  it("takes templates round by round from the categories", async () => {
    const lists = await withCatalogue([fake("s1", "social"), fake("s2", "social"), fake("s3", "social"), fake("p1", "poster")]);
    expect(lists.templatesForYou([], 10).map((template) => template.id)).toEqual(["s1", "p1", "s2", "s3"]);
    expect(lists.templatesForYou([], 3).map((template) => template.id)).toEqual(["s1", "p1", "s2"]);
  });
});
