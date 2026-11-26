import { useEffect, useReducer, type CSSProperties } from "react";
import { captionOutlineIsDark, clipCaptionStyle } from "@/core/animation";
import type { CaptionStyle, VideoElement } from "@/core/types";
import { ColorField } from "@/editor/panels/context/ColorField";
import { m } from "@/i18n";
import { FONT_CATALOG, customFontDefs, ensureFont, onFontsChange } from "@/render/fonts";
import { captionFontCss } from "@/render/renderPage";
import { ColorSwatch, Segmented, Select } from "@/ui";
import { editElements, only } from "../selection";

/** The colours offered for the words: white, yellow, black, and a few that stand out on most footage. */
export const CAPTION_COLORS = ["#ffffff", "#facc15", "#000000", "#22d3ee", "#f472b6", "#4ade80"] as const;

/** The fonts of the app's own a caption can use: its list, and those uploaded to the brand kit on this device, by name. */
function captionFamilies(): string[] {
  return [...new Set([...FONT_CATALOG, ...customFontDefs()].map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

/** A sample line in the style, beside the controls: captions are drawn only while the clip plays, so this is where a change shows. */
function sampleStyle(style: Required<CaptionStyle>): CSSProperties {
  const outline = captionOutlineIsDark(style.color) ? "#000" : "#fff";
  return {
    fontFamily: captionFontCss(style),
    fontSize: style.size === "s" ? 11 : style.size === "l" ? 16 : 13,
    color: style.color,
    background: style.band === "dark" ? "rgba(0, 0, 0, 0.66)" : style.band === "light" ? "rgba(255, 255, 255, 0.85)" : "transparent",
    textShadow: style.band === "none" ? `-1px -1px 0 ${outline}, 1px -1px 0 ${outline}, -1px 1px 0 ${outline}, 1px 1px 0 ${outline}` : undefined,
    alignSelf: style.place === "top" ? "flex-start" : style.place === "middle" ? "center" : "flex-end",
  };
}

/** How the clip's captions look: where, how big, which kind of letters, their colour, and what is behind them. One step of Undo each. */
export function CaptionStyleFields({ el }: { el: VideoElement }) {
  const words = m.editor.videoBar;
  const style = clipCaptionStyle(el);
  // the sample line is drawn again once the chosen font has come, and the list follows fonts uploaded meanwhile
  const [, fontsCame] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onFontsChange(fontsCame), []);
  useEffect(() => {
    if (style.family) void ensureFont(style.family, 600);
  }, [style.family]);
  const families = captionFamilies();
  const fontValue = style.family ? `family:${style.family}` : `kind:${style.font}`;
  const setFont = (value: string) => {
    if (value.startsWith("family:")) set({ family: value.slice(7) }, "caption-font");
    else set({ font: value.slice(5) as Required<CaptionStyle>["font"], family: "" }, "caption-font");
  };
  const set = (patch: CaptionStyle, tag: string) =>
    editElements(
      [el.id],
      only("video", (clip) => {
        const next: CaptionStyle = { ...clipCaptionStyle(clip), ...patch };
        // only what differs from the defaults is kept
        const plain = clipCaptionStyle({});
        for (const key of Object.keys(next) as (keyof CaptionStyle)[]) if (next[key] === plain[key]) delete next[key];
        if (Object.keys(next).length) clip.captionStyle = next;
        else delete clip.captionStyle;
      }),
      tag,
    );
  const setBand = (band: Required<CaptionStyle>["band"]) => {
    // white words on a light band cannot be read, nor black ones on a dark band: the words change with it
    const color = band === "light" && style.color === "#ffffff" ? "#000000" : band === "dark" && style.color === "#000000" ? "#ffffff" : style.color;
    set({ band, color }, "caption-band");
  };

  return (
    <fieldset className="cf-captions__style">
      <legend className="cf-tbpop__label">{words.captionStyle}</legend>
      <div className="cf-captions__preview" aria-hidden="true">
        <span style={sampleStyle(style)}>{words.captionSample}</span>
      </div>
      <Segmented
        size="sm"
        fullWidth
        aria-label={words.captionPlace}
        value={style.place}
        onChange={(place) => set({ place }, "caption-place")}
        options={[
          { value: "top", label: words.captionTop },
          { value: "middle", label: words.captionMiddle },
          { value: "bottom", label: words.captionBottom },
        ]}
      />
      <Segmented
        size="sm"
        fullWidth
        aria-label={words.captionSize}
        value={style.size}
        onChange={(size) => set({ size }, "caption-size")}
        options={[
          { value: "s", label: words.captionSmall },
          { value: "m", label: words.captionMedium },
          { value: "l", label: words.captionLarge },
        ]}
      />
      <Select
        size="sm"
        aria-label={words.captionFont}
        value={fontValue}
        onChange={setFont}
        options={[
          { value: "kind:sans", label: words.captionSans },
          { value: "kind:serif", label: words.captionSerif },
          { value: "kind:mono", label: words.captionMono },
          // a font no longer on this device (from a shared design) stays chosen, by its name
          ...(style.family && !families.includes(style.family) ? [style.family] : []).concat(families).map((family) => ({ value: `family:${family}`, label: family })),
        ]}
      />
      <Segmented
        size="sm"
        fullWidth
        aria-label={words.captionBand}
        value={style.band}
        onChange={setBand}
        options={[
          { value: "dark", label: words.captionDark },
          { value: "light", label: words.captionLight },
          { value: "none", label: words.captionNoBand },
        ]}
      />
      <div className="cf-captions__colors" role="group" aria-label={words.captionColor}>
        {CAPTION_COLORS.map((c) => (
          <ColorSwatch key={c} color={c} size={22} selected={style.color === c} title={words.captionColorName(c)} onClick={() => set({ color: c }, "caption-color")} />
        ))}
        <ColorField
          label={words.captionOtherColor}
          size={22}
          shape="circle"
          value={style.color}
          className={(CAPTION_COLORS as readonly string[]).includes(style.color) ? undefined : "is-custom"}
          onChange={(color) => /^#[0-9a-f]{6}$/i.test(color) && set({ color: color.toLowerCase() }, "caption-color-pick")}
        />
      </div>
    </fieldset>
  );
}
