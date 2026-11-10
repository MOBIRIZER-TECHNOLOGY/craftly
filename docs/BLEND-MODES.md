# Blend modes

**Status (2026-11-10):** built and verified; feature 3 of the plan of 2026-11-09 (1 Combine shapes, 2 Crash recovery, **3 Blend modes**, 4 Check design, 5 Reusable styles, 6 Small wins, 7 MP4 export; see [`PLAN-DIAGRAMS-AND-COLLABORATION.md`](PLAN-DIAGRAMS-AND-COLLABORATION.md)). Not committed until the owner says so.

## What a person gets

Select an element or a group, open **Transparency** in the toolbar, and under the slider choose **Blend mode**: Normal (the default, the same as no mode) or one of fifteen, in the order of a photo editor's list: Darken, Multiply, Color burn, Lighten, Screen, Color dodge, Overlay, Soft light, Hard light, Difference, Exclusion, Hue, Saturation, Color, Luminosity. The box says **Mixed** when the selected elements differ, a choice is one step of undo, and a design with modes in it is the same in the editor, the thumbnails, the presenter, every export (PNG, JPG, PDF, GIF, WebM, SVG) and after a reload. The README has the short version for people; this file is for whoever changes it.

## The model

- **One optional field**: `ElementBase.blend?: BlendMode` in `src/core/types.ts`. The fifteen names are the ones that a canvas (`globalCompositeOperation`) and a style sheet (`mix-blend-mode`) share, so nothing is translated anywhere. **Normal is the absence of the field**, never the value `"normal"` (the toolbar deletes the field; the live-editing check refuses `"normal"`).
- **`src/core/blend.ts`** is the only list: `BLEND_MODES` (in the order shown to people, taken from the keys of a `Record<BlendMode, string>` that the compiler keeps complete), `blendLabel`, `isBlendMode` (a `Set`, so `"constructor"` and `"__proto__"` are not modes) and `blendOf(el)`. **Every reader goes through `blendOf`**, which gives the mode of an element or nothing when the field is missing or holds anything else (a hand edited file, another person's browser): the painter, the SVG exporter, the toolbar, ungrouping. That is the whole defence against a value that is not a mode, and it is also why a design with an unknown mode in it simply shows as Normal.
- **The stored format did not change** (`docs/MIGRATIONS.md`, "An optional field is added"): no version, no migration step. `completeDesign()` (`src/test/schema/complete.ts`) has the field, and `src/core/schema/persistedShapes.test.ts` names the two lines it adds to the shape of a design (on elements and on the children of groups) as `BLEND` in `ADDED.design`. An older Craftly that opens a design with modes in it ignores the field and saves it back unchanged.

## How it is painted (`src/render/renderPage.ts`)

`drawElement` skips hidden elements and the ones in `env.hide`, then asks `blendOf(el)`. With no mode it calls `drawFramed` (what `drawElement` always did: save, move to the centre, turn, mirror, opacity, blur, paint by type, restore). With a mode it calls `drawBlended`, which:

1. takes the **layer** for the current level (`env.depth`): a canvas at least as big as the one that is painted;
2. saves the layer's context, clears it in device pixels, and gives it **the transform that the page has at that moment** (`ctx.getTransform()`, before the element's own move and turn), so the element finds its place on the layer as it finds it on the page;
3. raises `env.depth`, calls `drawFramed(layerContext, el, env)` (the element's own opacity and blur happen here, on the layer; a failure while painting is caught there, as ever), lowers `env.depth`, restores the layer's context;
4. saves the page's context, resets its transform, sets `globalCompositeOperation` to the mode and lays the layer over with `drawImage(layer, 0, 0, w, h, 0, 0, w, h)`, then restores. What the page's context has at that moment still applies: **its clip** (the page rectangle, a wipe window of an animation) and **its `globalAlpha`**, which is what comes down from the group the element is in and from an animation (a fade), so the opacity of the element is applied once on the layer and the inherited one once when the layer is laid over, as before.

Properties of the design that matter:

- **A group with a mode is mixed as one.** Its children are painted by `drawElement` on the layer of the group (`depth` 0), as normal elements; the layer is then laid over the page. A child with a mode of its own gets the layer of `depth` 1 and is laid over the layer of the group. A group without a mode is not a layer: a child with a mode mixes with what is under the group, as `<g>` without `opacity` or `filter` does in SVG. (A group's opacity is still applied to each child and not to the group as a whole; that was so before and the SVG exporter does the same.)
- **The layers are a pool by level**, one canvas each, made when first needed. A layer **only grows** (to the biggest canvas painted into so far); a smaller canvas clears and lays over only the part it has (the nine-argument `drawImage`). Otherwise a thumbnail painted between two paints of the page would make the big layer again each time.
- **`releaseLayers()`** sets every layer to 0 x 0 (`releaseCanvas`'s way of freeing the pixels) and forgets them. `renderExportCanvas` calls it when an export is done, because an export can be many times bigger than the editor; the next paint of the editor makes a layer again.
- **Where no layer can be made the element is painted straight**, in Normal, and nothing breaks: no `document`, a canvas that is 0 pixels wide or high (drawing a 0 x 0 canvas is an `InvalidStateError`), a browser that gives no 2D context for the new canvas.
- **Cost** (measured on 2026-11-10 in Chrome on the development machine, in the browser pane with the graphics card and in headless Chrome, which agreed: a page of 60 shapes with fill, border and shadow, painted at 1280 x 720 and at 2560 x 1440, about the size of the editor's canvas at 1x and at 2x). With no mode the page takes 22 ms and 70 ms. Each element with Multiply adds about **0.8 ms at 1280 x 720 and about 3.5 ms at 2560 x 1440** (15 of them: 37 ms and 117 ms; all 60: 68 ms and 281 ms), and a mode that is not made of separate colour channels (Hue) costs about a third more (90 ms and 353 ms for 60). The cost is that of a clear and a laying of a layer as big as the canvas, so it follows the area of the canvas and not the size of the element, and the editor repaints a page on every pointer move while something is dragged. A few elements with a mode are not noticed; dozens on a page with a high-resolution screen are. **The next step, if it matters,** is to clear and lay only the device-pixel bounds of the element, which cuts the cost to the share of the canvas that the element covers (rotation, shadow, blur, text effects and arrowheads reach beyond the box, so those bounds are a piece of work of their own, and a bound that is too small cuts something off).
- **Shadows** are part of the element, so they are mixed too. **Blur** is applied on the layer, by the element's own `filter`.

## How it is exported

- **Raster formats** (PNG, JPG, the pages of a PDF, the frames of GIF and WebM, print, the presenter, thumbnails, template previews) all call `renderPage`, so they agree with the editor by construction. A page too large for one pass is painted in bands through one band canvas; the layers are as big as a band and the blended element is mixed in every band (`raster.dom.test.ts`).
- **SVG** (`src/export/svg.ts`, `element()`): an element with a mode gets `style="mix-blend-mode:<mode>"` on the `<g>` that wraps it, with its `transform`, `filter` and label (the order is `transform`, `filter`, `style`, `role`/`aria-label`, and the group is made even when nothing else needs one); inside a link, the group is inside the `<a>`. A group is a `<g>` with its children, so it mixes as one, as on the canvas. **The value written is always the one of the fifteen that `blendOf` returned** (`mode`), never what the field holds: `svg.test.ts` writes eight kinds of hostile value (a name that closes the attribute, a style after the name, markup, a number...) and checks that nothing of them reaches the file and that the file is still well formed XML. A program that does not know `mix-blend-mode` shows the element as Normal.

## What arrives from outside

- **Live editing** (`src/collab/protocol.ts`, `checkValue`): a property called `blend` must be one of the fifteen (or absent: `null` and `undefined` pass, because JSON leaves out what is not there, and the toolbar sends the removal as `unset: ["blend"]`); a number, a boolean, a list, an object, `"normal"` and any other text are refused with "a blend mode that does not exist". The check runs on every value of a batch and on a design that arrives whole, at any depth, so a mode inside a group is checked too. Both ends use it (the server on what browsers send, the browser on what a server says, `parseServerMsg` and `checkDesign`).
- **Project files and backups** (`src/export/projectFormat.ts`) are not changed: an element passes through as it is, like its other optional fields, and every reader goes through `blendOf`.
- **Diffing** (`src/collab/ops.ts`) is generic over properties, so setting and taking away a mode synchronise with no code of their own (`ops.test.ts` replays both).

## Where else the field is handled

| Place | What it does with `blend` |
| --- | --- |
| Ungroup (`src/core/ops.ts`) | the elements of the group get its mode when they have none of their own (the nearest to how the group looked: they then mix one after the other, where the group mixed as one) |
| Combine (`combinedShape`) | the result has the look of the shape at the back, which includes its mode (it spreads the shape) |
| Duplicate, copy and paste, page copies | `cloneDeep` keeps it |
| Copy style | does **not** carry it (`STYLE_KEYS` has no opacity, shadow or blur either) |
| Layer thumbnails (`LayerThumb.tsx`) | the element is painted on its own as it is, so its mode is left out (transparency, shadow and blur already are): there is nothing under it to mix with, and no layer is made for 28 pixels |
| Text being edited (`TextEditorOverlay.tsx`) | **not carried**, see below |

## Decisions, and why

1. **A layer per element** and not the canvas's mode alone: `globalCompositeOperation` mixes a drawing with what is under it, one drawing operation at a time, so an element made of several operations (a shape with fill, border and shadow; a text with an effect; a group) would be mixed piece by piece and look wrong where its pieces overlap. One layer makes the element one thing, which is what SVG's `mix-blend-mode` on a group means too.
2. **Names, absence, no "pass through".** The field uses the CSS names so that nothing is translated; Normal is absence so a design that never uses blending is byte for byte what it was; and there is no "pass through" mode (Figma's default for groups): a group without a mode already lets its elements mix with what is under it.
3. **The control is in the Transparency popover**, under the slider, and not a button of its own. Every toolbar has Transparency, so every kind of element gets it with no change to the toolbars (the tests that list the buttons did not change), and transparency and mode are two answers to one question, how the element lets what is under it show. The button's tooltip says so ("Transparency and blend mode"); its accessible name stays "Transparency".
4. **The layer grows and is not made smaller**, see above; `releaseLayers` after exports bounds what that can hold.
5. **The text editing box does not mix**, on purpose and after trying: `mix-blend-mode: multiply` on the box has no visible effect, because the page canvas (`.cf-pageview` in `.cf-sticky`, `z-index: 1`) and the box (in `.cf-pageframe`, `z-index: 2`) are in different stacking contexts, so the box has nothing under it to mix with. Moving the box into the stacking context of the canvas means moving the editor's layers around, which was judged too risky for this feature. The text is shown in its own colour while it is edited and mixed again when editing ends (`blend.cjs` records a screenshot of the editing state and checks that the mode survives the edit).
6. **Strict at the door, forgiving at the reader.** The wire check refuses what is not a mode; the readers treat what is not a mode as Normal. A newer Craftly with a sixteenth mode would be refused by an older one over a live link, like any other field the older one does not know, and would show as Normal when it opens the file.

## Known limits and open items

- The editing box (above); Copy style; the cost of many elements with a mode (above).
- **Memory.** The layers are as big as the biggest canvas painted since they were last released. A raster export releases them when it is done; an animated export and the presenter do not, so after one of them (and a page that has an element with a mode) a layer the size of that canvas stays until the page is closed or the next raster export. It is one canvas per level of blended elements inside each other, normally one.
- A blurred group with an element that has a mode **and** a blur of its own is blurred twice (once on the layer, once by the group's filter when the layer is laid over); an element with a mode and no blur of its own in a blurred group is blurred once, as without a mode. Rare enough to leave.
- A GIF has 256 colours, so a mode that makes smooth gradients (Soft light over a photograph) bands more than on screen.
- Checked in Chrome only; the modes are in every current browser's canvas and CSS, but nothing here ran in Firefox or Safari.
- Not done: a blend mode for the page background or for a single fill or shadow, a shortcut, a mark in the Layers panel for an element that has a mode, "knockout" and "isolate" options, and a mode for the page's elements as a whole.

## Tests and checks

- **Painter** (`src/render/blend.dom.test.ts`, 39 tests; jsdom has no real compositing, so they read the calls: which canvas was painted, with which transform, alpha and operation): no layer without a mode (and for `"normal"`, `"source-over"`, a style after a name, a number); each of the fifteen modes laid over as itself, once, at the identity transform, inside the page's clip; the same path, place and turn on the layer as straight on the page (rotation, mirror, scale 1.5); the transform and clip of a zoomed page; opacity split between the layer and the laying; a fade and a wipe; hidden and edited elements; one layer cleared and balanced for two elements; a failure while painting; groups (one layer, a second level, a child mixing through a plain group); growing and never shrinking; release; no size, no document, no context.
- **132 new tests in all** (7,561 before, 7,693 after), written first and seen to fail for the right reason: the missing module, the refusals that did not happen, the group that kept no mode, the two new lines of the stored shape.
- **Others:** `blend.test.ts` (36: the list, labels, `isBlendMode`, `blendOf`), `svg.test.ts` (the group, its attributes and order, groups, links, hostile values), `protocol.test.ts` (accepted and refused, in a batch and in a design), `ops.test.ts` (ungroup), `combine.test.ts`, `collab/ops.test.ts` (sync of setting and removing), `common.test.tsx` (the box: Normal, the list, mixed, undo, the label, the tooltip), `LayersTab.test.tsx` (thumbnail), `raster.dom.test.ts` (single pass, bands, release), `persistedShapes.test.ts` (the named lines).
- **Browser** (`e2e/blend.cjs`, 20 checks, dev server and production build under the Content-Security-Policy): everything above that needs real pixels. All fifteen modes are drawn in fifteen pairs of shapes (a backdrop and a shape in each mode) and read at three points each, against the formulas of the W3C compositing standard that the journey carries, **on the page, in the downloaded PNG and in the downloaded SVG** drawn by the browser (within 4, 5 and 8 levels).
- **Deliberate breaks:** 50 one-line breaks of the code on a clean copy, one at a time, with the tests that should notice them (`scratchpad/mutate-blend.cjs`): 49 caught, 1 that changes nothing (the SVG writing `el.blend` where it writes `mode`: they are the same value whenever the group is made).

## Gotchas

- The journey reads pixels from a screenshot of the page with nothing selected (`actions.clearSelection()` first, which also ends text editing: it cannot read the editing state, so that is a screenshot for a person).
- In Chrome `input.select()` also **focuses** the input, and `NumberField` selects its text one frame after it gets the focus: a script that presses Tab every few milliseconds sees the focus come back to the number field. The journey waits 80 ms between key presses, as a person is slower than a frame.
- A clean copy of the project whose `node_modules/jsdom` lost a file (`xhr-sync-worker.js`) makes every jsdom test fail to start; a break check that counted "no tests ran" as caught said so for 33 breaks before this was noticed. The script now counts a run as a catch only when a test ran and failed.

## Adding a mode

Add the name to `BlendMode` (`types.ts`) and to `LABELS` in `blend.ts` (the compiler stops until both are done; put it where it belongs in the list), add its name to `MODES` and its formula to `blend.cjs`, and to the lists in `blend.test.ts`, `common.test.tsx` (the list of options) and `svg.test.ts` if they are written out. Check that a canvas and a style sheet know the name. A mode that one of them lacks cannot be added with the one-name rule: it needs a name for each and a translation in the painter and in the exporter.
