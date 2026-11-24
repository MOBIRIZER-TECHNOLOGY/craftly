/**
 * The editor holds plain keys pressed on its controls back from the canvas shortcuts (Editor.tsx, FloatingToolbar.tsx), so
 * that arrows, Enter, Space and Tab act on the control. A letter on a button of the bars is the exception: it means nothing to
 * the button, and the keyboard lands on such a button whenever a dialog or popover closes and hands it back to the button
 * that opened it. T, R, C, L, P and M then still add and pick, as they did before the dialog.
 *
 * The bars are the top bar, the bottom bar, the floating toolbars and the Tools palette. Controls that jump to an item by its
 * first letter keep their letters, and so do the tabs and items of the side panel (the keyboard goes on through the panel).
 */

const BARS = ".cf-topbar, .cf-bottombar, [role='toolbar']";
const TYPEAHEAD = "[role='combobox'], [role='listbox'], [role='menu'], [role='menubar'], [aria-haspopup='listbox']";

/** Whether this key is a plain letter pressed on a button of the bars, which the canvas shortcuts should still get. */
export function isBarLetter(e: KeyboardEvent): boolean {
  const target = e.target;
  if (!(target instanceof Element) || e.ctrlKey || e.metaKey || e.altKey || !/^[a-z]$/i.test(e.key)) return false;
  return !!target.closest("button") && !!target.closest(BARS) && !target.closest(TYPEAHEAD);
}
