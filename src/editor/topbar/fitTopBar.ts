/**
 * The top bar folds its words into icons when they do not fit. How wide a word is depends on the font that draws it (Hindi falls
 * back to a different system font on every platform, and on Linux it is wider than on Windows), so the breakpoints in
 * topbar.css cannot promise that File, Resize, Present and Share fit between them: at 600 to 680 px in Hindi they were cut to
 * "फ़ा…". The bar measures instead. It tries the fewest folds first and keeps the first that leaves every word whole:
 *
 *   fold 1: Editing, Present and Share become their icons, and the separators go (what a phone shows below 600 px);
 *   fold 2: Resize becomes its icon too;
 *   fold 3: the title folds away (the File menu then renames in a dialog) and Redo goes (what a phone shows below 520 px).
 *
 * If a word is still cut after the last fold, it ends in an ellipsis rather than pushing the bar wider than the screen.
 */

export const FOLDS = 3;

/** Whether a word in the bar is cut short, or the bar is wider than its box. Labels that are not shown measure 0 and do not count. */
export function isCut(bar: HTMLElement): boolean {
  if (bar.scrollWidth > bar.clientWidth + 1) return true;
  for (const label of bar.querySelectorAll<HTMLElement>(".cf-btn__label")) {
    if (label.clientWidth > 0 && label.scrollWidth > label.clientWidth + 1) return true;
  }
  return false;
}

/** Folds the bar as little as it needs, and returns how far (0 to FOLDS). Each try is measured at once (a layout is forced). */
export function fitTopBar(bar: HTMLElement): number {
  let fold = 0;
  delete bar.dataset.fold;
  while (fold < FOLDS && isCut(bar)) {
    fold++;
    bar.dataset.fold = String(fold);
  }
  return fold;
}

/**
 * Fits the bar now and again whenever something can change what fits: the bar's width (the window), the groups' width (people
 * joining, the comments button), a label's size (the language, the mode) and a font arriving. Returns the stop.
 */
export function watchTopBar(bar: HTMLElement): () => void {
  const fit = () => {
    if (bar.isConnected) fitTopBar(bar);
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(bar);
  for (const part of bar.querySelectorAll(".cf-topbar__group, .cf-btn__label")) observer.observe(part);
  const fonts = document.fonts as FontFaceSet | undefined;
  fonts?.addEventListener("loadingdone", fit);
  return () => {
    observer.disconnect();
    fonts?.removeEventListener("loadingdone", fit);
  };
}
