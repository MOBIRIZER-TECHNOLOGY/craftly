/**
 * Tells the person when the open design names a font this device does not have: one that was uploaded on another
 * device and came here in a project file without it, one that was deleted from the brand kit, or one that somebody
 * else in a shared design uses (font files are not sent through the live server). Such text is drawn in a substitute
 * font and the design is not changed, so without a word the person would see a different design and not know why.
 *
 * Each font is named once per design while the editor is open. The Font panel marks the same fonts in its list of the
 * fonts of the document.
 */
import { missingFontsOf, startCustomFonts } from "@/core/customFonts";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { onFontsChange } from "@/render/fonts";
import { toast } from "@/ui";

const quoted = (family: string) => `“${family}”`;

/** The words of the notice for these fonts: up to three by name, the rest counted. */
export function missingFontMessage(families: string[]): string {
  const rest = "The design is not changed. If you have the font, upload it under Brand > Your fonts.";
  if (families.length === 1) return `The font ${quoted(families[0])} is not on this device, so its text is shown in a substitute font. ${rest}`;
  const named = families.slice(0, 3).map(quoted);
  const more = families.length - named.length;
  const list = more > 0 ? `${named.join(", ")} and ${more} more` : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `The fonts ${list} are not on this device, so their text is shown in a substitute font. ${rest}`;
}

/**
 * Watches the open design and the uploaded fonts, and says which fonts are missing. It looks a moment (`delay` ms) after
 * the last change, so that dragging something across the page is not a look at every font for every step, and never
 * before the uploaded fonts were read (`ready`): until then every uploaded font would look missing. Returns the function
 * that stops it.
 */
export function installMissingFontNotice({ delay = 800, ready = startCustomFonts() }: { delay?: number; ready?: Promise<unknown> } = {}): () => void {
  let stopped = false;
  let fontsRead = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let looked: Design | null = null;
  let toldFor: string | null = null;
  let told = new Set<string>();

  const look = () => {
    timer = null;
    const design = useEditor.getState().design;
    if (stopped || !fontsRead || !design) return;
    looked = design;
    if (design.id !== toldFor) {
      toldFor = design.id;
      told = new Set();
    }
    let missing: string[];
    try {
      missing = missingFontsOf(design);
    } catch {
      // a damaged design is somebody else's to report (the editor stops for it): this only looks on
      return;
    }
    const fresh = missing.filter((family) => !told.has(family));
    // a font that is back (uploaded again) is named again should it go missing once more
    told = new Set(missing);
    if (fresh.length) toast.info(missingFontMessage(fresh), { duration: 12000 });
  };

  const schedule = () => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(look, delay);
  };

  const unsubscribeStore = useEditor.subscribe((now) => {
    if (now.design !== looked) schedule();
  });
  // an upload or a deletion changes what is missing while the design stays as it is
  const unsubscribeFonts = onFontsChange(schedule);
  void ready.then(() => {
    fontsRead = true;
    schedule();
  });

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribeStore();
    unsubscribeFonts();
  };
}
