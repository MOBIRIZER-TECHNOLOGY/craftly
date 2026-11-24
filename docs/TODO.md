# What is still missing next to Canva, and has not been built

Written 2026-11-23, after [`reports/Craftly versus Canva feature gaps.md`](../reports/Craftly%20versus%20Canva%20feature%20gaps.md) was checked against the code. That report says what Canva has and where Craftly stands; this page is the list of work that follows from it, in the order I would do it. Sizes are my judgement from reading the code, not measured: **S** is days, **M** is one to four weeks, **L** is more than a month.

Tick a line when it ships, and move the feature's row in the report.

## Done from this list

- [x] **Bulk create**, text and table cells (2026-11-23): `src/core/bulk.ts`, Apps > Bulk create, [README](../README.md#bulk-create).
- [x] **Check accessibility**: contrast of text and alternative text of pictures (2026-11-23): File > Check accessibility.
- [x] **Presenter: a clock and a pointer** (2026-11-23): in Present, the clock in the controls and `L`.
- [x] **A frame shape for a picture on the page** (2026-11-23): Frame shape in the image toolbar.
- [x] **Margins** that elements snap to (2026-11-23): File > Rulers and guides > Show margins.
- [x] **Shape options**: sides, points, inner size, lobes, hole (2026-11-23): the shape toolbar.
- [x] **Every weight of a font** (2026-11-23): Weight in the Font panel.
- [x] **Spell-check as a choice** (2026-11-23): File > Check spelling while typing.
- [x] **A link on any element** (2026-11-23): Link in the right-click menu.
- [x] **Crop to a fixed shape** (2026-11-23): the crop toolbar's Shape of the crop menu.
- [x] **Charts**: stacked bars and columns, and titles along the axes (2026-11-23): Data panel > Stack the series, Axis titles.
- [x] **PPTX export**, every page as one picture, with speaker notes on request (2026-11-23): `src/export/pptx.ts`, Share > Download > PowerPoint (PPTX), journey `e2e/pptx.cjs`. Not opened in PowerPoint yet.
- [x] **QR code with a logo** (2026-11-24): Apps > QR code > Logo (optional); the logo and code become a PNG, while a code without a logo stays a vector graphic.
- [x] **Link shortcut** (2026-11-24): `Ctrl+K` opens the link dialog for one unlocked selected element.
- [x] **Custom margins** (2026-11-24): File > Settings > Margin size, persisted on the design and used for drawing and snapping.
- [x] **Editing inside a group** (2026-11-24): double-click to enter, select and transform children, nested groups, and group bounds that follow edits.
- [x] **Connector routes and drawing** (2026-11-24): straight, elbow and curved routes, labels, and attached lines drawn by dragging from a shape's hover anchors.
- [x] **Tables: merged cells, per-cell styles and on-page typing** (2026-11-24): merged rectangles, fill/text/bold/alignment per cell, and direct cell editing with keyboard navigation.
- [x] **Smart resize** (2026-11-24): Resize > Smart resize repositions content by relative page centers and shrinks only oversized elements.
- [x] **Presenter second window** (2026-11-24): current notes and next-page preview synchronized over a broadcast channel, with previous/next controls.
- [x] **Web-page and PowerPoint links** (2026-11-24): safe link hotspots in HTML downloads and external hyperlink relationships on native PPTX objects.
- [x] **PPTX editable objects and transitions** (2026-11-24): plain text boxes and solid rectangles become native editable PowerPoint objects; other content stays in the background picture. Page transitions are exported.
- [x] **Charts: scatter, combined bar/line, 100% stacking and stacked areas** (2026-11-24): available in the Data panel, canvas and SVG exports.
- [x] **Frames from every catalogue shape and Pen paths** (2026-11-24): Frame shape lists the full catalogue; a path can become a custom picture frame.
- [x] **Grid snapping and equal-spacing guides** (2026-11-24): Settings > Snap to grid and Grid size; repeated gaps become snap targets.
- [x] **Named palettes and link badges** (2026-11-24): all 40 palettes are in the shared colour picker; selected linked elements show a link badge.
- [x] **Crop straightening** (2026-11-24): the crop toolbar rotates the picture inside its frame.
- [x] **Additional photo adjustments** (2026-11-24): highlights, shadows, sharpen, tint, curves, levels and Auto enhance.
- [x] **Bulk image columns and batches** (2026-11-24): map images to spreadsheet columns, match uploaded asset names, and create up to 1,000 rows in batches of 50.
- [x] **PPTX import, basic** (2026-11-24): Import project file accepts `.pptx`, reads the slide size, text boxes, pictures and rectangles, and opens the saved design. Tested by downloading and reopening a PPTX in the browser; PowerPoint, Keynote and Google Slides still need a person.
- [x] **Bulk create: a standalone design for each row** (2026-11-24): Apps > Bulk create > Designs saves an independent, single-page project for every row, including image-column substitution, and offers to open the first. Tested in the browser.
- [x] **More native PowerPoint shapes** (2026-11-24): common basic shapes, polygons, stars, arrows and symbols become editable PPTX objects with solid fills and strokes. Rounded corners and star inner sizes are exported. A browser-downloaded PPTX was inspected for native ellipse geometry and editable text; complex custom paths still use the background picture.

## 1. Can be built here with no new dependency

Nothing in this section needs a new package, a model file, an outside service or licensed content. Each can be written and tested with the unit tests and the browser journeys in `e2e/`.

### New features (rows the report calls Missing)

- [ ] **PPTX export, the rest** (M). Text boxes, common shapes, links and transitions are native editable objects. Irregular/custom shapes and lines still use the background picture; the files still need opening in PowerPoint, Keynote and Google Slides (section 3).
- [ ] **Mockups** (M). A design drawn into a scene (a screen, a poster on a wall, a card) with a perspective transform. The scenes have to be drawn procedurally, as the "stock photos" are, because there is no licensed photography.
- [ ] **A video element** (L, first step M). Upload a clip, trim it, set its speed, play it on the page and in the presenter, and record it through the existing real-time export. The document model has 8 element types and none is media, so this is a change of the stored format: follow [`MIGRATIONS.md`](MIGRATIONS.md). A timeline with several tracks and an offline MP4 export come after and are the largest item on this page (the report's video section estimates 12 to 14 weeks for an MVP).
- [ ] **An audio element** (M). Upload, trim, volume, fades, and the sound mixed into the recorded video. Needs the same format change as video. A music library is in section 2.
- [ ] **Camera, microphone and screen recording** (S to M, after the video element). The browser's own `getUserMedia`, `getDisplayMedia` and `MediaRecorder`. `public/_headers` sets `Permissions-Policy: camera=(), microphone=()`, which has to change, and that is a decision about what the site may ask for. Chrome's fake devices make it testable in a journey; a real camera needs a person.
- [ ] **Captions by hand** (S to M, after the video element). Typed captions, `.srt` import, styles. Automatic captions are in section 2.
- [ ] **Right-to-left and mixed-direction text** (L). The Unicode bidirectional algorithm and line breaking in `src/render/textLayout.ts`, the caret and selection in the text editor, and the text layer of the PDF. Fonts for other scripts are in section 2.
- [ ] **A heal and clone brush** (M). Classical, without a model: paints over a spot from its surroundings. It is not Canva's Magic Eraser, which is in section 2. Needs the brush-and-mask interface that an eraser model would reuse.
- [ ] **A plug-in API** (L). Apps in a sandboxed frame that talk to the editor through messages, over the store's actions. With it, a tool interface that an outside agent can drive. A marketplace is in section 2.
- [ ] **Publish a view-only page on your own server** (M). The live server already keeps shared designs; a public page of one would be the self-hosted answer to Canva's websites. Domains, scheduling and print ordering are in section 2.
- [ ] **A whiteboard** (L). A canvas without a fixed page, with sticky notes. Docs, Sheets and Websites are products of their own and are not planned.

### Missing parts of features that exist (rows the report calls Partial)

- [ ] A weight for selected characters, where it is the whole text box now (M).
- [ ] Brand: more than one kit, brand templates (M). Approvals and locked controls need the account server (M).
- [ ] PDF: pages as vector drawings with embedded fonts, tags, and alternative text (L).
- [ ] MP4 export of the animations in every browser, not recorded as it plays: an MP4 writer of our own on the browser's `VideoEncoder` (M).
- [ ] Working together: a commenter role, mentions, merging text that two people type at once (M; planned in [`COLLABORATION.md`](COLLABORATION.md)).
- [ ] Accessibility of a design: the contrast of a text over a picture or a gradient, read from the painted pixels (M); a reading order that can be set, and tags in the PDF that carry it (L). The check of plain colours and of alternative text is done.

## 2. Cannot be built without something from outside

Each of these needs a new package, a model file, an outside service, licensed content, or a decision that is not mine to take.

| Feature | What it needs |
| --- | --- |
| Magic Eraser and click-to-select (Magic Grab) | Model files (MI-GAN or LaMa, EdgeTAM or SlimSAM) and a ruling on the MI-GAN weights licence; see the report's image-editing section |
| Automatic captions | A speech model (Whisper weights) |
| Image generation, generative edit and expand | Model weights of 2.6 GB and more, or a generation server on the user's machine that somebody has to install before the adapter can be tested |
| Magic Write, Translate, an assistant | A language model: a paid service with a key, or weights |
| Video, music and voice generation | Large models or a paid service |
| Magic Layers | No open model was found |
| PDF import | A PDF parser and renderer (pdf.js is a new dependency; writing one is not realistic) |
| Fonts for scripts other than Latin | New Fontsource packages, and a licence check for each |
| Real stock photos, a music library, templates in Canva's numbers | Licensed content |
| CMYK with colour management | An ICC profile file and its licence |
| An app marketplace, hosted publishing with domains, social scheduling, print ordering, a hosted Craftly | Services that somebody runs and pays for |
| Native apps for phones and the desktop | Developer accounts, code signing, store review |

## 3. Needs a person, whatever is built

- A real phone and tablet, Safari on a Mac, a real camera and microphone, a real screen reader: none was used so far.
- Opening an exported PPTX in PowerPoint, and a print PDF at a print shop.
- Judging how a result looks: a mockup, a healed photo, a re-laid-out page.
- Review, and every commit, push and release.
