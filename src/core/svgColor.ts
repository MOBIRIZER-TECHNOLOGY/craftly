/**
 * Colours as an SVG file writes them: hex, rgb() and hsl() with numbers or shares, and the names of CSS. The editor's own
 * `parseColor` reads what the editor writes (hex, rgb() with numbers, three names); a drawing from outside uses the rest too.
 */
import { hslToHex, parseColor, toHex, type RGBA } from "./color";

const NAMES: ReadonlyMap<string, string> = new Map(
  (
    "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff " +
    "blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc " +
    "crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b " +
    "darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b " +
    "darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 " +
    "dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 " +
    "gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c " +
    "lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 " +
    "lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 " +
    "lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 " +
    "mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a " +
    "mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 " +
    "oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee " +
    "palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 " +
    "red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d " +
    "silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 " +
    "thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32"
  )
    .split(" ")
    .reduce<Array<[string, string]>>((pairs, word, i, words) => (i % 2 ? pairs : [...pairs, [word, `#${words[i + 1]}`]]), []),
);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const CALL = /^(rgb|hsl)a?\(([^)]*)\)$/;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** "0.5" and "50%" are both a half; anything else is not a number. */
export function parseShare(raw: string): number {
  const text = raw.trim();
  return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text === "" ? "x" : text);
}

/** The colour, or null when the text is not one. `transparent` is a colour that cannot be seen. */
export function parseSvgColor(raw: string): RGBA | null {
  const text = raw.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text[0] === "#") return HEX.test(text) ? parseColor(text) : null;
  const named = NAMES.get(text);
  if (named) return parseColor(named);
  const call = CALL.exec(text);
  if (!call) return null;
  const parts = call[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts.length === 4 ? parseShare(parts[3]) : 1;
  const hsl = call[1] === "hsl";
  // red, green and blue as numbers up to 255 or as shares; or the hue in degrees and two shares
  const [a, b, c] = hsl
    ? [Number(parts[0].replace(/deg$/, "")), parseShare(parts[1]) * 100, parseShare(parts[2]) * 100]
    : parts.slice(0, 3).map((part) => (part.endsWith("%") ? parseShare(part) * 255 : Number(part)));
  if ([a, b, c, alpha].some(Number.isNaN)) return null;
  const colour = hsl ? (parseColor(hslToHex(((a % 360) + 360) % 360, b, c)) as RGBA) : { r: a, g: b, b: c, a: 1 };
  return { r: Math.min(255, Math.max(0, colour.r)), g: Math.min(255, Math.max(0, colour.g)), b: Math.min(255, Math.max(0, colour.b)), a: clamp01(alpha) };
}

/** The colour as the editor stores one: #rrggbb, or rgba() when it can be seen through. */
export function colorText(colour: RGBA, opacity = 1): string {
  const alpha = clamp01(colour.a * opacity);
  return alpha >= 1 ? toHex(colour) : `rgba(${Math.round(colour.r)},${Math.round(colour.g)},${Math.round(colour.b)},${+alpha.toFixed(3)})`;
}

/** The colour between two, `t` of the way from the first to the second. */
export function mixColors(a: RGBA, b: RGBA, t: number): RGBA {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}
