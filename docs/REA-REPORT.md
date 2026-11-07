# REA investigation report

How [REA](https://github.com/morluto/rea) was used to study the Canva web application, what it found, what it could not reach, and how each finding maps to Craftly.

**Status:** a historical record of the study made while Craftly was first built (it was finished on 2026-11-04). The Animate row of the mapping table and the check count were updated later; the paths and counts are as of then. The code, the [README](../README.md) and [`e2e/README.md`](../e2e/README.md) say what Craftly does today.

## Method

REA 6.8.0 was driven against a throwaway Chrome profile (loopback DevTools port, closed again after the work). The public pages were captured first, then the owner of the Canva account signed in themselves in that window (REA and the agent never handled credentials) and REA observed the signed-in application.

| REA tool | Used for |
| --- | --- |
| `list_browser_targets` | enumerating the controlled browser's page targets |
| `capture_web_screenshot` | pixel evidence of the dashboard and every editor state |
| `inspect_web_page` (accessibility + DOM) | control inventory: exact accessible names of buttons, tabs, menus, handles; page structure |
| `analyze_web_bundle` | static look at the editor's shipped scripts: 6 script sources, no static route patterns (the editor is a dynamically loaded single-page app), so no further architecture could be recovered statically |

UI states that REA cannot trigger by itself (opening panels, adding a text box, right-click, File / Share menus) were exercised with `playwright-core` (REA's own bundled engine) while REA's passive tools recorded the result.

### Limits met along the way
- `capture_browser_scenario` (REA's scripted browser runner) failed on this Windows host with an opaque `execution_failure` even for a one-step scenario; the same `playwright-core` library works when driven directly, so scripted steps used it.
- The editor and the logged-in dashboard require an account. Nothing was created beyond one scratch design, and nothing was deleted, shared, downloaded or paid for.
- Server behaviour (AI, collaboration, publishing, billing) is not observable from the client and was not replicated.

## What was observed

**Dashboard** - 72px left rail (Create, Home, Projects, Templates, Brand, More; notifications and account at the bottom), pale gradient hero with the heading "What will you design today?", pill tabs Home / Templates, a large rounded search field, a row of design shortcuts (Presentation, Social media, Video, Printables, Doc, Whiteboard, Sheet, Website, Custom size, Upload, More), then carousels: Templates for you, Browse template categories, Popular, Quick Create. Template cards expose Preview, Star and More actions. "Create a design" is a large modal: search, category list, "Popular" grid of illustrated design types.

**Editor shell** - 56px gradient top bar (Home, File, Resize, Editing mode, Undo / Redo, save state, title, Present, Share); icon rail with eight tabs (Templates, Elements, Text, Brand, Uploads, Tools, Projects, Apps); 340px side panel with search and a collapse handle; grey workspace with a white page; page strip with thumbnails and an add-page tile; bottom bar with Notes, Timer, zoom slider (logarithmic, 10-300%), zoom menu, Pages toggle, page counter, Grid view, Fullscreen, Help.

**Contextual UI** - a floating toolbar whose contents depend on the selection (text: font, size stepper, colour, B/I/U/S, case, alignment, list, spacing, transparency, Effects, Animate, Position; shapes add fill, border, corner radius); a mini toolbar above the selection (lock, duplicate, delete, more); circular corner handles, pill side handles, rotate and move handles; a right-click menu (Copy, Copy style, Paste, Duplicate, Layer, Align to page, Lock, Link, Alt text ...); side-panel takeovers for Position (Arrange / Layers tabs, align to page, width / height / X / Y / rotate), Effects (Drop, Glow, Echo, Outline, Background, Splice, Hollow, Neon, Glitch, Curve), text colour (document colours, brand colours, solid and gradient palettes) and fonts.

**Menus and export** - File menu (create, upload, copy, page view, rulers and guides, save, star, move, download, print, version history, trash, settings, find and replace, help); Share popover with Download, Present and others; Download panel (file type, presets, options, Download button); grid view with a page toolbar; zoom presets 300 / 200 / 125 / 100 / 75 / 50 / 25 / 10 / Fit / Fill.

## Mapping to Craftly

| Observed | Craftly module |
| --- | --- |
| Dashboard shell, hero, shortcuts, carousels, create modal | `src/dashboard/` |
| Projects / folders / starred / trash | `src/dashboard/`, `src/core/library.ts` (IndexedDB) |
| Top bar, File / Resize / Share menus, Present | `src/editor/topbar/`, `src/editor/present/`, `src/editor/dialogs/` |
| Icon rail and side-panel tabs | `src/editor/panels/` |
| Position, Effects, colour, font, filters panels | `src/editor/panels/context/` |
| "Animate" in the contextual toolbars (text: Effects, **Animate**, Position) and its panel with Page / Element animation tabs | `src/core/animation.ts`, `src/core/transition.ts`, `src/render/playback.ts`, `src/editor/panels/context/AnimatePanel.tsx` (added later at the user's request; Canva's own animation presets and servers were not copied, the presets are original). Present plays the animations, transitions and auto-play (`src/editor/present/PresentPlayer.ts`), and the Download panel's Animated GIF and Video (WebM) options come from `src/export/animated/`; both were written from the feature descriptions, not from observed code |
| Floating toolbar, mini toolbar, context menu | `src/editor/toolbar/` |
| Canvas selection, handles, rotation, snapping guides, marquee, drop onto frames | `src/editor/canvas/` (`controller.ts`, `SelectionOverlay.tsx`, `snapping.ts`, `resize.ts`) |
| Rich text editing | `src/editor/canvas/TextEditorOverlay.tsx`, `src/render/textLayout.ts`, `drawText.ts` |
| Page strip, grid view, notes, zoom bar | `src/editor/pages/`, `src/editor/bottombar/` |
| Undo / redo and autosave ("All changes saved") | `src/core/store.ts`, `src/editor/autosave.ts` |
| Download panel and file types | `src/export/` |
| Templates, illustrations, photos, fonts | `src/data/`, `src/render/fonts.ts` |

## Deliberate differences

Original branding, templates, illustrations, photos and icons; local-first storage instead of accounts; no cloud AI, video / audio editing, collaboration or publishing; "Share" produces project files, exports and printouts rather than links. (Since this study Craftly has gained four photo tools whose neural networks run on the user's own device, see [ON-DEVICE-AI.md](ON-DEVICE-AI.md), and animated GIF / WebM export.)

## How the result was checked against the observations

Each observed workflow above was rebuilt and then driven the way a person would use it, with the scripted journeys in `e2e/` (83 checks when this report was written, more since: `e2e/README.md` has the current list; run against both the dev server and the production build, console clean):

| Observed in Canva | Check in Craftly |
| --- | --- |
| Create dialog and design shortcuts | create from a tile, from a template, and from "Create new design" inside the editor (1080x1350 Instagram size verified) |
| Rail tabs, "Browse categories" tiles, item click-to-insert | shapes, photos, graphics, charts, tables, lines and frames each insert and select (`journey.cjs`) |
| Floating toolbar per selection (text / shape / image / group / page) | toolbar controls enumerated per selection type; text size, styles, font, colour, alignment, list, case, spacing, Effects and curve change the document (`features.cjs`) |
| Position panel with Arrange and Layers | order, align to page, lock and hide verified; locked elements refuse moves |
| Image editing (Edit image, Crop, Flip, Replace) | filter preset, crop mode, flip and Replace through the browser's file chooser |
| Templates panel and multi-page templates | apply a whole deck (confirm dialog, 3 -> 9 pages), apply one page and undo |
| Page strip, grid view, reorder, delete | add, duplicate, navigate, drag-reorder and delete pages |
| Share > Download, file types | PNG, JPG, PDF and SVG downloads are captured and their file signatures checked |
| "All changes saved", Recent designs | reload keeps the design; it reopens from Recent designs |
| File menu (trash, find and replace, resize, rulers, present) | each is exercised; Shift+R rulers and guides from the ruler were added after the check showed the shortcut missing |
| Responsive editor | 1024 / 768 / 390 px screenshots reviewed: the side panel becomes a bottom sheet with a tool dock, no horizontal overflow |

Two defects surfaced only through this end-to-end pass and were fixed: the dashboard's and the editor panels' tile components both used the CSS class `cf-tile` (the editor's was renamed `cf-cattile`), and the offline service worker failed to serve cached modules because static hosts send `Vary: Origin` (cache lookups now use `ignoreVary`, and the whole build is precached from a generated manifest).
