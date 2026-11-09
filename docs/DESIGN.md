# Craftly - design spec and architecture

Craftly is a standalone, browser-only graphic design studio modelled on the workflows of
Canva's web editor. It has a dashboard, a full canvas editor, templates, a media library,
multi-page designs with animation and a full-screen presenter, and export to PNG / JPG / PDF /
SVG, animated GIF and WebM video, and `.craftly` project files. There is no backend: designs,
uploads and the brand kit live in IndexedDB, fonts and sample assets ship inside the bundle, so
the app works offline.

**Out of scope (deliberately):** AI that needs a server (Magic Design, Magic Write, image
generation, ...), video / audio editing, real-time collaboration, accounts, payments. The
exception is four photo tools (Remove background, Blur background, Colour pop, Upscale) whose
neural networks run on the user's device (section 10); a model is downloaded once, after the user
agrees. Anything else that needs a server is either replaced by a local equivalent (share =
export file) or left out.

**Original branding and assets.** The name, logo, templates, illustrations, photos and fonts
are original or openly licensed (Fontsource / lucide). Nothing is copied from Canva's bundle.
Only *behaviour and layout conventions* were taken from the reverse-engineering notes below.

## 1. Reverse-engineering notes (REA evidence)

Captured with REA (`capture_web_screenshot`, `inspect_web_page` passive accessibility/DOM
capture) from a signed-in Canva session, plus driven UI states. Use these as the UI spec.
This section records the reference product (Canva) as it was observed: Craftly builds most of it, not all of it (for
example its right-click menu has no "Change to frame", "Comment", "Link" or "Show element timing"). What Craftly
actually has is listed in the README and in `reports/Craftly versus Canva feature gaps.md`.

### Dashboard (Home)
- Left rail (~72px, collapsible): toggle, round purple **Create** button, then Home, Projects,
  Templates, Brand, (AI / Print Shop / Dream Lab - not replicated), More; notifications + account at the bottom.
- Main area has a rounded top-left corner and a pale teal-to-lavender gradient header:
  heading "What will you design today?", pill tabs **Home | Templates**, a large rounded
  search field ("Search anything").
- A row of design shortcuts (icon tile + label): Templates, Presentation, Social media (submenu),
  Video, Printables (submenu), Doc, Whiteboard, Sheet, Website, Magic Layers, Custom size, Upload, More.
- Sections with carousels and next-arrows: Templates for you, Browse template categories
  (Presentation 16:9, Instagram Post 4:5, Document A4, Flyer US, Doc, Landscape Video, Logo, Business Cards,
  Invitations, Posters, Flyers, Postcards, Tags, Gift Certificates), Popular on Canva, Quick Create.
- Template cards: hover shows Preview, Star (favourite), More actions.
- **Create a design** modal: search "What would you like to create?", category list on the left
  (For you, Presentations, Social media, Photo editor, Videos, Printables, Docs, Whiteboards, Sheets,
  Websites, Custom size, Upload, More), "Popular on Canva" grid of illustrated design types
  (Presentation 16:9, Instagram Post 4:5, Document A4 Portrait, Flyer US, Doc, Landscape Video, Logo, YouTube Thumbnail).

### Editor shell
- **Top bar** (56px, teal -> blue -> purple gradient, white text): Home, **File**, **Resize**,
  **Editing** dropdown (Editing / Viewing), Undo, Redo, "All changes saved" indicator, centered
  editable design title, **Present** (+ dropdown), **Share**.
- **Left rail** tabs (icon over label, active tab gets a rounded tinted square): Templates, Elements,
  Text, Brand, Uploads, Tools, Projects, Apps. **Side panel** (~340px) opens beside it with a
  search field on top; a small round chevron handle on its right edge collapses it.
- **Elements** panel: "Browse categories" 3-column grid of glossy tiles - Shapes, Graphics, Photos,
  Videos, 3D, Forms, Animations, Audio, Sheets, Tables, Charts, Frames, Grids, Mockups.
- **Text** panel: font search, purple **Add a text box**, Brand kit, "Default text styles"
  (Add a heading / subheading / a little bit of body text), Dynamic text (page numbers), Font combinations.
- **Uploads** panel: search, purple **Upload files** (+ more menu), "Record yourself", empty state
  "Upload, store and organize" with a dashed drop zone.
- **Tools** opens a floating vertical palette (Select, Draw, Shapes, Line, Sticky note, Text, Table).
- **Canvas**: light grey-lavender workspace, white page with a soft shadow. Fit zoom by default.
- **Bottom bar**: Notes, Timer | zoom slider (log scale), zoom % dropdown (300, 200, 125, 100, 75, 50, 25, 10, Fit, Fill),
  **Pages** toggle, "1 / 3" page indicator, Grid view, Fullscreen, Help.
- **Page strip** above the bottom bar: thumbnails with page number, selected one has an outline,
  a "+" add-page tile with a chevron (add page type).
- **Grid view** shows all pages as large thumbnails with a toolbar: add page, duplicate, delete, more.

### Contextual toolbar (floating, top of the canvas, white, rounded)
- **Text**: font family dropdown, size stepper (- 34 +), text colour (A with colour bar), **B** *I* U S,
  case (aA), alignment, list, spacing ("Advanced settings"), transparency, Effects, Animate, Position.
- **Shape**: Edit, fill swatch, border style, corner radius, then text controls, transparency, Effects,
  Position, copy-style brush, more.
- Elements also get a small floating mini toolbar above them: Comment, Lock, Duplicate, Delete, More (...).
- Handles: white circular corner handles, white pill side handles, a circular rotate handle below the
  box, a "Move selection" handle beside it. Selection outline is purple.
- **Position** panel (replaces the side panel): tabs **Arrange | Layers**; Forward, Backward, To front,
  To back; "Align to page" Top, Left, Middle, Center, Bottom, Right; Advanced: Width, Height, aspect-ratio
  lock, X, Y, Rotate.
- **Effects** panel: Style grid (Drop, Glow, Echo, Outline, Background, Splice, Hollow, Neon, Glitch),
  Shape (Curve), Advanced presets.
- **Text colour** panel: search, document colours (+ new colour, eyedropper), brand kit, default solid
  colours (7 x 4 grid), default gradient colours.
- **Right-click menu**: Copy, Copy style, Paste, Duplicate, Layer >, Align to page >, Change to frame,
  Comment, Lock, Link, Show element timing, Alternative text.
- **File menu**: design title + meta (size), Create new design, Upload files, Make a copy, Page view >,
  Rulers and guides >, Save, Make available offline, Star, Move, Download, Print >, Version history,
  Move to Trash, Settings >, Accessibility >, Find and replace text, Help >.
- **Share** popover: People with access, Access level, Copy link, tiles for Download, Present,
  Public view link, Website, PowerPoint, Drive, Embed. **Download** panel: File type (PDF suggested),
  presets Digital | Print, Compress, Advanced settings, purple **Download**.
- Default design: 1920 x 1080 px presentation shown at 50% (Fit).

### Not replicated (needs a server / AI / subscription)
Canva AI, Magic tools, brand voice, comments & real-time collaboration, publishing to websites,
video/audio timeline, Pro-only gating, print ordering. The on-device photo tools of section 10
are the exception to the AI line.

## 2. Stack

| Concern | Choice |
| --- | --- |
| Build / dev | Vite 7, TypeScript 5.9 (strict) |
| UI | React 19, plain CSS files with design tokens (no CSS-in-JS, no Tailwind) |
| State | Zustand store + immer for document edits |
| Canvas | One custom 2D canvas renderer (shared by the editor, thumbnails, the presenter and the raster, PDF and animated exports; SVG export has its own writer, `export/svg*.ts`) with HTML/SVG overlays for selection and text editing |
| Persistence | IndexedDB (designs, folders, assets, brand kit, versions) through numbered database steps; every stored format has a version and migration steps ([`MIGRATIONS.md`](MIGRATIONS.md)); the whole library can be written to one ZIP and restored ([`BACKUP.md`](BACKUP.md)) |
| Fonts | `@fontsource` / `@fontsource-variable` packages, loaded lazily with the FontFace API |
| Icons | `lucide-react` for UI chrome, `lucide` raw icon nodes for the design "Icons" library |
| On-device AI | `onnxruntime-web` (WebGPU) in a Web Worker; each model is fetched once, after the user agrees (section 10) |
| Offline | A service worker (`public/sw.js`) and a `precache.json` that the build writes (`vite.config.ts`); a new build waits until the person presses Reload ([`UPDATES.md`](UPDATES.md)) |
| Tests | Vitest 5 with V8 coverage: pure logic in Node, every screen in jsdom with React Testing Library (`src/test/` holds the harness); scripted browser journeys with playwright-core in `e2e/` |

## 3. Folder map and ownership

```
src/
  main.tsx, App.tsx, router.ts, serviceWorker.ts, settleSaves.ts, databaseNotices.ts app shell (serviceWorker.ts registers the worker and offers a waiting new build; databaseNotices.ts tells the person when another tab upgrades or holds up the database; settleSaves.ts writes the open design before either); the hash router (#/, #/projects[/folderId], #/templates[/categoryId], #/brand, #/trash, #/design/:id)
  styles/                      tokens.css, base.css (design tokens, resets, scrollbars)
  ui/                          reusable, app-agnostic components (Button, Popover, Menu, Modal, Slider, ColorPicker ...)
  core/                        framework-free model + logic
    types.ts                   the document model (READ THIS FIRST)
    ids.ts geometry.ts color.ts svg.ts factory.ts clone.ts assets.ts
    ops.ts                     pure document operations (align, group, reorder, duplicate ...)
    pen.ts penShape.ts         vector paths: points with handles, the curve maths and the editing of a path (pen.ts); how a path sits in a shape element (penShape.ts)
    combine.ts                 combining shapes (union, subtract, intersect, exclude) and writing a shape as a path, on paper.js, which loads on first use in a chunk of its own
    ../collab/                 live editing by several people, no DOM and no network: operations and the difference between two designs (ops.ts), what may arrive (protocol.ts), a shared design on the server (room.ts), a browser's side (session.ts); see docs/COLLABORATION.md
    connectors.ts              lines that are attached to shapes: the point on a side of a (turned) box, the side that faces a point, the straight line between two points, `reflowLines` (run by every `commit`), and how copies and replaced shapes keep their lines
    problems.ts recovery.ts    what went wrong on this device and the one report that may leave it (problems.ts); getting back to work after a crash: counts, the version kept before a crashed state is written, going back to a version (recovery.ts); clipboardText.ts copies text (docs/CRASH-RECOVERY.md)
    animation.ts transition.ts element animations and page transitions (pure timelines)
    textMetrics.ts             pluggable text measurer
    store.ts                   Zustand editor store: document, selection, clipboard, history, view, panels
    persistence.ts library.ts  IndexedDB + design library service
    schema/                    the migration runner, the design format and the database upgrade (MIGRATIONS.md)
    storage.ts                 what the browser says about storage (estimate, persisted) and the one request to keep it
    saveNow.ts                 save the open design now and wait for it (the File menu, the update prompt)
  render/                      canvas renderer
    renderPage.ts              renderPage(ctx, ...) - the single paint routine
    textLayout.ts drawText.ts drawBlocks.ts  rich text layout + effects, tables and charts
    paint.ts imageFilters.ts   fills and gradients, image filters
    shapePaths.ts              shape catalogue geometry
    images.ts                  image / SVG loading + cache
    fonts.ts                   font catalogue + lazy loader
    playback.ts                animated playback (the presenter, GIF / WebM export, the Animate panel's transition player)
  components/                  PageThumb (thumbnails drawn by the renderer), ErrorBoundary
  editor/                      editor UI
    Editor.tsx hotkeys.ts insert.ts autosave.ts
    topbar/ bottombar/ pages/  top bar and file menu, bottom bar (notes, timer), page strip and grid view
    canvas/                    PageView, SelectionOverlay, TextEditorOverlay, controller (pointer logic), snapping, the Pen (penTool, PenPreview) and the point editing of a path (PathEditOverlay, pathEditStore, pathEditActions)
    panels/                    left side-panel tabs + context panels (Position, Effects, Colour, Fonts, Filters with the photo Tools tab, Background, Data, Animate)
    toolbar/                   floating contextual toolbar + mini toolbar + context menu
    dialogs/                   download, resize, find and replace, keyboard shortcuts, version history, on-device models
    present/                   full-screen presenter: PresentPlayer (frame loop), playbackPlan (pure rules)
  dashboard/                   Home, Projects, Templates, Brand, Trash, CreateDialog
  export/                      png / jpg / pdf / svg / zip, animated gif + webm (animated/), Download panel, project files, library backup (zipRead, backupFormat, backup; see BACKUP.md)
  ml/                          on-device AI: registry, download + store, worker + engine, compositing, the jobs (section 10)
  data/                        catalogues: designTypes, shapes, fonts (via render/fonts), graphics, icons, photos,
                               backgrounds, palettes, filters, textCombos, templates/
  dev/                         development only, never in the production build: Gallery (#/gallery), Sandbox (#/sandbox), a sample
                               design, and the entry points of the root dev-*.html pages (one screen each, served by vite.dev-*.config.ts)
  test/                        the jsdom harness (canvas recorder, fake IndexedDB, observers ...) and test helpers; see README.md there
```

Tests sit next to the code they cover (`Foo.test.tsx` for components, `foo.dom.test.ts` for DOM or canvas code without JSX,
`foo.test.ts` for pure logic).

## 4. Conventions

- **Coordinates**: design pixels, origin top-left of the page, y down. Rotation in degrees clockwise about
  the element centre. Elements inside a group use the group's local space.
- **Immutability**: documents are plain JSON. Mutate only through `store` actions (immer inside) or pure
  functions in `core/ops.ts`. Never mutate store state from a component.
- **History**: every committed action is one undo step. Continuous gestures (drag, slider scrub, typing)
  use `beginTransaction()` ... `endTransaction()` or the `{ coalesce: "key" }` option (edits with the same key less than
  1.2 s apart merge) so they become one step. The history keeps the last 120 steps.
- **Saving**: `editor/autosave.ts` writes the design 700 ms after the last change, on Ctrl+S and when the tab is hidden; the
  thumbnail is refreshed at most every 4 s and a version snapshot is kept at most every 5 minutes.
- **Text size**: text box height is derived from layout; `store` re-measures text after edits. Do not
  hand-compute text heights in UI code - call `measureTextElement(el)` from `render/textLayout.ts`.
- **Styling**: one CSS file per component next to it (`Foo.tsx` + `Foo.css`), class names namespaced
  (`.cf-popover`, `.cf-tb__text`). Class names are global and a stylesheet that was loaded stays loaded, so a class
  belongs to one top-level package of `src` (dashboard, editor, ui ...) and each package prefixes its names
  (`cf-dshortcut` for the dashboard, `cf-brandtab` for the editor's Brand tab); `src/styles/classNames.test.ts` fails when
  two packages style one selector. Use only CSS variables from `styles/tokens.css`; no raw hex in component CSS except in
  data files, the colour picker and a few fixed colours on the canvas overlays, the page strip and the Animate panel
  (white, black, two greys, the pink snap guide and the blue ruler guide).
- **Accessibility**: every icon-only button has `aria-label` + tooltip; all menus/dialogs are keyboard
  operable (Esc closes, arrow keys move, Enter activates, focus returns to what opened them); visible
  `:focus-visible` ring; respect `prefers-reduced-motion`. The canvas is one named stop of the tab order
  (Tab walks its elements while it has the focus, then moves on). Audit and open items: `docs/ACCESSIBILITY.md`.
- **Imports**: use the `@/` alias (`@/core/types`). No default exports except React components that are
  lazily loaded. No new npm dependencies without need - everything required is already installed.
- **Copy**: sentence case, plain verbs ("Add a text box", "Download", "Move to trash"). Errors say what
  happened and how to fix it.

## 5. Visual language (tokens)

The UI is friendly and rounded, with purple as the action colour and a teal -> blue -> purple brand gradient.
UI font: Plus Jakarta Sans (variable). `src/styles/tokens.css` must define these variables with these values; the UI-kit
extensions that follow them in that file (semantic tints, control sizes, extra shadows ...) are not part of the contract.

```css
:root {
  --c-primary: #7c3aed;        --c-primary-hover: #6d28d9;   --c-primary-press: #5b21b6;
  --c-primary-soft: #f1ebff;   --c-primary-softer: #f8f5ff;  --c-ring: #8b3dff;   /* selection outline */
  --c-teal: #12c2b9;           --c-blue: #3b82f6;
  --grad-brand: linear-gradient(90deg, #0f766e 0%, #2563eb 55%, #7c3aed 100%);
  --grad-hero: linear-gradient(180deg, #b9eef0 0%, #e6dcff 100%);
  --grad-text: linear-gradient(90deg, #2563eb, #7c3aed);

  --c-ink: #0e1318;  --c-ink-2: #3a3f4a;  --c-ink-3: #666d7a;  --c-ink-4: #696d76;  --c-ink-inverse: #fff;
  --c-line: #e3e5ea; --c-line-strong: #cfd3db;
  --c-bg: #ffffff;   --c-bg-subtle: #f6f7f9;  --c-workspace: #eff0f5;  --c-hover: #eef0f4;  --c-press: #e4e6ec;
  --c-danger: #e5484d;  --c-success: #16a34a;  --c-warning: #f59e0b;

  --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 24px; --r-pill: 999px;
  --sh-1: 0 1px 2px rgba(14,19,24,.08);
  --sh-2: 0 2px 8px rgba(14,19,24,.14);
  --sh-float: 0 2px 14px rgba(14,19,24,.18);
  --sh-pop: 0 10px 36px rgba(14,19,24,.22), 0 0 0 1px rgba(14,19,24,.05);

  --font-ui: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --fs-xs: 11px; --fs-sm: 12.5px; --fs-md: 14px; --fs-lg: 16px; --fs-xl: 20px; --fs-2xl: 28px; --fs-3xl: 40px;

  --topbar-h: 56px;  --rail-w: 72px;  --panel-w: 340px;  --bottombar-h: 52px;  --strip-h: 96px;
  --ease: cubic-bezier(.2,.8,.2,1);  --dur-fast: 120ms;  --dur: 200ms;
  --z-panel: 20; --z-toolbar: 30; --z-popover: 100; --z-modal: 200; --z-toast: 300;
}
```

Three values differ from the first version of this contract, because words set in them were under 4.5:1 (3:1 for the
large headline): `--grad-brand` (the white labels on the top bar), `--grad-text` (the dashboard headline) and
`--c-ink-4` (small grey text). Two of the old values live on under new names, as extensions in `tokens.css`, for what carries
no words: `--grad-brand-bright` and `--c-ink-5` (icons, borders and lines); the old `--grad-text` was dropped. Measurements and reasons are in
[ACCESSIBILITY.md](ACCESSIBILITY.md); `src/styles/tokens.test.ts` keeps this block equal to `tokens.css` and holds the
contrast of the colours that carry words.

## 6. Module contracts

### 6.1 Fonts - `src/render/fonts.ts`
```ts
export type FontCategory = "sans" | "serif" | "display" | "script" | "handwriting" | "mono";
export interface FontDef {
  family: string;          // display name stored in documents, e.g. "Plus Jakarta Sans"
  css: string;             // CSS family registered with FontFace, e.g. "Plus Jakarta Sans Variable"
  category: FontCategory;
  weights: number[];       // available weights, every 100 (a variable font lists its usable range, e.g. 200 to 800)
  variable: boolean;
  italic: boolean;         // a real italic face exists (otherwise the browser synthesises oblique)
}
export const FONT_CATALOG: FontDef[];
export function getFontDef(family: string): FontDef | undefined;
/** Canvas/CSS font-family value with fallbacks, e.g. `"Plus Jakarta Sans Variable", "Plus Jakarta Sans", sans-serif`. */
export function cssFontFamily(family: string): string;
/** Loads (once) the files needed for this face; resolves when usable. Unknown families resolve immediately. */
export function ensureFont(family: string, weight?: number, italic?: boolean): Promise<void>;
export function isFontReady(family: string, weight?: number, italic?: boolean): boolean;
/** Starts loading every face of the given families (for the font picker). */
export function preloadFonts(families: string[]): Promise<void>;
/** Increments whenever a face finishes loading. */
export function fontsEpoch(): number;
export function onFontsChange(cb: () => void): () => void;
```

### 6.2 Renderer - `src/render/renderPage.ts`
```ts
export interface RenderOptions {
  clip?: Rect;            // design-space rect whose top-left maps to canvas (0,0); defaults to the page
  scale: number;          // canvas px per design px (zoom x devicePixelRatio, or the export scale)
  transparent?: boolean;  // skip the page background (transparent PNG)
  hide?: ReadonlySet<ID>; // element ids not painted (text being edited / image being cropped)
  animation?: { time: number }; // paint the page `time` seconds into its animations (section 9); omitted = at rest
}
/** Returns true when every image / graphic / font was ready; false means "repaint when resources arrive". */
export function renderPage(ctx, design: Pick<Design, "width" | "height">, page: Page, opts: RenderOptions): boolean;
/** Waits for fonts and images, then paints. Used by thumbnails and template previews (the exporters call `renderPage` themselves, band by band). */
export async function renderPageToCanvas(design, page, opts: { width: number; transparent?: boolean; time?: number }): Promise<HTMLCanvasElement>;
export function preparePage(page): Promise<void>;       // awaits all resources of a page
export function graphicMarkup(el: GraphicElement): string; // final (recoloured) SVG of a graphic
```

### 6.3 Store - `src/core/store.ts`
`useEditor` is a Zustand hook. Components read state with selectors and call `useEditor.getState().actions.*`
(or `getActions()`). The authoritative list of state fields and actions is the `EditorState` /
`EditorActions` interfaces in that file. Highlights:
`design`, `activePageId`, `selection` (element ids), `zoom`, `leftTab`, `context` and `panelOpen` (the panels), `editingTextId`,
`croppingId`, `saveState`, `canUndo/canRedo`; actions for pages, elements, text, arrange/align/group,
clipboard, history, view and panels.

### 6.4 Catalogues (all pure data + tiny helpers, no React)
- `src/data/designTypes.ts` - `DESIGN_TYPES: DesignType[]`, `getDesignType(id)`.
- `src/render/shapePaths.ts` - the shape catalogue (`SHAPES`, `getShape(id)`); `src/data/shapes.ts` - `SHAPE_PRESETS` and
  `SHAPE_GROUP_LABELS`, what the Shapes panel lists.
- `src/data/graphicTypes.ts` - `GraphicDef`, `GraphicCategory` (shared by the graphics data files).
- `src/data/graphicsA.ts`, `src/data/graphicsB.ts`, `src/data/graphics.ts` - illustrations/stickers; `src/data/icons.ts` - lucide adapter.
- `src/data/photos.ts` - procedural stock photos (`builtin:<id>` sources).
- `src/data/backgrounds.ts`, `src/data/palettes.ts`, `src/data/filters.ts`, `src/data/textCombos.ts`.
- `src/data/templates/` - `TEMPLATES: Template[]`.

### 6.5 Image sources (`ImageElement.src`, `ImageFill.src`)
`asset:<id>` (IndexedDB upload), `builtin:<id>` (procedural photo), `data:` / `http(s):` literal. Resolve through
`render/images.ts: loadImage(src)`; the renderer never touches IndexedDB directly.

### 6.6 Reserved procedural photo ids (templates may rely on all of these)
Landscapes: `sunset-hills ocean-waves mountain-lake desert-dunes forest-mist aurora-night tropical-beach snowy-peaks rolling-fields canyon-glow pastel-clouds lavender-fields`
City: `city-night city-dawn glass-towers`
Abstract: `mesh-sunrise mesh-ocean mesh-candy mesh-forest mesh-midnight liquid-purple neon-grid soft-blobs paper-waves boho-arches grain-orb`
Textures: `paper-cream marble-white concrete-gray linen-beige terrazzo watercolor-wash kraft-paper wood-oak`
Nature: `palm-leaves monstera wildflowers bokeh-gold water-ripples cherry-blossom`
Space: `nebula starfield moon-horizon galaxy-spiral`

## 7. Quality bar

- 60 fps interaction with a few hundred elements; the canvas repaints only the visible region of the page.
- No dead buttons: every control visible in the UI works or is not rendered.
- Keyboard shortcuts (Canva compatible): Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+C/X/V/D, Ctrl+A, Delete, arrows (+Shift),
  Ctrl+G / Ctrl+Shift+G, Ctrl+] / [, T R C L, Ctrl+= / - / 0, Space-drag pan, Esc. The complete list is the Keyboard shortcuts
  dialog (`editor/dialogs/ShortcutsDialog.tsx`).
- Responsive: dashboard collapses to a bottom tab bar under 760px; the editor falls back to a bottom sheet
  for panels under 900px.
- Tested: `npm run coverage` runs the whole suite with V8 coverage and fails when the total drops below 95 % on
  statements, branches, functions or lines. Tests assert what a person sees or what changes in the document (roles and
  labels, the store, IndexedDB, what the recording canvas painted), never snapshots; `src/test/README.md` has the rules.

## 8. Integration contracts (editor modules)

**Store** (`@/core/store`): `useEditor` (Zustand). Read state with selectors; call `getActions()` / `s.actions`.
State used by UI: `design, activePageId, selection, editingTextId, croppingId, tool, toolShape, mode ("edit"|"view"),
zoom, zoomMode, viewport, leftTab, context (ContextPanelState | null), panelOpen, showPageStrip, gridView, notesOpen,
presenting, dialog (DialogName | null), canUndo, canRedo, saveState, snapEnabled, showRulers, clipboard, styleClipboard`.
Hooks: `useActivePage()`, `useSelectedElements()`; helpers `getActivePage(state)`, `getSelectedElements(state)`.
Actions are listed in `EditorActions` (open `store.ts`). Key conventions:
- Style changes to the selection: `actions.updateSelection(patch | fn, {coalesce: "key"})`; text: `actions.setTextProps(null, patch)`
  (null = selection). Never mutate elements directly.
- Sliders / scrubbing: `{coalesce: "opacity"}` merges rapid edits into one undo step.
- Panels: `actions.setLeftTab(tab)`; context panels (Position, Effects, Colour, Font, Filters, Background):
  `actions.openContext({kind: ...})` / `closeContext()`. Dialogs: `actions.openDialog("resize" | "shortcuts" | ...)`.

**Inserting content** (`@/editor/insert`): `insertImage(src, nw, nh, at?)`, `insertImageFiles(files, at?)`,
`setDragPayload(e, payload)` for panel items (so they can be dragged onto the canvas), `DragPayload` types.
Panels add elements with `actions.addElement(el)` / `addElements(els, {at})` (centres on the page by default).

**Inline text formatting** (`@/editor/canvas/textEditing`): while a text box is being edited, call
`textEditing.applyInline({bold: true, color: "#f00", size: 40, font: "Lora"})`; it returns `true` when it formatted the
selected characters, `false` when there is no selection (then fall back to `actions.setTextProps`). Read toggle states
from `useTextSelectionStyle()`.

**Crop helpers** (`@/editor/canvas/CropOverlay`): `getCropScale(el)`, `setCropScale(id, s)`, `resetCrop(id)`.

**Pen and point editing** (`@/core/pen`, `@/core/penShape`, `@/editor/canvas/penTool`, `pathEdit*`): a path is the existing `ShapeElement` with `shape: "path"` and `path` = SVG path data in a 0..100 box that is stretched to the element's box (`scalePathData`), so the Pen added nothing to the stored formats and needed no migration. `pen.ts` is pure: a `PenPath` is `{ nodes, closed }`, a node is `{ x, y, handleIn, handleOut }` (handles are offsets from the anchor; a point is smooth when both are there, opposite and on one line, within half a degree), `parsePath` reads one piece of absolute M, L, H, V, C, Q and Z (anything else, such as an arc, relative commands or two pieces, is not editable: `elementPath(el)` is null and no Edit points button is offered), `pathToString` writes M, L, C and Z with at most three decimals, and every editing function (`moveNodes`, `moveHandle`, `insertNode`, `deleteNodes`, `setNodeKind`, `closePath`) returns a new path. `penShape.ts` is the bridge to the element: `elementPath(el)` gives the points in the element's own pixels, and `patchForPath(el, path)` gives the `x, y, width, height, path` that fit the new curve (the box is the curve's own bounds, at least 1 px each way) and keep every point where it is on the page whatever the element's rotation and flips (`localToDesign` and `designToLocal`). A gesture always maps from the element as it was when the gesture began. The path being placed is transient (`useGesture().pen`, which also holds the page it was started on); finishing it calls `setTool("select")` and adds one element, so it is one undo step. When another page is chosen first it is finished on the page it was drawn on (`addElement` with that `pageId` and `select: false`, so that the page, the tool and the selection stay as the person made them) and it is dropped only when the design is closed or another one is opened. Undo and redo belong to the path while it is placed: `penHistory` takes its last point back (redo does nothing), and the keys in `hotkeys.ts` and the buttons of the top bar ask it first. Point editing has its own store, `usePathEdit` (the id of the open element and the selected point numbers); `PathEditOverlay` is the pointer's part (SVG over the element, one transaction per gesture; its pointer maths subtracts the workspace's place on the screen, which is not 0, 0 in a browser), `pathEditActions` is everything else (the toolbar `PathBar`, and the keys through `pathEditKey` in `hotkeys.ts`: Tab walks through the points and stops at the ends, leaving the key to the browser so that the toolbar can be reached). A locked path is not opened (`startPathEdit` and the overlay both say no). Escape peels the innermost layer first: a preview, text editing, a crop, a path being placed (it is finished), point editing, the tool, a context panel, the selection.

**Combining shapes** (`@/core/combine`, `@/editor/toolbar/combine`, the store action `replaceElements`): the geometry is paper.js 0.17 (MIT), imported dynamically by `paperScope()` (one scope with a project that has no view; a load that failed is tried again; `vite.config.ts` names the package in `optimizeDeps.include`, because a dev server that finds a library only when the page asks for it reloads the page, which `src/test/devServerDeps.test.ts` guards). `outlineOf` builds a paper outline from the shape's own path data (`shapePathData`, in the pixels of its box) and, for a shape drawn with the even-odd rule, `reorient(false, true)` turns the pieces so that the non-zero rule, which a stored path is drawn with, leaves the same hole (`reorient(true, ...)` resolves the pieces by the non-zero rule instead, and so takes away a hole whose piece runs the same way round as the one it is in; the ring of the shape list happens to run the other way, so `combine.evenodd.test.ts` mocks a shape that does not); what paper's boolean operations give back is already turned the right way round; `placeOnPage` mirrors, turns and moves it to where the shape is drawn. `combineShapes(shapes, op)` takes the shapes from the back to the front of the page (the first is what `subtract` cuts from) and gives `{ x, y, width, height, path }`: the box of the result and its path data in the 0..100 space of that box (`fitPaths` in `pen.ts`), so a result is an ordinary path element and the stored formats did not change. A result of one piece is read by `parsePath` and can be edited with Edit points; holes and separate pieces are several `M` commands, which `parsePath` does not read. `shapeAsPath(shape)` writes a preset shape in the 0..100 space of its own box, so Convert to path keeps the box, turn and mirror. `shapesToCombine(page, ids)` is the rule for what can be combined (two or more shapes on the page itself, shown, not locked), `combinedShape` and `makePath` build the replacement (the look of the shape at the back). The work is asynchronous, so `combineElements` and `convertToPath` remember the shapes they started from and give up, with a message, when one of them is not the same object when the geometry is back (the person edited it in between); `replaceElements(ids, el, pageId?)` is the one undo step.

**Lines attached to shapes** (`@/core/connectors`, the store action `connect`, "Connect" in `@/editor/toolbar/common` and `contextMenuItems`): `LineElement` has two optional fields, `start` and `end`, each `{ elementId, anchor }` with the anchor `auto | top | right | bottom | left` (no version bump: they are named in `ADDED.design` of `persistedShapes.test.ts`). A bound line is still an ordinary straight line (`x, y, width, rotation`), so the painter, the exporters, hit testing and the line toolbar know nothing about attachments; `src/core/connectors.ts` keeps those numbers right. `commit` ends with `reflowLines(next, base)` (after `normalizeTexts`, so a text that grew is aimed at too): for every line on a page that changed it compares each target with the object it was in `base` and re-aims the line when the target is a new object (structural sharing makes that cheap); `openDesign` and the font-loaded re-measure call it too. Rules, in the file's header: a target that goes takes its lines (undo restores both, one snapshot), a line moved by hand is detached (it is recognised as: the line is a new object, its bindings and its targets are as they were, and it is not where the anchors put it), a target that is put in a group lets go (the ids of nested elements are collected so that "inside a group" is told from "gone"), a binding to a line or to nothing is dropped; lines inside groups are not examined. Copies: every place that clones elements (`duplicateElements`, `paste`, `addElements`, `clonePageWithIds` and `clonePage`) calls `rebindClones(originals, clones)`, which walks both trees in parallel and attaches a copied line to the copies of its shapes (cut loose from those not copied with it); `replaceElements` (Combine) calls `retargetLines`, which hands the lines of the replaced shapes to the new one and removes a line that would join it to itself. `connect(fromId, toId, opts)` adds the line with placeholder geometry and lets `commit` aim it. The anchor of a side is the middle of that side of the box turned about its centre; `auto` picks the side that faces the centre of the other end. Not built yet: routing other than a straight segment, labels, a connector tool (docs/PLAN-DIAGRAMS-AND-COLLABORATION.md, D1b to D1d).

**Working together** (`@/collab`, `@/server`, `@/editor/live`, the store's `startLive` / `stopLive` / `applyShared` / `setLiveLink`; the model, the protocol and the server are in docs/COLLABORATION.md): a design that carries `design.live` (a `LiveLink`: server, room, key, role, the view key of the person who started sharing; local, optional, never sent, in no `DESIGN_KEYS`) is connected by the editor for as long as it is open (`Editor.tsx` calls `connectLive(link)`, which owns a `Live`). In the store, `startLive(bridge)` makes the design shared: `commit` now ends in `settle(base, produced, opts)`, which works out the derived values, and, when a bridge is attached, diffs the change (`diffDesign`), tells the bridge (`bridge.change(before, after)`, which is `live.edit`) and records **this person's own step as operations** (`{ forward, inverse }`) instead of a snapshot; coalesced edits and a gesture (`beginTransaction` / `endTransaction`) are joined into one step, and what other people did during a gesture is not part of it. `undo` / `redo` in a shared design apply the inverse / forward operations of the last step to the design as it is now (`applyOps`, then `settle(..., { record: false })`, so the others are told); a step that others have made moot is used up without harm. `applyShared(shared)` lays the session's design (server plus this person's unconfirmed batches) on the local design with `withShared` (the library fields stay), heals what is derived and local (`normalizeTexts`, `reflowLines(next, null)`), keeps the selection as far as it still exists, goes to the first page if the open page is gone, and marks the design unsaved so that autosave keeps the local copy up to date; it is not a step of history and is not told back. `openDesign` / `closeDesign` detach the bridge. A solo design is untouched: `bridge` is null and `commit` behaves as it always did. The link that is handed out is `#/join/<base64url of {s, r, k, v}>` (`links.ts`; the key after the `#` is never sent to a server); `JoinPage` connects once, saves a copy that carries the link (`saveJoined`; `craftly.live.joined` in localStorage maps server and room to the copy, so the same link opens the same copy) and replaces its own history entry with the editor's.

**Context menu**: the toolbar package calls `setContextMenuHandler(fn)` from `@/editor/canvas/controller`; `fn(clientX, clientY, { overElement })`
opens the menu (UI kit `openContextMenu`; `overElement` is true when something is selected).

**View**: `useView` (`@/editor/canvas/viewStore`) holds scroll offsets and the page position; `designToScreen(m, x, y)` gives
workspace-relative CSS px - floating toolbars use it to follow the selection. `Workspace` accepts `children` rendered above
the canvas inside the workspace box (position: absolute works in workspace coordinates).

**Routes** (hash, `src/router.ts`): `#/` home, `#/projects[/folderId]`, `#/templates[/categoryId]`, `#/brand`, `#/trash`,
`#/design/:id`. `navigate(path)`, `useRoute()` and `designPath(id)` come from `@/router` (`@/App` re-exports them).
Library service: `@/core/library` (designs, folders, trash, brand kit, versions); uploads: `@/core/assets`.

**Data modules**: `@/data/designTypes`, `shapes`, `graphics`, `icons`, `photos`, `backgrounds`, `palettes`, `filters`,
`textCombos`, `textStyles`, `templates` (see section 6.4); fonts: `@/render/fonts`.

## 9. Animation (Animate)

Canva's Animate is rebuilt as a small, dependency-free system: **a document model, a pure engine, one renderer hook, and
four consumers** (editor preview, presenter, animated export, templates).

**Model** (`core/types.ts`). `ElementBase.animation?: { in?, out?, loop? }` where each phase is `{ kind, duration, delay,
direction? }`; `Page.duration?` (seconds, default 5) and `Page.transition?: { kind, duration, direction? }` (how the
playback arrives at that page). Only top-level elements animate; a group moves as one. A page lasts 1 to 60 s, an entrance or
exit at most 5 s, a delay at most 10 s and a transition at most 3 s. All fields are optional JSON, so
older designs and `.craftly` files are unaffected.

**Engine** (`core/animation.ts`, `core/transition.ts`; no DOM, fully unit-tested).
- `evaluateAnimation(anim, t, pageDuration)` returns an `AnimState` (opacity, offset in units of the shorter page side, scale,
  rotation, a clip window, an inner content offset for mask reveals, a typewriter `reveal`) or `null` when the element is at
  rest. Timeline of a page: entrance `[delay, delay+duration]`, exit `[D-delay-duration, D-delay]` (counted back from the
  end), emphasis repeating every `duration`. An exit plays the entrance backwards.
- Presets: entrances/exits Fade, Rise, Pan, Pop, Zoom, Wipe, Slide, Drop, Tumble, Typewriter, Flicker; emphasis Breathe,
  Pulse, Float, Wiggle, Spin, Flash. Directional ones take left/right/up/down (direction of travel).
- Page animations (`PAGE_ANIMATION_PRESETS`) give every non-backdrop element the same entrance, staggered bottom-up
  (`pageAnimationFor`); a full-page picture or panel (`isBackdrop`, >= 85% of the page) stays still, and hidden and locked
  elements are skipped.
- Transitions: Dissolve, Slide, Push, Wipe, Zoom, Dip to black. `transitionFrame(kind, p, direction)` gives the layer state of
  the old and new page. `buildTimeline(pages)` lays pages out as `[transition into the page][the page for its duration]`;
  `frameAt(timeline, t)` says whether second `t` is a page (and how far into it) or a transition (and how far).

**Renderer.** `renderPage(..., { animation: { time } })` paints a page `time` seconds in: `drawAnimated` applies the state
about the element's centre, then clips (wipe/mask/typewriter by line) in the element's own rotated frame. Without the option
nothing changes, so thumbnails, still exports and the editor show every page at rest. `render/playback.ts` adds
`PlaybackRenderer.renderAt(ctx, timeline, t)` (pages and transition composites) used by the presenter and the exporters.

**Consumers.**
- *Editor*: toolbar **Animate** button (text, shape, image, graphic, group, table, chart, multi-selection and the page bar)
  opens the Animate panel (`panels/context/AnimatePanel.tsx`): Page animations tab (presets, page duration, transition with a
  live mini-player) and Element animations tab (Entrance / Exit / Emphasis tiles that play a miniature on hover, then
  direction / duration / delay). Choosing or changing something plays the page on the canvas (`editor/canvas/preview.ts`,
  hidden overlays, Esc stops). Page thumbnails of animated pages carry a sparkle.
- *Present mode* (`editor/present/`): `PresentPlayer` owns the canvas and the frame loop; `playbackPlan.ts` holds the rules as
  pure functions (unit tested). Moving by hand plays the arriving page's entrances and emphasis, but never its exits (a held
  page stays complete; `stripExits`). One page forward plays that page's transition, one page back plays the page being left's
  transition with its direction reversed (`planTransition`), and any other jump (Home, End) uses the destination's. A second
  key or click during a transition finishes it first, and the first page's transition never plays. Both end frames of a
  transition are painted once into scratch canvases and only blended per frame (`drawTransition`). **Auto-play** (`P` or the
  button) follows `buildTimeline` from the current page, exits and all, shows a progress line, and stops after the last page;
  Next or Previous turns it off. A page with nothing moving costs no frames at all, and with `prefers-reduced-motion` every
  move is an instant cut and nothing animates.
- *Export* (`export/animated/`): Animated GIF and WebM video from the Download panel, driven by the same timeline and
  `PlaybackRenderer`. `ExportOptions` gained `resolution` (480, 720 or 1080, the shorter side; default 720; both sides even, at
  most 1920) and `fps` (GIF only, 1 to 30, default 15; a video is always 30). All pages play as one animation, "Current page"
  plays that page alone, "Custom" plays the chosen pages in order with each page's own transition between them.
  - *GIF* (`gif.ts`, `lzw.ts`, `palette.ts`; no dependencies): one global palette of 255 colours chosen by median cut from frames
    spread over the timeline, ordered (Bayer) dithering so still areas keep the same indices in every frame, NETSCAPE2.0 loop
    extension, and frame differencing (unchanged pixels become one reserved transparent colour, only the changed rectangle is
    stored, an identical frame only extends the previous frame's delay). Frames are encoded one at a time and the thread is
    handed back after each, so progress and Cancel work and memory stays flat. Limits: 4000 frames, 1.5 billion pixel-frames.
  - *WebM* (`video.ts`, `webm.ts`): the playback is drawn onto a canvas in real time and recorded with `captureStream` and
    `MediaRecorder` (VP9 or VP8, the browser's own encoder), so it takes as long as the animation and the tab must stay in
    front; the clock holds still across a gap longer than 1.5 s and the result says so. Chrome writes no duration, so
    `webm.ts` adds the Segment Info `Duration` element (a `<video>` would otherwise report `Infinity`). At most 10 minutes.
  - Pictures are flattened onto white. The encoders are their own lazily loaded chunk (`animatedExport`).
  - `.craftly` project files keep `Page.duration` and `Page.transition` (clamped; malformed values are dropped, never thrown).
- *Templates*: `data/templates/motion.ts` gives the ten decks and the stories their own transitions and staggered entrances.

Undo/redo, duplication, copy/paste, version history, autosave and project files carry the animation fields; slider scrubbing
is one undo step (`patchAnimation` coalesces).


## 10. On-device models (`src/ml/`)

The photo tools that use neural networks run on the user's device. The full design, the decisions and the licence rules are
in [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md); this is the map of the code.

| File | Role | Needs a browser? |
| --- | --- | --- |
| `registry.ts`, `types.ts` | The models the app knows: Hugging Face repository and commit, size, SHA-256, licence, credits, tensor names and normalisation | no |
| `pixels.ts` | Picture to input tensor, model output to 0-255 coverage, half precision numbers | no |
| `tiles.ts`, `limits.ts` | The maths of a model that makes pictures larger: the plan of tiles, a tile's window of the picture (mirrored at the edge), the part of an answer that belongs to the picture, the colours of transparent pixels, which factors fit within 25 megapixels | no |
| `coverage.ts` | The mask stretched over a picture (coverage of every pixel of a row, blended between the mask's values) and the checks of the buffers: what Blur background and Colour pop share | no |
| `colourPop.ts` | The maths of Colour pop: the grey of the Filters panel's black and white, the two styles, how far each background pixel goes toward its grey, and the count of pixels that changed so that it can be seen | no |
| `blur.ts` | The maths of Blur background: the weights (only the background's own pixels are averaged), three box blurs on a coarser grid, the three strengths, all of it a few rows at a time | no |
| `download.ts`, `modelStore.ts` | Fetch with progress and a size + SHA-256 check (no cookies, no referrer); the models' own IndexedDB; storage estimate and `persist()` | IndexedDB |
| `device.ts` | Workers, storage, a WebGPU adapter: checked cheapest first | no (injected) |
| `engine.ts` | Inside the worker: one ONNX session, strictly one request at a time (a mask for a photo, or one tile made larger), errors classified (`out-of-memory`, `runtime`) | no (runtime injected) |
| `workerHost.ts`, `worker.ts`, `ortRuntime.ts` | The worker's message wiring, its entry, and the loader of the real `onnxruntime-web/webgpu` | the last two: yes |
| `client.ts` | The page's end: starts the worker on first use, one request at a time (`run` for a mask, `tile` for a tile), cancel = end the worker, idle worker ended after 5 minutes | no (worker injected) |
| `compose.ts` | The photo squeezed into the model's square, and the mask applied back at the photo's size with a `destination-in` draw; a photo's pixels at its own size; the canvas a result is put together on (the tiles of a larger picture, the rows of a blurred one), and the PNG or JPEG made of it | canvas |
| `service.ts`, `state.ts` | The jobs (install, remove, import, **remove background**, **blur background**, **colour pop**, **upscale**, **restore original**; the four photo jobs share `runPhotoJob` and `applyResult`, the three on the subject also `locateSubject` and the mask of the last photo, and the blur and the colour pop `pieceRunner` and `paintAndApply`) and the store the screens read | no (everything slow is injected through `MlDeps`) |
| `askToDownload.ts`, `labels.ts`, `useSupport.ts` | The one consent question, the words for each step and for the time left, and the hook that asks what a model needs of the browser | no |
| `errors.ts` | `MlError` and its codes, the failures a job can end in (`not-installed`, `unsupported`, `offline`, `quota`, `out-of-memory`, `stale`, `busy` ...), each with a message fit to show | no |

Rules worth keeping:

- **Locked photos and view-only designs are refused first, and a change that did not land is never reported as done** (the service checks the element after applying).
- **Cancel is honoured until the result is applied**; a result that arrives after Cancel is thrown away, with its new picture.
- **Nothing downloads without a yes.** Every photo job fails with `not-installed` unless the caller passes `askToDownload`; the Tools tab does, the Models dialog's button is its own consent.
- **A model must be tried on a real GPU first** (`e2e/ml-probe.cjs`): BiRefNet lite loaded and then failed on a 16-buffer limit, and ISNet replaced it (see `ON-DEVICE-AI.md`).
- **A failed runtime start ends the worker.** The ONNX runtime remembers it and would repeat it for every later request; the client terminates the worker after a `runtime`, `out-of-memory` or `engine` failure.
- **The engine is typed with the real `onnxruntime-web` types** (a type-only import), so the compiler checks every call against the real API; the unit tests use a stand-in runtime and `e2e/ml.cjs` runs the real one.
- **A job never writes to the wrong picture.** It remembers the element's `src`; if the photo was replaced or deleted while the model worked, the result is dropped. The cut-out lands on the page the photo is on (`updateElementsOnPage`), even if the person turned to another page.
- **The original is kept.** `ImageElement.originalSrc` remembers the picture a tool replaced; `projectFormat` exports and remaps it, so "Restore original" survives a saved project file. Replacing the picture by hand forgets it.
- **One photo job at a time, whichever tool.** `runPhotoJob` refuses a second one (`busy`); the Tools tab shows the one Cancel for the job that runs, wherever it runs.
- **A tile is the unit of work.** The upscaler cuts the photo into equal tiles, each with 16 pixels of its surroundings (mirrored at the photo's edge), asks the model for one tile at a time, and puts the part that belongs to the picture on the canvas: progress, the time left and Cancel (which ends the worker) all follow from that, and no array of the whole result is ever built. The stand-in model of the tests makes every pixel a block of pixels, so the stitched result is compared with the original pixel for pixel, in the unit tests and in the browser.
- **The blur averages only the background.** Every pixel has a weight (1 behind the subject, 0 on it, 0 where there is no opacity) and the blurred colour is sum(colour x weight) / sum(weight), so a plain background stays exactly as it was up to the outline and nothing of the subject's colour reaches it. The subject (coverage 1) is never touched, byte for byte; the opacity never is.
- **Long pixel work is done in pieces.** The blur takes about 262,000 pixels at a time, looks at Cancel between pieces and gives the browser a turn through a message channel about every 30 ms (`MlDeps.yieldToBrowser`; never a timer, which a background tab holds back to once a second). The pieces give the same picture however the rows are split.
- **Colour pop saves only a real change.** It counts the background pixels (on the background side of the outline, at least half there) that moved by two levels or more; under 0.1 % of the picture, nothing is saved and the person is told why (grey already, transparent, only a faint rim). The grey a soft outline puts on the subject's own edge does not count.
- **The model is asked once for a picture.** The last mask is kept for the picture a job began with and the model, so Undo and another strength do not wait for it again; it goes with the model.
- **A model sees colours, not transparency.** The pixels of a transparent picture get the colour of the nearest solid pixel before the model sees them; the opacity is put back at the end, stretched by the browser. Without this the model draws a dark fringe along every edge.
- **Runtime file.** The 28.7 MB WebAssembly file is a build output listed under `runtime` in `precache.json` (not precached); the service worker stores it in its own cache (`craftly-runtime`) on first use and keeps it across updates.
