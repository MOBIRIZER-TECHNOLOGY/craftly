import type { CSSProperties } from "react";
import { captionOutlineIsDark, clipCaptionStyle } from "@/core/animation";
import type { CaptionStyle, VideoElement } from "@/core/types";
import { m } from "@/i18n";
import { ColorSwatch, Segmented } from "@/ui";
import { editElements, only } from "../selection";

/** The colours offered for the words: white, yellow, black, and a few that stand out on most footage. */
export const CAPTION_COLORS = ["#ffffff", "#facc15", "#000000", "#22d3ee", "#f472b6", "#4ade80"] as const;

const FONT_CSS: Record<Required<CaptionStyle>["font"], string> = {
  sans: 'Inter, "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
};

/** A sample line in the style, beside the controls: captions are drawn only while the clip plays, so this is where a change shows. */
function sampleStyle(style: Required<CaptionStyle>): CSSProperties {
  const outline = captionOutlineIsDark(style.color) ? "#000" : "#fff";
  return {
    fontFamily: FONT_CSS[style.font],
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
      <Segmented
        size="sm"
        fullWidth
        aria-label={words.captionFont}
        value={style.font}
        onChange={(font) => set({ font }, "caption-font")}
        options={[
          { value: "sans", label: words.captionSans },
          { value: "serif", label: words.captionSerif },
          { value: "mono", label: words.captionMono },
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
      </div>
    </fieldset>
  );
}
