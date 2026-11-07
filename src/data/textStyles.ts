/** The "Default text styles" of the Text panel: add a heading, a subheading or a little body text. */
import { DEFAULT_FONT, textPresetSizes } from "@/core/factory";

export type TextStyleId = "heading" | "subheading" | "body";

export interface TextStylePreset {
  id: TextStyleId;
  /** Button label in the panel; also the placeholder text of the element it adds. */
  label: string;
  fontFamily: string;
  fontWeight: number;
  /** Font size as a fraction of min(design width, design height). */
  sizeFactor: number;
}

/** The real size in a design comes from `textPresetSizes`; the factors are read from it so the two cannot drift. */
const SIZES_PER_1000_PX = textPresetSizes(1000, 1000);

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { id: "heading", label: "Add a heading", fontFamily: DEFAULT_FONT, fontWeight: 700, sizeFactor: SIZES_PER_1000_PX.heading / 1000 },
  { id: "subheading", label: "Add a subheading", fontFamily: DEFAULT_FONT, fontWeight: 600, sizeFactor: SIZES_PER_1000_PX.subheading / 1000 },
  { id: "body", label: "Add a little bit of body text", fontFamily: DEFAULT_FONT, fontWeight: 400, sizeFactor: SIZES_PER_1000_PX.body / 1000 },
];
