/**
 * Whether markup that came from outside (the drawing of a graphic in a design somebody shared, sent by a server) is plain drawing
 * and nothing else. A list of what to keep out can always be walked around (`<svg/onload=...>` is an event handler to a browser and
 * nothing to a pattern that looks for a space), so this is the other way round: a short list of what is allowed, read as strictly
 * as XML is read. The elements are shapes, paints and masks; the attributes have ordinary names and quoted values; an address can
 * only point at something inside the drawing; there are no styles, comments, declarations, scripts, links or animations.
 *
 * Everything that passes is the same thing to an XML parser and to the HTML parser of a browser, which is what makes it safe to
 * draw as an image, to put into a page or to write into an exported file. No DOM and no Node API: it runs on a server too.
 * Returns what is wrong, in a few words, or null when there is nothing.
 */

const ELEMENTS: ReadonlySet<string> = new Set(
  (
    "svg g defs symbol path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask pattern marker title desc filter " +
    "feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood " +
    "feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence"
  ).split(" "),
);

/** Names with a colon that a drawing may use; every other name is a plain word. */
const PREFIXED: ReadonlySet<string> = new Set(["xlink:href", "xlink:title", "xml:space", "xml:lang"]);
const NAMESPACES: Readonly<Record<string, string>> = { xmlns: "http://www.w3.org/2000/svg", "xmlns:xlink": "http://www.w3.org/1999/xlink" };

const MAX_DEPTH = 100;
const MAX_ATTRIBUTES = 100;
const MALFORMED = "the markup is not well formed";

const ELEMENT_NAME = /[A-Za-z][A-Za-z0-9]*/y;
const ATTRIBUTE_NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const SPACE = /[ \t\r\n]*/y;
const REFERENCE = /&(?!(?:amp|lt|gt|quot|apos);)/;
const FRAGMENT = /^#[\w:.-]+$/;
const CALL = /url\(/gi;
const CALL_WITH_ARGUMENT = /url\(([^)]*)\)/gi;

const short = (name: string) => (name.length > 30 ? `${name.slice(0, 30)}…` : name);

/** Whether there is a character in the text that XML does not allow: the control characters other than tab and the line breaks. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return true;
  }
  return false;
}

/** The text that matches `pattern` at `at` (a sticky pattern), or null. */
function read(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at;
  const found = pattern.exec(text);
  return found ? found[0] : null;
}

function decode(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name] as string);
}

/** What is wrong with one attribute, if anything. */
function attributeProblem(name: string, value: string): string | null {
  const lower = name.toLowerCase();
  if (lower === "xmlns" || lower.startsWith("xmlns:")) return NAMESPACES[name] === value ? null : `the namespace in ${short(name)} is not allowed`;
  if (lower.startsWith("on") || lower === "style" || (name.includes(":") && !PREFIXED.has(name))) return `the attribute ${short(name)} is not allowed`;
  if (hasControl(value)) return `the value of ${short(name)} has a character that is not allowed`;
  if (value.includes("<")) return `the value of ${short(name)} has a < in it`;
  if (value.includes("\\")) return `the value of ${short(name)} has a backslash in it`;
  if (REFERENCE.test(value)) return `${short(name)} has a character reference that is not allowed`;
  const plain = decode(value);
  if (lower === "href" || lower === "xlink:href") return FRAGMENT.test(plain) ? null : `${short(name)} may only point inside the drawing`;
  if (plain.match(CALL)) {
    const calls = [...plain.matchAll(CALL_WITH_ARGUMENT)];
    const inside = calls.every((call) =>
      FRAGMENT.test(
        call[1]
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2")
          .trim(),
      ),
    );
    if (!inside || calls.length !== plain.match(CALL)?.length) return `${short(name)} may only refer to something inside the drawing`;
  }
  return null;
}

/** What is wrong with the text between two tags, if anything. */
function textProblem(text: string, inside: boolean): string | null {
  if (hasControl(text)) return "a character that is not allowed in text";
  if (!inside) return /[^ \t\r\n]/.test(text) ? "text outside the drawing" : null;
  if (REFERENCE.test(text)) return "a character reference that is not allowed in text";
  return text.includes("]]>") ? "]]> in text" : null;
}

export function svgProblem(markup: string): string | null {
  const open: string[] = [];
  let started = false;
  let finished = false;
  let at = 0;
  while (at < markup.length) {
    const lt = markup.indexOf("<", at);
    const end = lt < 0 ? markup.length : lt;
    if (end > at) {
      const problem = textProblem(markup.slice(at, end), open.length > 0);
      if (problem) return problem;
    }
    if (lt < 0) break;
    const next = markup[lt + 1];
    if (next === "!" || next === "?") return "a comment, declaration or instruction is not allowed";

    if (next === "/") {
      const name = read(ELEMENT_NAME, markup, lt + 2);
      if (name === null) return MALFORMED;
      const after = lt + 2 + name.length;
      const gap = (read(SPACE, markup, after) as string).length;
      if (markup[after + gap] !== ">") return MALFORMED;
      if (open.pop() !== name) return "a closing tag that does not match what was opened";
      finished = open.length === 0;
      at = after + gap + 1;
      continue;
    }

    const name = read(ELEMENT_NAME, markup, lt + 1);
    if (name === null) return MALFORMED;
    if (!ELEMENTS.has(name)) return `the element <${short(name)}> is not allowed`;
    if (finished) return "more than one drawing, or markup outside it";
    if (!started && name !== "svg") return "a drawing starts with <svg>";
    started = true;
    if (open.length >= MAX_DEPTH) return "the drawing is nested too deep";
    at = lt + 1 + name.length;
    const seen = new Set<string>();
    for (;;) {
      const gap = (read(SPACE, markup, at) as string).length;
      at += gap;
      const c = markup[at];
      if (c === undefined) return MALFORMED;
      if (c === ">") {
        open.push(name);
        at++;
        break;
      }
      if (c === "/") {
        if (markup[at + 1] !== ">") return MALFORMED;
        finished = open.length === 0;
        at += 2;
        break;
      }
      if (gap === 0) return MALFORMED; // attributes are told apart by white space
      const attribute = read(ATTRIBUTE_NAME, markup, at);
      if (attribute === null) return MALFORMED;
      at += attribute.length;
      at += (read(SPACE, markup, at) as string).length;
      if (markup[at] !== "=") return MALFORMED;
      at++;
      at += (read(SPACE, markup, at) as string).length;
      const quote = markup[at];
      if (quote === undefined) return MALFORMED;
      if (quote !== '"' && quote !== "'") return "an attribute value needs quotes";
      const close = markup.indexOf(quote, at + 1);
      if (close < 0) return MALFORMED;
      if (seen.has(attribute)) return `the attribute ${short(attribute)} is given twice`;
      seen.add(attribute);
      if (seen.size > MAX_ATTRIBUTES) return "too many attributes";
      const problem = attributeProblem(attribute, markup.slice(at + 1, close));
      if (problem) return problem;
      at = close + 1;
    }
  }
  if (open.length) return `<${short(open[open.length - 1])}> is never closed`;
  return started ? null : "there is no drawing in it";
}
