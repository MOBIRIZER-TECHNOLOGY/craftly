import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, luminance, mix, toHex } from "@/core/color";

/**
 * The colours that carry words must keep their contrast (WCAG 1.4.3: 4.5:1, or 3:1 for large text), and the lighter grey
 * that does not carry words must stay out of text. These tests read tokens.css and the stylesheets themselves, so lightening
 * a token fails here and not in a later audit. docs/ACCESSIBILITY.md has the measurements behind the values.
 */
const SRC = resolve(__dirname, "..");
const tokensCss = readFileSync(join(__dirname, "tokens.css"), "utf8");

function token(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`tokens.css has no ${name}`);
  return match[1].trim();
}

type Stops = Array<[colour: string, position: number]>;

/** The colour stops of a linear-gradient token; stops without a position are spread evenly. */
function stops(name: string): Stops {
  const list = [...token(name).matchAll(/(#[0-9a-fA-F]{6})(?:\s+(\d+(?:\.\d+)?)%)?/g)];
  return list.map((match, index) => [match[1], match[2] !== undefined ? Number(match[2]) / 100 : index / (list.length - 1)]);
}

/** The colour of a gradient at position t, 0 to 1. */
function at(list: Stops, t: number): string {
  for (let i = 1; i < list.length; i += 1) {
    if (t <= list[i][1]) return mix(list[i - 1][0], list[i][0], (t - list[i - 1][1]) / (list[i][1] - list[i - 1][1]));
  }
  return list[list.length - 1][0];
}

const ALONG = Array.from({ length: 101 }, (_, i) => i / 100);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("colours that carry words", () => {
  it("keeps all four text greys at 4.5:1 on the page and the subtle panel background", () => {
    for (const grey of ["--c-ink", "--c-ink-2", "--c-ink-3", "--c-ink-4"]) {
      for (const surface of ["--c-bg", "--c-bg-subtle"]) {
        expect(contrastRatio(token(grey), token(surface)), `${grey} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the lightest text grey readable on the softest purple too", () => {
    expect(contrastRatio(token("--c-ink-4"), token("--c-primary-softer"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the lightest text grey at 4.5:1 on a row the pointer is on, and on the workspace", () => {
    for (const surface of ["--c-hover", "--c-workspace"]) {
      expect(contrastRatio(token("--c-ink-4"), token(surface)), `--c-ink-4 on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("has a text colour for the info badge that reads on its soft background", () => {
    expect(contrastRatio(token("--c-info-ink"), token("--c-info-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps white text at 4.5:1 along the whole brand gradient, which is the top bar", () => {
    const bar = stops("--grad-brand");
    for (const t of ALONG) expect(contrastRatio("#ffffff", at(bar, t)), `at ${Math.round(t * 100)} % of the bar`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the gradient headline (large text) at 3:1 on the hero background", () => {
    const headline = stops("--grad-text");
    const hero = stops("--grad-hero");
    for (const t of ALONG) {
      for (const height of [0, 0.25, 0.5, 0.75, 1]) {
        expect(contrastRatio(at(headline, t), at(hero, height)), `at ${Math.round(t * 100)} % of the headline, ${height * 100} % down the hero`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the bright brand gradient for decoration that carries no words", () => {
    expect(token("--grad-brand-bright")).toBe("linear-gradient(90deg, #12c2b9 0%, #3b82f6 55%, #7c3aed 100%)");
  });
});

describe("badges (ui/Badge.css)", () => {
  const badgeCss = readFileSync(join(SRC, "ui", "Badge.css"), "utf8");

  /** The colours a tone gives a badge: the text and the background of the soft badge, and the fill of the solid one. */
  function colours(selector: string) {
    const block = badgeCss.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
    if (!block) throw new Error(`Badge.css has no ${selector}`);
    const pick = (property: string) => {
      const match = block[1].match(new RegExp(`--_${property}:\\s*var\\((--[\\w-]+)\\)`));
      if (!match) throw new Error(`${selector} sets no --_${property}`);
      return token(match[1]);
    };
    return { text: pick("fg"), soft: pick("bg"), solid: pick("solid") };
  }

  // the text of a solid badge is white, and dark on the warning one (the last rule of Badge.css)
  const TONES: Array<[tone: string, selector: string, solidText: string]> = [
    ["neutral", ".cf-badge", token("--c-ink-inverse")],
    ["primary", ".cf-badge--primary", token("--c-ink-inverse")],
    ["success", ".cf-badge--success", token("--c-ink-inverse")],
    ["danger", ".cf-badge--danger", token("--c-ink-inverse")],
    ["info", ".cf-badge--info", token("--c-ink-inverse")],
    ["warning", ".cf-badge--warning", token("--c-ink")],
  ];

  it.each(TONES)("keeps the text of a soft %s badge at 4.5:1 on its background", (_tone, selector) => {
    const { text, soft } = colours(selector);
    expect(contrastRatio(text, soft)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TONES)("keeps the text of a solid %s badge at 4.5:1 on its fill", (_tone, selector, solidText) => {
    expect(contrastRatio(solidText, colours(selector).solid)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the danger red", () => {
  const buttonCss = readFileSync(join(SRC, "ui", "Button.css"), "utf8");

  /** What a rule of Button.css sets through custom properties, as colours. */
  function buttonColours(selector: string) {
    const block = buttonCss.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
    if (!block) throw new Error(`Button.css has no ${selector}`);
    const pick = (property: string) => {
      const match = block[1].match(new RegExp(`${property}:\\s*var\\((--[\\w-]+)\\)`));
      if (!match) throw new Error(`${selector} sets no ${property}`);
      return token(match[1]);
    };
    return { text: pick("--_fg"), resting: pick("--_bg"), hover: pick("--_bg-hover"), pressed: pick("--_bg-press") };
  }

  it("has a text colour that reads on the page, the subtle panel, a hovered row and the soft red", () => {
    for (const surface of ["--c-bg", "--c-bg-subtle", "--c-hover", "--c-danger-soft"]) {
      expect(contrastRatio(token("--c-danger-ink"), token(surface)), `--c-danger-ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("colours no text: no stylesheet sets color, a button's text or a ghost button's text to the plain red", () => {
    const offenders = cssFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((text, index) => ({ text, line: index + 1 }))
        .filter(({ text }) => /^\s*(color|--_fg|--cf-btn-ghost-fg):\s*var\(--c-danger\)/.test(text))
        .map(({ line }) => `${file.slice(SRC.length + 1)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the white text of a danger button at 4.5:1 at rest, under the pointer and pressed", () => {
    const { text, resting, hover, pressed } = buttonColours(".cf-btn--danger");
    for (const [state, fill] of Object.entries({ resting, hover, pressed })) expect(contrastRatio(text, fill), state).toBeGreaterThanOrEqual(4.5);
  });

  it("still shows the pointer and the press: each state of the danger button is darker than the one before", () => {
    const { resting, hover, pressed } = buttonColours(".cf-btn--danger");
    expect(contrastRatio(resting, hover)).toBeGreaterThanOrEqual(1.1);
    expect(contrastRatio(hover, pressed)).toBeGreaterThanOrEqual(1.1);
    expect(luminance(hover)).toBeLessThan(luminance(resting));
    expect(luminance(pressed)).toBeLessThan(luminance(hover));
  });
});

describe("the outline of form fields (WCAG 1.4.11: 3:1 against what is round them)", () => {
  const css = (file: string) => readFileSync(join(SRC, file), "utf8");
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** What the rule with exactly this selector sets. */
  function declarations(file: string, selector: string): string {
    const match = css(file).match(new RegExp(`(?:^|\\n)${escape(selector)}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`${file} has no rule ${selector}`);
    return match[1];
  }

  // the outline, or for the switch the track, that tells a person where the control is
  const OUTLINES: Array<[file: string, selector: string, property: string]> = [
    ["ui/TextField.css", ".cf-field__box", "border"],
    ["ui/NumberField.css", ".cf-num", "border"],
    ["ui/SearchField.css", ".cf-search", "border"],
    ["ui/Select.css", ".cf-select", "border"],
    ["ui/ColorPicker.css", ".cf-cp__hex", "border"],
    ["editor/toolbar/AltTextDialog.css", ".cf-alt__input", "border"],
    ["editor/panels/context/DataPanel.css", ".cf-data__cell", "border"],
    ["ui/Checkbox.css", ".cf-check__box", "border"],
    ["ui/Switch.css", ".cf-switch__track", "background"],
    ["dashboard/Hero.css", ".cf-hero__search .cf-search--lg", "border-color"],
  ];
  const HOVERS: Array<[file: string, selector: string, property: string]> = [
    ["ui/TextField.css", ".cf-field__box:hover:not(.is-disabled)", "border-color"],
    ["ui/NumberField.css", ".cf-num:hover:not(.is-disabled)", "border-color"],
    ["ui/SearchField.css", ".cf-search:hover:not(.is-disabled)", "border-color"],
    ["ui/Select.css", ".cf-select:hover:not(:disabled)", "border-color"],
    ["ui/ColorPicker.css", ".cf-cp__hex:hover", "border-color"],
    ["editor/toolbar/AltTextDialog.css", ".cf-alt__input:hover", "border-color"],
    ["editor/panels/context/DataPanel.css", ".cf-data__cell:hover", "border-color"],
    ["ui/Checkbox.css", ".cf-check:hover:not(.is-disabled) .cf-check__box", "border-color"],
    ["ui/Switch.css", ".cf-switch:hover:not(.is-disabled) .cf-switch__track", "background"],
  ];

  it("has a field outline colour that reaches 3:1 on the page and on the subtle panel", () => {
    for (const surface of ["--c-bg", "--c-bg-subtle"]) expect(contrastRatio(token("--c-field-border"), token(surface)), `--c-field-border on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  it("goes darker, by a step that can be seen, when the pointer is on a field", () => {
    expect(contrastRatio(token("--c-ink-4"), token("--c-field-border"))).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(token("--c-ink-4"), token("--c-bg"))).toBeGreaterThanOrEqual(3);
  });

  it.each(OUTLINES)("%s: %s is drawn in --c-field-border", (file, selector, property) => {
    expect(declarations(file, selector)).toMatch(new RegExp(`(^|\\s)${property}:[^;]*var\\(--c-field-border\\)`));
  });

  it.each(HOVERS)("%s: %s turns to --c-ink-4", (file, selector, property) => {
    expect(declarations(file, selector)).toMatch(new RegExp(`(^|\\s)${property}:\\s*var\\(--c-ink-4\\)`));
  });
});

describe("the amber of icons", () => {
  it("has an amber for icons that reads on the page, the soft amber, the subtle panel and a hovered row", () => {
    expect(contrastRatio(token("--c-warning-ink"), token("--c-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("--c-warning-ink"), token("--c-warning-soft"))).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["--c-bg-subtle", "--c-hover"]) expect(contrastRatio(token("--c-warning-ink"), token(surface)), `on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  it("colours no icon in the plain amber: outside the art of the Uploads tab, every colour and fill is --c-warning-ink", () => {
    const ART = ["editor/panels/tabs/UploadsTab.css"];
    const offenders = cssFiles(SRC).flatMap((file) => {
      const relative = file.slice(SRC.length + 1).replace(/\\/g, "/");
      if (ART.includes(relative)) return [];
      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((text, index) => ({ text, line: index + 1 }))
        .filter(({ text }) => /^\s*(color|fill|--cf-ib-active-fg):\s*var\(--c-warning\)/.test(text))
        .map(({ line }) => `${relative}:${line}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe("the tints on the top bar", () => {
  const rgbaOf = (name: string) => {
    const match = token(name).match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
    if (!match) throw new Error(`${name} is not an rgba() colour`);
    return { colour: toHex({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: 1 }), alpha: Number(match[4]) };
  };

  it("keep the white labels at 4.5:1 over the whole bar when the pointer is on a button or one is pressed or open", () => {
    const bar = stops("--grad-brand");
    for (const name of ["--c-bar-hover", "--c-bar-press"]) {
      const { colour, alpha } = rgbaOf(name);
      for (const t of ALONG) expect(contrastRatio("#ffffff", mix(at(bar, t), colour, alpha)), `${name} at ${Math.round(t * 100)} % of the bar`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("are tints of the dark ink, because a white tint would take the labels under 4.5:1 over the middle of the bar", () => {
    for (const name of ["--c-bar-hover", "--c-bar-press"]) expect(rgbaOf(name).colour, name).toBe(toHex({ r: 14, g: 19, b: 24, a: 1 }));
  });

  it("have a placeholder colour for the title field that reaches 4.5:1 over the whole bar", () => {
    const bar = stops("--grad-brand");
    const { colour, alpha } = rgbaOf("--c-bar-placeholder");
    for (const t of ALONG) expect(contrastRatio(mix(at(bar, t), colour, alpha), at(bar, t)), `at ${Math.round(t * 100)} % of the bar`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the light grey, --c-ink-5", () => {
  it("is the grey the text token used to be, for icons, borders and lines", () => {
    expect(token("--c-ink-5")).toBe("#9aa1ad");
  });

  it("colours no text: no stylesheet sets color, caret-color or the text fill to it", () => {
    const offenders = cssFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((text, index) => ({ text, line: index + 1 }))
        .filter(({ text }) => /^\s*(color|caret-color|-webkit-text-fill-color):\s*var\(--c-ink-5\)/.test(text))
        .map(({ line }) => `${file.slice(SRC.length + 1)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("docs/DESIGN.md section 5", () => {
  it("lists the contract tokens with the values tokens.css has", () => {
    const doc = readFileSync(resolve(SRC, "../docs/DESIGN.md"), "utf8");
    const block = doc.match(/## 5\. Visual language[\s\S]*?```css\r?\n([\s\S]*?)```/)?.[1] ?? "";
    const declared = [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)];
    expect(declared.length).toBeGreaterThan(40);
    const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    for (const [, name, value] of declared) expect(norm(token(name)), name).toBe(norm(value));
  });
});
