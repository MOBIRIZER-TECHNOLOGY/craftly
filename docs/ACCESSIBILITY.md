# Accessibility

What was checked, what was found, what was fixed, and what is left. The standard is WCAG 2.1 level AA, plus the WCAG 2.2 rule on the size of click targets. The audit was made on 2026-11-07 with Chrome on Windows, against the dev server and a production build. The colour and size changes it proposed were approved and applied the same day ([Colour and size changes](#colour-and-size-changes-applied)).

**In short.** A person who uses only a keyboard could not get from the page to the toolbars, menus or panels of the editor: Tab was taken by the canvas. That is fixed, together with eight smaller problems. axe-core then reported 4 rules (it reported 10), two of them the colour and size decisions that have since been applied (in four rounds: the second added the grey on hovered rows, the success and danger badges and the names of the page options buttons, the third the danger red of error messages and of the Delete buttons, the fourth the outline of form fields and the amber of icons): words set in colours under 4.5:1 (the top bar, small grey text, a badge, the brand preview, the dashboard headline, the account initial) and a 22 px button. The same 47 screens were measured again, with a pixel scan, after those changes: 30 distinct lines of text under their contrast became 8, none of which is a defect (see below), and the headline went from 2.77:1 to 3.73:1. axe-core itself was not run again (its one permitted download was used up). Nothing here was tried with a real screen reader, so "works with a screen reader" is not claimed.

## How it was checked

| What | How |
| --- | --- |
| Automated rules | axe-core 4.14.0 (WCAG 2.0, 2.1 and 2.2 A and AA rules, plus its best-practice rules) on 47 screens: every page of the dashboard at 1440 px and at phone width, every rail tab of the editor, a shape, a heading and a photo selected, the Edit image panel with each of its tabs (Tools included), the model download question, the Animate panel, Resize, Share, Download, every menu and every dialog |
| Keyboard | Tab through the whole editor, 46 stops with a photo selected: where focus goes, in which order, and whether pixels around the control change when it has the focus (a visible focus indicator) |
| Dialogs and menus | role, accessible name, where focus starts, whether Tab stays inside a modal, whether Escape closes, where focus lands afterwards; menus with Enter, the arrow keys, Escape and Tab |
| Contrast axe cannot judge | text over the top bar's gradient, measured from the pixels behind each label (the text made invisible, the colours read from a screenshot, the real colour of the text compared with the darkest and the lightest pixel) |
| Zoom, motion, status messages | the dashboard at 320 px; the editor at 200 % and 400 %; reduced motion switched on; the live regions, toasts and progress messages read in the code and on the page |
| After the colour and size changes | the same 47 screens, before and after, with one pixel scan (a throw-away script, not kept in the repository, because axe was gone): the text of every line on screen is made transparent, the pixels behind it are read from a screenshot (the 2 % most extreme left out) and the real text colour is laid over the darkest and the lightest of them; text with a gradient fill is compared pixel by pixel with and without it; every button, tab, link and field is measured against WCAG 2.5.8 (24 × 24 px, or room round it); the outline of each kind of text field is compared with what is behind it (WCAG 1.4.11, 3:1). Text inside the design itself is left out: it is the user's colours |
| The screens where the danger red carries words | the same pixel scan, before and after the third round, on five screens that are not among the 47: the create dialog with a size that is out of range, the same dialog with a file that is not a picture, the page menu with a page that can be deleted, the Trash page, and the question "Delete forever?" |

axe-core is **not** a dependency of the project. It was downloaded once for this audit (4.14.0 from the npm registry, MPL-2.0 licence, checked against the SHA-512 the registry publishes), read as text into pages of this app on localhost, and deleted afterwards. To repeat the audit, do the same into a temporary folder and add `axe.min.js` to the page with `page.addScriptTag({ content })`.

**Not checked:** a real screen reader (NVDA, VoiceOver), voice control, Windows high-contrast (forced colours), Safari and Firefox, a touch screen, the text-spacing override of WCAG 1.4.12; the colours of screens that are not among the 47 and were not measured one by one (a finished tool, the favourites, the storage notice, an app that failed, a field that is not valid): they were read from the stylesheets.

## Result

| Rule (axe) | Before | After |
| --- | --- | --- |
| `aria-valid-attr-value` (critical): a tab names a panel that is not on the page | 3 elements, 17 screens | 0 |
| `scrollable-region-focusable`: a list that scrolls but cannot be reached by keyboard | 1 | 0 |
| `page-has-heading-one`: the editor had no top-level heading | every editor screen | 0 |
| `landmark-no-duplicate-banner` | 1 element, 3 screens | 0 |
| `heading-order` | 1 | 0 |
| `aria-allowed-role` | 8 | 0 |
| `label-content-name-mismatch` | 14 | 13 (see "Not defects in substance") |
| `color-contrast` | 14 | 13, applied afterwards (see "Colour and size changes") |
| `target-size` | 1 | 1, applied afterwards (see "Colour and size changes") |
| `region` | 3 | 3 (best practice only, below) |
| Rules reporting something | **10** | **4** (axe, before the colour and size changes) |
| Elements reported | 47 | 30 |

The keyboard walk found what axe cannot: before, the first Tab from a fresh page landed on nothing; now it lands on the first control, and all 46 stops show a visible focus indicator.

## What was fixed, and what guards it

| Problem (criterion) | Fix | Guarded by |
| --- | --- | --- |
| **Tab was taken by the canvas** (2.1.1, 2.1.2). Tab pressed on the page or on the canvas always selected the next element and moved no focus, so a keyboard user could never reach the toolbars, menus or panels. The canvas could not be focused at all. | Tab walks the elements only while the canvas has the focus, and moves on after the last (and before the first) element instead of wrapping round. The canvas is one named stop of the tab order ("Design canvas", with a hint on how it works) and shows a frame while the keyboard has it. | `hotkeys.dom.test.ts`, `Workspace.test.tsx`, `e2e/a11y.cjs` |
| A rail tab named a panel that is not on the page while a context panel (Edit image, Animate, ...) covered it, and the Projects tab's "Show" tabs had no panel at all (4.1.2). | `aria-controls` only while the panel exists; the Projects panel carries its role and id. | `LeftRail.test.tsx`, `ProjectsTab.test.tsx`, `e2e/a11y.cjs` |
| The list of shortcuts scrolls but nothing in it could take the keyboard focus (2.1.1); its groups were `section` elements with the role `listitem`. | The list is a named, focusable region; the groups are `group`s. | `ShortcutsDialog.test.tsx`, `e2e/a11y.cjs` |
| No heading to move by in the editor; empty states on the dashboard jumped from `h1` to `h3` (1.3.1, 2.4.6). | One hidden `h1` naming the design, first in the toolbar; a hidden `h2` naming each side panel; empty states under a page title are `h2`s (`EmptyState` has a `headingLevel`). | `Editor.test.tsx`, `SidePanel.test.tsx`, `Display.test.tsx`, the Trash, Projects and Templates page tests, `e2e/a11y.cjs` |
| Two banner landmarks while the Share panel or Find and replace was open: their title bars were `header` elements. | They are `div`s. | `SharePopover.test.tsx`, `FindReplaceDialog.test.tsx`, `e2e/a11y.cjs` |
| A label on a `span` (the "1 / 3" page counter) and on a `div` (the brand colour swatches): screen readers ignore both (4.1.2). | The counter says "Page 1 of 3" in words and is a polite status (a page change is heard); the swatches are one image named with the colour list. | `BottomBar.test.tsx`, `BrandPage.test.tsx` |
| Accessible names that did not contain the visible label (2.5.3): "Add the page number" for "Page numbers", "Rename design" for the design's title. | "Add page numbers"; "Rename design: <title>". | `TextTab.test.tsx`, `FileMenu.test.tsx` |
| After closing About, or the download question, focus fell to the top of the page (2.4.3): the thing that had opened the dialog (a menu item, a button replaced by a progress block) was gone. | A dialog gives focus back to the button that opened the menu, or to whatever now carries the same `data-focus-key` (each on-device tool's button and its Cancel button share one). | `Modal.test.tsx`, `ToolsTab.test.tsx`, `e2e/ml.cjs`, `e2e/a11y.cjs` |
| The question "Download the background remover?" opened with focus on **Download 88.1 MB**: a held or doubled Enter key could agree to it. | It opens on "Not now" (`confirm()` has a `focusCancel` option). | `Confirm.test.tsx`, `askToDownload.test.tsx`, `e2e/ml.cjs` |

The browser journey `e2e/a11y.cjs` (part of `npm run e2e`) checks the behaviour that only a real browser shows. It was shown to fail when two of these fixes were taken out again.

## Colour and size changes (applied)

The audit measured these and proposed a value for each; the proposals were approved, applied on 2026-11-07, and measured again. Ratios are WCAG contrast ratios; text needs 4.5:1 (3:1 when large). A picture of the changes is in [`images/accessibility-colours.png`](images/accessibility-colours.png).

| Where | Was | Now | Guarded by |
| --- | --- | --- | --- |
| **Top bar**: white labels on `--grad-brand` (File, Resize, Editing, the title, Present) | `#12c2b9 0%, #3b82f6 55%, #7c3aed 100%`: File 2.1, Resize 2.2, Editing 2.6, the title 3.6, Present 4.0 | `#0f766e 0%, #2563eb 55%, #7c3aed 100%`: 5.17 at its worst. The old gradient lives on as `--grad-brand-bright`, for the presenter's progress line (3 px, no words). The hover, pressed and open states of the bar's buttons, and the resting Present button, now **darken** the bar (`--c-bar-hover`, `--c-bar-press`: the ink at 16 % and 28 %) where they used to lighten it: a white tint on the new gradient would have taken the labels to 4.0 and 3.5 at the middle of the bar. The title field's empty-state placeholder is 92 % white (`--c-bar-placeholder`, was 62 %: 2.95:1) | `tokens.test.ts`, `e2e/a11y.cjs` (every label, at rest and under the pointer: 5.15 at worst) |
| **Grey text**, `--c-ink-4` (menu section labels, a font's category, the "Add a font to your kit" placeholder, shortcut group titles, notes, placeholders) | `#9aa1ad`: 2.60 on white | `#696d76`: 5.19 on white, 4.84 on `#f6f7f9`, 4.55 on a hovered row (it was first set to `#6b7078`, 4.98 on white, and darkened one step more in the second round, below, so that it also passes on hovered rows). The 25 uses that were not words (hover borders of buttons, chips, tiles and fields, the hover ring round a page thumbnail, the off switch's track, a dashed outline, the diagonal of the "None" animation, a corner mark) moved to the new `--c-ink-5`, which is the old value. The fourth round (below) then took the hover borders of fields to `--c-ink-4` and the off switch's track to `--c-field-border`, so 16 uses remain; a test fails if any stylesheet sets `color` to `--c-ink-5` | `tokens.test.ts` |
| "Suggested" badge (the soft info badge) | `#3b82f6` on `#e8f0ff`: 3.21 | `--c-info-ink` `#1d4ed8`: 5.85 | `tokens.test.ts` |
| Brand page preview: the logo placeholder and the body copy on the kit's first colour | `#decefa` 3.89 and `#e7dbfc` 4.32 on `#7c3aed` | The ink is still faded, but `fadedInk()` strengthens it until it reaches 4.5:1 on the kit's own first colour, so it holds wherever the full ink can reach 4.5:1 on that colour (on the default purple the two texts are now 4.5 or better; where even the full ink cannot reach 4.5, as on some mid-tones, it is the full ink) | `color.test.ts`, `BrandPage.test.tsx` |
| Dashboard headline, gradient text `--grad-text` (large text, needs 3:1) | `#3b82f6 → #8b3dff`: worst 2.77 | `#2563eb → #7c3aed`: worst 3.73 from the pixels of the worst glyph (the two stops alone give 3.95 on the lavender end of the hero) | `tokens.test.ts`, `e2e/a11y.cjs` (from the pixels) |
| Avatar initial, white on the default colour | `hsl(hue 58% 42%)`: 2.93 for "You" (hue 167); 173 of the 360 hues, the yellows, greens and teals from 29° to 201°, were under 4.5 | `avatarColour()` darkens the lightness a step at a time until the initial reaches 4.5:1; the other hues keep 42 %. "You" is `hsl(167 58% 33%)`, `#238570`: 4.51 | `Display.test.tsx` (720 names), `e2e/a11y.cjs` |
| The options button of a page (in the strip) | 22 × 22 px (the rule is `.cf-strip__more`; the small icon button itself is 28 px) | 24 × 24 px | `e2e/a11y.cjs` (this button, and every target in the editor against WCAG 2.5.8) |

Measured again with the pixel scan on the same 47 screens (before the changes, after them):

| | Before | After |
| --- | --- | --- |
| Distinct lines of text under 4.5:1 (3:1 for large text) | 30 | 8, and none of them is new |
| Text with a gradient fill under 3:1 (worst glyph pixel) | 2 (2.77 and 2.75) | 0 (3.73 and 3.71) |
| Targets under 24 × 24 px with another target close by | 3 | 1 or 2 (the Text tab's small Edit link is reported in some runs, see "Not changed on purpose") |

The 8 lines that remain are not defects: seven are the rail's labels (`--c-ink-3`, 5.21:1 on white) measured while the File menu's shadow lay over them, and one is the "1" in the picture of the page-number tile in the Text tab (white on a blue-violet gradient, 4.2:1, an illustration). The target that is always reported is the title link of a design card on the dashboard (232 × 18 px): the card's thumbnail opens the same design, which is WCAG's exception for an equivalent control.

### Second round (applied the same day, after the first measurement)

The first round left four things, which were proposed and approved too, and applied later the same day.

| Where | Was | Now | Guarded by |
| --- | --- | --- | --- |
| Grey text on a row the pointer is on (the font list's category, for one) and on the workspace | `#6b7078`: 4.37 on `--c-hover` `#eef0f4`, 4.38 on `--c-workspace` `#eff0f5` | `--c-ink-4` `#696d76`: 4.55 and 4.56, 5.19 on white. The pressed row (`--c-press` `#e4e6ec`) is 4.16 and stays under 4.5, as `--c-ink-3` does (4.17); a grey of `#63676f` would pass there | `tokens.test.ts` |
| Soft badges: the "Installed" badge in File > On-device models (success) and the danger badge | `#16a34a` on `#e6f6ec` 2.94; `#e5484d` on `#fdecec` 3.43 | text `--c-success-ink` `#117f3a` (4.55) and `--c-danger-ink` `#c33d42` (4.52), as `--c-info-ink` does for info | `tokens.test.ts` reads `Badge.css` and checks every tone |
| Solid badges (white text; none is on a screen of the app today, only in the style guide) | success 3.30, danger 3.91, info 3.68 | fills `--c-success-solid` `#12883e` (4.55), `--c-danger-solid` `#d34247` (4.53), `--c-info-solid` `#3473da` (4.55) | `tokens.test.ts` |
| Every page had a button called "Page options" (and the add tile's caret too) | the same name N + 1 times, while the caret's own menu was already called "Add page options" | "Page 1 options", "Page 2 options" and so on, in the strip and in the page grid; the menu a button opens has the same name; the add tile's caret is "Add page options" | `PageStrip.test.tsx`, `GridView.test.tsx`, `e2e/a11y.cjs` |

The values first quoted for the badges in this document (`#11803a`, `#12893e`, `#3574db`) were 4.4955, 4.4934 and 4.4945:1: the rounding of the ratio to two places had hidden that each was a few thousandths short of 4.5, so the applied ones are one step darker. `#696e76`, first quoted for the grey, was 4.4973 on a hovered row for the same reason, so `#696d76` is applied.

### Third round (the danger red, applied after the second)

| Where | Was | Now | Guarded by |
| --- | --- | --- | --- |
| Words in the danger red: the delete entries of menus ("Delete page"), the error of a custom size and of an upload in the create dialog, the message of an app that failed, the message under a field that is not valid, the Empty trash and Delete forever buttons | `--c-danger` `#e5484d`: 3.91:1 on white and 3.65 on `#f6f7f9`. Read from the pixels of the five screens: 3.91 for the size error, Delete page, Empty trash and Delete forever, 3.65 for the upload error | `--c-danger-ink` `#c33d42`: 5.16 on white, 4.82 on `#f6f7f9`, 4.52 on the soft red; all five screens pass | `tokens.test.ts` (the token on every surface it is used on, and no stylesheet sets text to `--c-danger`) |
| The resting danger button (the "Delete forever?" question and every other danger button): white on the red | `--c-danger` `#e5484d`: 3.91:1 | `--c-danger-solid` `#d34247`: 4.53:1 (measured: 4.53 on the question). Its hover and pressed colours were darkened to keep their steps (`--c-danger-hover` `#d13a3f` to `#c1353a`, `--c-danger-press` `#b92e33` to `#ab2a2f`), so it is 4.53, 5.47 and 6.77:1 at rest, under the pointer and pressed | `tokens.test.ts` reads `Button.css` |

`--c-danger` itself is unchanged: it still draws the border and halo of a field that is not valid, the icon of a failed save and the red in gradients, none of them text (3.91:1 on white, over the 3:1 a graphic needs). A pressed menu row (`--c-press`) makes the red text 4.14:1, as it does for the grey (4.16): a state that lasts a moment. The message under a field that is not valid (only the style guide shows one) and the message of an app that failed (a QR code that is too long) were changed the same way and were not measured from pixels.

### Fourth round (the last two proposals, applied after the third)

| Where | Was | Now | Guarded by |
| --- | --- | --- | --- |
| The outline of form fields: the search boxes (the one in the dashboard hero too), number fields, text boxes, selects, the hex field of the colour picker, the alt-text box, the cells of a chart's data, the checkbox, and the track of the switch when it is off | `--c-line-strong` `#cfd3db`: 1.50:1 on white, measured from the pixels as 1.5:1 on every kind of field (WCAG 1.4.11 asks 3:1) | the new `--c-field-border` `#8d8f95`: 3.23:1 on white and 3.02 on `#f6f7f9`; measured from the pixels as 3.23:1 on the search boxes, number fields and text boxes. `#92959b`, first quoted, is exactly 3.00 on white and 2.80 on the subtle panel, so one step darker is applied. Under the pointer the outline turns to `--c-ink-4` `#696d76` (5.19:1); it used to turn to `--c-ink-5`, which is now no darker than the rest colour, so the step is kept (1.6:1 between the two) | `tokens.test.ts`: the colour on both surfaces, the hover step, and each of the ten outline rules and nine hover rules by file and selector |
| The amber of icons: the favourite stars (the cards of the dashboard, the Projects tab, the template preview), the starred folder, the warning marks of an app and of the storage notice | `--c-warning` `#f59e0b`: 2.15:1 on white (a graphic needs 3:1) | the new `--c-warning-ink` `#b45309`: 5.02 on white, 4.56 on the soft amber, 4.68 on `#f6f7f9`, 4.40 on a hovered row (a graphic needs 3:1, so it passes everywhere; as words it would pass on the first three surfaces and not on a hovered row). Worked out from the colours: those screens were not measured from pixels | `tokens.test.ts`: the colour on four surfaces, and no stylesheet sets a colour or fill to the plain amber outside the art of the Uploads tab |

## Added after the audit: Back up & restore (2026-11-08)

The dialog was built the day after the audit, to its rules:

- It opens on the first button that works ("Download backup", or "Choose backup file" when there is nothing to back up), and each step (progress, the question before a restore, the result, a problem) puts its main button under the keyboard. Escape and the backdrop do not close it while it works; its Close button stops the work first. Closing it gives the focus back to the Account button (`BackupDialog.test.tsx`, and `e2e/a11y.cjs` in a real browser).
- Progress is a `progressbar` with a name ("Backup progress", "Restore progress") and a plain line of numbers under it; the heading of a step that is running or finished is a polite `status`, a problem is an `alert` with its words ("That file is not a Craftly backup."), and nothing is said by colour alone.
- It uses the audited colours (`--c-ink-2` and `--c-ink-3` for words, `--c-danger-ink` on `--c-danger-soft`, `--c-warning-ink`) and the UI kit's buttons; the dialog fits a 390 px phone without sideways scrolling (`e2e/backup.cjs`).
- **The notices about the library** (2026-11-08): "Craftly was updated in another tab. Reload this tab to keep working." and "Your designs are waiting for another Craftly tab that is still on an older version" are toasts like the update notice below, with the same polite announcement. The screen "Update Craftly to open this design" and the dashboard's "This tab is older than your designs" (a `role="alert"` banner with a Reload button) are plain text with buttons, reached by Tab like the rest. Neither was measured with a screen reader.
- **The update notice** (2026-11-08, "A new version of Craftly is ready. Reload to use it.") is a toast: a polite `status` in the Notifications region, so a screen reader announces it when it appears without taking the focus, with a **Reload** button and a close button that a keyboard reaches by Tab (the region is the last thing on the page). It stays until it is dismissed, so it is not missed. Not measured with a screen reader.
- **Not measured:** axe-core was not run on this dialog (the first audit's permission to fetch it is used up), so its contrast comes from the tokens, not from the screen.

## Added after the audit: the Pen tool (2026-11-08)

- **Placing points is for the pointer.** A click or a drag puts down a point; there is no keyboard way to place one (the same holds for the freehand Draw tool). `Enter`, `Esc`, `Backspace` and `Ctrl+Z` finish or undo what the pointer started (while a path is being placed `Ctrl+Z` takes its last point back and never reaches into the design), and the shortcut `P` picks the tool up, but a person who cannot use a pointer cannot make a path with the Pen. What is listed under Known limits says so.
- **Editing the points of a path is operable from the keyboard.** `Enter` on a selected path (or the **Edit points** button, which is a named toolbar button) opens it; `Tab` and `Shift+Tab` walk through the points and, after the last one (or before the first), move on to the toolbar of the points, exactly as the walk through the elements of a page moves on from the canvas, so the focus is never stuck there; the arrows move the selected one by 1 px (`Shift`: 10 px), `Delete` removes it and `Enter` or `Esc` leaves. **Corner**, **Smooth**, **Delete point**, **Close path** and **Done** are text buttons with names and tooltips, in a toolbar named "Point editing controls" (`PathBar.test.tsx`, `PathEditOverlay.test.tsx`, `pathEditActions.dom.test.ts` and `hotkeys.dom.test.ts` pin the keys, and `e2e/pen.cjs` walks the points with Tab, lands on **Corner** in a real browser and makes a point smooth with the keyboard). What the keys cannot do is pull a handle out: a curve is made by dragging. A first version wrapped Tab round the points for ever, so that these buttons could not be reached from the keyboard; hand-testing found it.
- **The toolbar says what is selected.** Its caption is a polite live region: "Select a point to edit it", "Point 2 of 3, corner" (or smooth), "2 points selected", so a screen reader announces the choice as the keys move it.
- **The points drawn over the page are not read.** The SVG of the preview and of the point editor is `aria-hidden`: its points and handles are targets for the pointer, and the keys and the toolbar do the same work with names. Like the canvas itself it tells a screen reader nothing about the shape.
- **Colours.** The points, handles and the preview use `--c-ring` (`#8b3dff`) with a white fill or a white outline, like the selection's handles. Their contrast with whatever the page shows behind them was not measured, and cannot be: the page can be any colour.
- **Not measured:** the new toolbar and the tool's options with a screen reader, and with axe-core (the permission to fetch it that the first audit used is spent). The 24 px rule of `e2e/a11y.cjs` was not run with the point toolbar open.

## What is left

Nothing in this document is waiting for a decision. What follows was left alone on purpose, or cannot be settled without a person or a device.

### Not changed on purpose

- **The search box in the dashboard hero** sits on a gradient that is darker than white, where its outline is 2.5:1. The white box, its shadow and the outline mark it together; an outline of 3:1 against the gradient would be a much darker grey.
- **Button outlines, the key chips and the dashed drop zones** keep `--c-line-strong`: a button is identified by its label, and the others are decoration. **The unfilled track of a slider** is `--c-line-strong` too (1.5:1); the thumb and the filled part are the control.
- **The presenter notes** are a panel with a divider (`--c-line`: 1.26:1 on white). Its text area has no outline of its own and is found by its placeholder and the focus ring.
- **The "Edit" link of the Text tab** (32 × 20 px) is 22 px from the next button, so it passes WCAG's spacing exception when the panel has settled; the scan reported it in two of four runs. A height of 24 px would remove the doubt.
- **`--c-warning`** stays as a fill behind dark text (the warning badge, the notices), in the illustration of the Uploads tab and in the gradients of the colour pickers.

### Not defects in substance (axe reports them)

- **`label-content-name-mismatch`, 13 elements.** Cards and rows whose visible text is a title plus a description or a tag: the tiles of the create dialog, the font rows, the Apps list, the open design in Projects, the page numbers row. Their accessible name starts with the title and contains it whole, so "click <title>" by voice finds them. axe wants the whole visible text in the name, which no sentence can do when the text sits in several elements (checked with small test pages). The tag and description text is not in the name.
- **`region`, 3 elements.** Menus and popovers are drawn into one container at the end of the page, outside the landmarks. This is axe's best-practice rule, not a WCAG criterion.

### Known limits

- **The design canvas is invisible to a screen reader.** It is a `canvas` hidden from assistive technology. A keyboard user can walk the elements of the page with Tab, move them with the arrow keys and edit text with Enter, but nobody who cannot see the page can learn what is on it. The Layers tab is the start of an answer; a text outline of the page is the real one (listed in the roadmap).
- **Drawing needs a pointer.** The Pen and the freehand Draw tool place their points by pointer only, and a curve (a handle) can only be pulled with one. Everything else about a path, down to moving its points, can be done from the keyboard.
- **400 % zoom** (a 360 px wide window) leaves the editor without a canvas area; at 200 % it works but is tight. The editor is a two-dimensional layout, for which WCAG's reflow rule allows an exception. The dashboard reflows to 320 px without sideways scrolling.
- Reduced motion is honoured everywhere by one global rule that makes transitions and animations last a hundredth of a millisecond.

## Rules for new work

The conventions are in [CONTRIBUTING.md](../CONTRIBUTING.md). The ones this audit added:

- Tab belongs to the browser: do not take it with a key handler on `window` unless the canvas itself has the focus.
- A dialog that something opened gives focus back to it. If the opener may be replaced while the dialog is open, give both the same `data-focus-key`.
- A question where a repeated Enter could do harm opens on its safe answer (`focusCancel`).
- Do not put `header` elements in popovers and floating dialogs, and do not put `aria-label` on a `span` or `div` without a role.
- Text colours: 4.5:1 against what is behind them (3:1 for text of 24 px or more, or 18.66 px and bold). Words are set in `--c-ink` to `--c-ink-4`; the lighter `--c-ink-5` is for icons, borders and lines, and a test fails if a stylesheet colours text with it.
- Text over a gradient or a picture is measured from the pixels, not from the stylesheet (`e2e/a11y.cjs` has the helpers). On the top bar a hover is a dark tint (`--c-bar-hover`), never a white one.
- Text whose colour comes from the user (the brand kit's preview, an avatar) goes through `fadedInk()`, `readableOn()` or `avatarColour()`, which reach 4.5:1 wherever the colour allows it (`readableOn()` gives 4.4:1 at worst, on a mid-tone such as `#e12d5f`; `avatarColour()` reaches 4.5:1 for every name).
- A control a pointer must hit is 24 × 24 px, or has 24 px of room round it (WCAG 2.5.8); `e2e/a11y.cjs` checks the editor.
- Markup is also checked while it is written: the jsx-a11y rules of ESLint (`npm run lint`, run by CI) refuse an `<img>` without `alt`, a click handler on a `div` that has no keyboard way to the same thing, a bare `<input autoFocus>` and the like. Where a pattern is deliberate (a tab list whose tabs are the focusable parts, a dialog backdrop that closes on a click while the keyboard has Esc, a scrolling region that takes the focus) the exception sits at the place, with its reason after `--`.
- A button that repeats (one per page, one per row) carries what tells it apart from the others in its name: "Page 2 options", not "Page options" three times; the menu it opens is named the same.
- The outline of a form control (a text field, a checkbox, the off track of a switch) is `--c-field-border` and turns to `--c-ink-4` under the pointer; amber for an icon is `--c-warning-ink`, and the plain `--c-warning` is only a fill behind dark text.
- Words in a status colour use the tone's `-ink` token (`--c-danger-ink`, `--c-success-ink`, `--c-info-ink`), and a filled status surface with white words on it uses its `-solid` token or the `-hover` and `-press` steps of it; a test fails if a stylesheet sets text to the plain `--c-danger`.
- When a text colour token changes, `src/styles/tokens.test.ts` holds its contrast, and the contract block in `docs/DESIGN.md` section 5 must list the same value (the test compares them).
