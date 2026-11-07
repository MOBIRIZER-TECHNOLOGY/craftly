import { describe, expect, it } from "vitest";
import { getAnimationPreset, pageDuration } from "@/core/animation";
import { walk } from "@/core/ops";
import { getTransitionPreset } from "@/core/transition";
import type { DesignElement, Fill } from "@/core/types";
import { getDesignType } from "@/data/designTypes";
import { getPhotoDef } from "@/data/photos";
import { getShape } from "@/render/shapePaths";
import { getFontDef } from "@/render/fonts";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, searchTemplates } from "./index";

/** Integration guard for the merged catalogue: every template must be self-consistent and renderable. */

const elementsOf = (els: DesignElement[]) => {
  const out: DesignElement[] = [];
  walk(els, (el) => out.push(el));
  return out;
};

function fillPhotoIds(fill: Fill): string[] {
  return fill.type === "image" && fill.src.startsWith("builtin:") ? [fill.src.slice("builtin:".length)] : [];
}

describe("template catalogue", () => {
  it("has a healthy size and spread", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(60);
    const byCategory = new Map<string, number>();
    for (const t of TEMPLATES) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    for (const category of Object.keys(TEMPLATE_CATEGORY_LABELS)) {
      expect(byCategory.get(category) ?? 0, `category ${category}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("has unique ids and names", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size, "duplicate ids: " + ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")).toBe(ids.length);
    const names = TEMPLATES.map((t) => t.name.toLowerCase());
    expect(new Set(names).size, "duplicate names: " + names.filter((n, i) => names.indexOf(n) !== i).join(", ")).toBe(names.length);
  });

  it("points every template at a real design type with the same size", () => {
    for (const t of TEMPLATES) {
      const type = getDesignType(t.typeId);
      expect(type, `${t.id}: unknown typeId ${t.typeId}`).toBeDefined();
      expect(t.width, t.id).toBeGreaterThan(0);
      expect(t.height, t.id).toBeGreaterThan(0);
      expect(t.pages.length, `${t.id}: no pages`).toBeGreaterThan(0);
      expect(t.tags.length, `${t.id}: needs tags`).toBeGreaterThanOrEqual(3);
    }
  });

  it("only uses catalogue fonts, shapes and stock photos", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES) {
      t.pages.forEach((page, pi) => {
        for (const id of fillPhotoIds(page.background)) if (!getPhotoDef(id)) problems.push(`${t.id} p${pi + 1}: background photo ${id}`);
        for (const el of elementsOf(page.elements)) {
          const where = `${t.id} p${pi + 1} ${el.type}:${el.id}`;
          if (el.type === "text" && !getFontDef(el.fontFamily)) problems.push(`${where}: font ${el.fontFamily}`);
          if (el.type === "shape") {
            if (el.shape === "path" ? !el.path : !getShape(el.shape)) problems.push(`${where}: shape ${el.shape}`);
            if (el.fill) for (const id of fillPhotoIds(el.fill)) if (!getPhotoDef(id)) problems.push(`${where}: fill photo ${id}`);
          }
          if (el.type === "image" && el.src) {
            if (el.src.startsWith("builtin:")) {
              if (!getPhotoDef(el.src.slice("builtin:".length))) problems.push(`${where}: photo ${el.src}`);
            } else if (/^https?:/i.test(el.src)) problems.push(`${where}: remote image ${el.src}`);
          }
          if (el.type === "graphic" && !/^\s*<svg[\s>]/i.test(el.svg)) problems.push(`${where}: graphic is not an <svg>`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it("keeps ids unique per page and geometry finite and on the page", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES) {
      t.pages.forEach((page, pi) => {
        const all = elementsOf(page.elements);
        const ids = all.map((e) => e.id);
        if (new Set(ids).size !== ids.length) problems.push(`${t.id} p${pi + 1}: duplicate element ids`);
        for (const el of page.elements) {
          const nums = [el.x, el.y, el.width, el.height, el.rotation, el.opacity];
          if (nums.some((n) => !Number.isFinite(n))) problems.push(`${t.id} p${pi + 1} ${el.id}: non-finite geometry`);
          if (el.opacity < 0 || el.opacity > 1) problems.push(`${t.id} p${pi + 1} ${el.id}: opacity ${el.opacity}`);
          // an element that is entirely off the page can never be seen
          const offPage = el.x + el.width < -t.width * 0.5 || el.y + el.height < -t.height * 0.5 || el.x > t.width * 1.5 || el.y > t.height * 1.5;
          if (offPage) problems.push(`${t.id} p${pi + 1} ${el.id}: entirely off the page`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it("never ships an empty text box", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES) {
      t.pages.forEach((page, pi) => {
        for (const el of elementsOf(page.elements)) {
          if (el.type !== "text") continue;
          const text = el.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("").trim();
          if (!text) problems.push(`${t.id} p${pi + 1} ${el.id}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it("only animates with real presets, and every animation fits inside its page", () => {
    const problems: string[] = [];
    let animatedPages = 0;
    for (const t of TEMPLATES) {
      t.pages.forEach((page, pi) => {
        const duration = pageDuration(page);
        let any = false;
        for (const el of page.elements) {
          const a = el.animation;
          if (!a) continue;
          any = true;
          for (const [phase, anim] of Object.entries(a)) {
            if (!anim) continue;
            if (!getAnimationPreset(anim.kind)) problems.push(`${t.id} p${pi + 1} ${el.id}: unknown ${phase} preset ${anim.kind}`);
            if (phase !== "loop" && anim.delay + anim.duration > duration) problems.push(`${t.id} p${pi + 1} ${el.id}: ${phase} ends after the page does`);
          }
        }
        if (any) animatedPages++;
        if (page.transition && !getTransitionPreset(page.transition.kind)) problems.push(`${t.id} p${pi + 1}: unknown transition ${page.transition.kind}`);
        if (pi === 0 && page.transition) problems.push(`${t.id}: the first page has a transition`);
      });
    }
    expect(problems).toEqual([]);
    expect(animatedPages).toBeGreaterThan(40); // the ten decks and the stories move
  });

  it("searches by name, tag and category", () => {
    expect(searchTemplates("pitch").length).toBeGreaterThan(0);
    expect(searchTemplates("", "resume").every((t) => t.category === "resume")).toBe(true);
    expect(searchTemplates("zzzz-not-a-template")).toHaveLength(0);
  });
});
