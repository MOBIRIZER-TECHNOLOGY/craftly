# Craftly: what to improve next, and how to add AI

Written 2026-11-05, after the test-coverage push, from the code, the test suite and measurements on a production build; the figures, the shipped rows and the open items were brought up to date on 2026-11-07. A feature-by-feature comparison with Canva, and the research behind it (image editing, local image generation, video, other AI features, the competitors), is in [`reports/Craftly versus Canva feature gaps.md`](../reports/Craftly%20versus%20Canva%20feature%20gaps.md). Three labels are used: **measured** (I ran it), **read** (I found it in the code) and **estimate** (my judgement: check it before you plan around it).

## 0. How I read the request

The message began mid-sentence ("ellipse and proper read file and other things"), so I took it as four asks: the **ellipse** shape, a **proper README** and the other files a real project needs, **other things** that stand between this app and a production-grade one, and **AI features** that would make it world-class. If "ellipse" meant something else (a bug you saw?), tell me and I will look again.

What I could not do on 2026-11-05: run Lighthouse or axe (not installed, and installing them was not permitted in this session), test Safari or Firefox, test a real phone, or test over a slow network. axe-core 4.14.0 was run on 2026-11-07 ([`ACCESSIBILITY.md`](ACCESSIBILITY.md)); Lighthouse, Safari, Firefox, a real phone and a slow network are still untried. Section 3 lists those as work to do.

## 1. Where Craftly stands today

| Area | Fact |
| --- | --- |
| Size (read) | 342 source files, 63,000 lines of TypeScript/TSX, 14,500 lines of CSS; 279 test files, 71,000 lines |
| Dependencies (read) | Eight runtime packages (react, react-dom, zustand, immer, lucide, lucide-react, qrcode-generator, onnxruntime-web, which has six dependencies of its own) plus 44 font packages. No analytics, no tracking, no backend. The only network use is fetching image URLs while exporting SVG and, after the person agrees, downloading an AI model |
| Tests (measured) | 6,121 tests, 99.4 % statements / 97.1 % branches / 99.7 % functions / 99.9 % lines; `npm run coverage` fails below 95 %; the whole suite also passed while the CPUs were kept busy (before the on-device AI work; the 558 tests of the 21 files of that work passed the same way after it); 115 browser checks pass (109 on the dev server, 111 on a production build, since a few belong to one or the other) |
| Build (measured) | Strict TypeScript. 5.0 MB total: 2.1 MB JavaScript in 92 chunks, 2.1 MB fonts in 70 files, 0.2 MB CSS (the 28.7 MB ONNX runtime file is not part of it: it is fetched when a photo tool is first used). Largest chunks (gzip): Editor 144 KB, lucide icons 111 KB (loaded only when the icon panel opens), two `index` chunks 81 and 77 KB, `designTypes` 73 KB, the ONNX Runtime loader 39 KB (loaded only when a photo tool runs). Installable PWA that works offline (service worker stores 184 files) |
| Speed (measured, headless Chrome on a fast desktop, local server) | Dashboard ready in 0.5 s. Editor open in 1.9 s after clicking "Presentation". JavaScript heap about 14 MB with 300 elements. **Editing** (one element nudged every frame) holds 60 fps with 300 and with 1,000 elements, even with the CPU slowed 6 times. **Zooming** repaints everything: 300 elements stay at 60 fps at full speed, drop to 30-60 fps with the CPU 4-6 times slower; 1,000 elements run at 30 fps at 4 times slower and 15 fps at 6 times slower |
| Accessibility (axe-core 4.14.0 on 47 screens, a keyboard walk, dialogs and menus, pixels behind the text, then a pixel scan of the same screens after the colour and size changes: [`ACCESSIBILITY.md`](ACCESSIBILITY.md)) | before the audit: 10 axe rules reported something (one critical) and the first Tab from the page landed nowhere; after the keyboard and label fixes 4 (13 + 13 + 1 + 3 elements: grey and top bar text contrast, one 22 px button, cards axe reads strictly, menus outside landmarks); after the colour and size changes (axe was not run again) the scan finds 8 of the 30 short lines of text left, none of them a defect, the dashboard headline at 3.73:1 (was 2.77) and no target under 24 px with another close by except a design card's title link, which has an equivalent control (and, in some runs, the Text tab's Edit link); the outline of every kind of text field is 3.2:1 on white (was 1.5; the dashboard search on its gradient is 2.5:1); 46 keyboard stops in the editor, all with a visible focus indicator; every dialog traps focus, closes with Esc and gives focus back; the dashboard reflows at 320 px, the editor works at 200 % zoom and not at 400 %. No real screen reader was used |
| Privacy (read) | The About dialog promises that designs and photos stay on the device and, since the first on-device AI tool, names the one exception (each model downloaded once, with permission). It has to be rewritten again the day an AI feature can send data out |

## 2. What you named

### 2.1 Ellipse

What is there (read): the shape with id `ellipse` draws a true ellipse (`src/render/shapePaths.ts`, width and height are independent), dragging with the shape tool gives an ellipse (Shift now gives a circle, after a bug fixed during the test work), photo masks and frames accept `ellipse`, and SVG export writes `<ellipse>`.

What was missing before 2026-11-05 (the first bullet is done, see below):

- It is **named "Circle"** everywhere (Elements > Shapes and the shortcuts dialog, where `C` is listed as Circle). There is no entry called Ellipse or Oval, and a search for "oval" finds no shape (the shape search looks at name, group and id, so only "ellipse" works).
- Nothing tells a user that the circle can be stretched, and nothing makes it easy to get a true circle back (hold Shift while dragging, or type equal width and height).
- No arc, pie or donut with angle handles.

**Done (2026-11-05):** the catalogue now has an **Ellipse** entry (3:2) right after **Circle**; both draw the same `ellipse` shape, so saved designs are unaffected. The shape search also answers to *oval*, *elliptical*, *round* (the circle) and *rectangle* (the square and the rounded square). Tests cover the preset, its place in the panel, its thumbnail and the search words.

**Still open:** a snap back to a true circle while resizing (width and height within 2 px), a frame with an oval mask, and an Arc / Pie / Donut shape with angle handles.

### 2.2 README and project files

The README was good on features, commands, architecture and shortcuts, and lacked what someone landing on the repository needs next.

**Done (2026-11-05):**

- The README has screenshots, a "why", a short tour, a browser support table, a deploy guide (static hosting, sub-folder builds, caching and security headers), a privacy and data section, credits and licences, and an updated known-limitations list.
- `THIRD-PARTY-NOTICES.md`, generated by `npm run notices` (70 packages, with licence texts).
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `.editorconfig`, `.nvmrc` and Node `engines` in `package.json`.
- `.github/`: a CI workflow (type-check, `npm run coverage`, build, browser checks in Chrome), Dependabot, an issue template for bugs and one for features, a pull request template. The workflow files parse as valid YAML but have **not run on GitHub yet**: the project is in a local git repository (first commit on 2026-11-07) that has not been pushed.

**Still open:**

| Missing | Why it matters | Effort |
| --- | --- | --- |
| `CODE_OF_CONDUCT.md` | Expected once you accept outside contributors; it needs a contact address for reports | 15 minutes with that address |
| Browser support table beyond Chrome | The table says Firefox and Safari are untested | with the cross-browser work (P1, item 10) |

The README lists the four on-device photo tools and says that image generation, video clips and audio are not there; those sentences change again when a language or generative feature arrives.

### 2.3 "Other things"

Sections 3 and 4 are that list, in priority order.

## 3. Production readiness, in priority order

### P0: before anyone outside your team uses it

| # | Gap | Evidence | What to do |
| --- | --- | --- | --- |
| 1 | Licence | **Done:** MIT, chosen 2026-11-05 (`LICENSE`, `package.json`); notices for fonts and packages are generated (`npm run notices`) | Put your own name in the copyright line if you do not want "Craftly contributors" |
| 2 | CI written but never run | `.github/workflows/ci.yml` and Dependabot exist; the project is in a local git repository that has not been pushed to GitHub yet (read) | Put the project on GitHub, watch the first run, fix what differs on Linux; add a bundle-size budget (lint is in the workflow already) |
| 3 | Linter and formatter | **Linter done (2026-11-07):** ESLint 10 with typescript-eslint, the React hooks rules and jsx-a11y (`eslint.config.js`), run by CI with no warning allowed. The first run found 123 errors in 673 files (unused imports and constants, assignments that were never read, a comment that began with `global` and was read as a directive, and accessibility patterns that are deliberate); all are fixed, or marked at the place with their reason. **Formatter done (2026-11-07):** Prettier (`.prettierrc.json`, `npm run format`) was applied to about 300 of 600 code files, with no change in how they behave, and CI runs `format:check`; stylesheets, documents and `src/data` are laid out by hand and skipped | Type-aware rules such as `no-floating-promises` are the next step for the linter |
| 4 | Content-Security-Policy and hosting headers | **Mostly done (2026-11-07):** every browser journey, the offline one included, passes against a production build with a policy enforced (measured: it needs `'wasm-unsafe-eval'` for the ONNX runtime, `data:` fonts because the build inlines the small font files into the CSS, and `'unsafe-inline'` for styles because of the print frame's style block). The policy and the other headers are in the README, and `public/_headers` (Netlify, Cloudflare Pages) holds them with the policy commented out. The download of a model from Hugging Face was not one of the journeys | Try a model download behind the policy and switch it on; a `vercel.json` or an nginx snippet for those hosts; `connect-src` for an AI proxy once one exists |
| 5 | Saved designs live only in this browser's storage | IndexedDB only; the persistence request sits in the About dialog (read) | A visible "Back up all designs" and "Restore" (`.craftly` files exist already), ask for persistent storage at the first save, optional autosave to a chosen file (File System Access API), a quota warning. Cloud sync needs a backend (P2) |
| 6 | No crash reporting | an error boundary exists; no global `unhandledrejection` handler; no reporting (read) | Opt-in error reporting with a clear privacy line, plus a "recover the last autosave" path after a crash |
| 7 | Service worker swaps code under an open tab | `skipWaiting` + `clients.claim`, no "new version" prompt (read) | Show a "Reload for the new version" toast; never replace a running editor silently; keep the old assets until the tab closes |
| 8 | Database and file migrations are untested paths | `DB_VERSION = 1`, design `version: 1`, project format 1 with a "newer file" error (read) | Write the migration framework and tests *before* the first change to a schema, because you cannot break a user's saved designs |

### P1: before you call it reliable

| # | Gap | Evidence | What to do |
| --- | --- | --- | --- |
| 9 | Touch screens | `touch-action: none` on the canvas, no pinch-zoom or two-finger pan code, only Ctrl+wheel zoom (read) | Pointer-event gestures: pinch to zoom, two-finger pan, long-press menu; bigger hit areas; test on a real iPad and phone |
| 10 | Only Chrome has been tried | README says so | Add Firefox and WebKit to the browser checks; verify `MediaRecorder` (WebM), `OffscreenCanvas`, the Fonts API and Safari's canvas limits; offer fallbacks or hide what a browser cannot do |
| 11 | Non-Latin text | the bundled fonts are Latin files (68 Latin, 1 Latin-Extended, 1 Vietnamese, no Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai or CJK) (measured from the build) | Subsets per script loaded on demand (Noto families), right-to-left layout in `textLayout.ts`, and embedding in PDF/SVG export. This decides whether the app is usable outside Western languages |
| 12 | Interface is English only | strings are written in the components; `toLocaleString("en-US")` is fixed in the Download panel (read) | Pick an i18n library, move strings to message files, locale-aware numbers and dates, test a long-text language (German) and a right-to-left one |
| 13 | Zoom repaints everything | measured above | While zooming or panning, scale the last frame as a bitmap and repaint once the gesture settles; keep a tile or layer cache; consider rendering in a Worker with `OffscreenCanvas` |
| 14 | GIF and WebM are encoded on the main thread | README limitation (read) | Move the encoders into a Worker so the tab stays responsive during export |
| 15 | PDF is images only | the writer embeds one JPEG per page (read) | Vector PDF with real text for sharp print, selectable text and smaller files; bleed and crop marks for printers; CMYK as a longer-term item |
| 16 | Accessibility was audited with axe-core and by keyboard, not with a screen reader | the audit fixed the keyboard, landmark, colour and size problems; what is left needs a screen reader and a real device | Run axe in CI (not yet a dependency); forced-colors (Windows high contrast) styles, there are none; a screen-reader pass (NVDA, VoiceOver); an outline of the objects on the page for non-visual users (the canvas is invisible to them; the Layers tab is the start) |
| 17 | Bundle and start-up | `designTypes` chunk is 197 KB and `Editor` 435 KB raw (KiB, from the build of 2026-11-07); no size budget | Run a bundle analyser, split what the dashboard does not need, set budgets in CI |

### P2: what turns it from an app into a product

| # | Gap | Notes |
| --- | --- | --- |
| 18 | Real content | Photos are procedural (44), templates are 72, fonts 44. Users compare with libraries of thousands. Integrate licensed stock (Unsplash, Pexels and similar, with attribution), Google Fonts on demand (OFL), and a steady template pipeline |
| 19 | Accounts, cloud sync, sharing links, comments, real-time co-editing | Needs a backend and a sync model (a CRDT such as Yjs fits a JSON document). Hash routes (`#/design/id`) would become real URLs |
| 20 | Brand controls for teams | Locked elements, brand templates, approvals, shared kits |
| 21 | Video and audio | A timeline, clips and sound are outside the current animation model |
| 22 | Extensibility | A small plugin API or an embed SDK |
| 23 | Product analytics (opt-in) | Needed to learn what people use; keep it privacy-first |

## 4. What world-class means for this app

Measured against the product people will compare you with, the order of impact is: **content** (18), **reliability on every device** (9, 10), **global text** (11, 12), **collaboration and accounts** (19), **print quality** (15), and **AI that saves time on real tasks** (section 5). Craftly's strengths to build on: a clean JSON document, a single renderer shared by editor, thumbnails and export, strong tests, offline-first and no account. A privacy-first story ("your designs stay on your device; AI is optional and visible") is a real differentiator against cloud-only tools.

## 5. AI features

### 5.1 Principles

1. **AI edits the document the way a user does**: through the store's actions, inside one transaction, so a single Undo takes the whole change back.
2. **Off until the user turns it on.** The About dialog's promise stays true by default and is amended when AI is enabled: what is sent, to whom, and for what.
3. **The model sees a compact digest of what the user chose to share**, never the library or other designs.
4. **The app still works with no AI and no network.** AI buttons say why they are unavailable.
5. **Every AI feature ships with a fake provider in the tests and a score on an evaluation set**, the way the rest of the app now has coverage.

### 5.2 Why this code base is a good fit (read)

- The document is **plain JSON with a typed schema** (`src/core/types.ts`): text, shape, line, image, graphic, group, table and chart elements, pages, animations, a brand kit.
- The store exposes **79 actions** (`EditorActions`, the two transaction calls among them) and **transactions** (`beginTransaction` / `endTransaction`), which is exactly the surface an AI tool layer wraps.
- `measureTextElement` lets generated text be **fitted** to its box; `renderPageToCanvas` can produce a **PNG** of the result for a vision check.
- There is something to **retrieve from**: 72 templates with tags, three graphics catalogues, 2,000+ icons, 44 fonts, palettes, animation presets.
- The jsdom test harness can run any UI flow, so an AI flow can be tested **without a network** by swapping in a fake provider.

What is missing: a network layer and settings (provider, consent, key), streaming UI for partial results, a semantic index of the catalogues, and a quality-evaluation set.

### 5.3 Where the model runs

| Option | How | Good | Bad | Use it for |
| --- | --- | --- | --- | --- |
| **A. On the device** | Models that run in the browser (ONNX or WebGPU through a library such as Transformers.js); the browser's own on-device text APIs where a Chrome version offers them | Private, free per use, works offline | Downloads of tens of MB (more for generative models), slower on weak devices, lower quality than frontier models, model licences differ: check each one | Cut-out of backgrounds, search, captions, alt text |
| **B. Bring your own key** | The user pastes their Anthropic API key; the browser calls the API directly | No backend; can ship in days | The key sits in the user's browser and is visible to anything running in the page; the official SDK refuses to run in a browser unless you opt in for that reason; not for the general public | A developer or power-user preview |
| **C. Thin hosted proxy** | A small serverless function keeps the key, checks a per-device token and quota, forwards to the API | Key stays secret; you can meter and block abuse; small to run | You now run a service: cost, uptime, abuse handling, a privacy policy | The public launch of language features |
| **D. Full platform** | Accounts, billing, cloud storage, sync, collaboration | A business model | A team's worth of product, legal and operations work | Only if you want to run Craftly as a service |

**Recommendation:** A and B first (no backend, proves the value), C for a public launch, D only as a deliberate business decision.

### 5.4 The feature list, best value first

| # | Feature | What the user gets | How | Needs a server? | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | **Design assistant** | A chat panel: "make the title bigger", "use my brand colours", "add a call to action", "apply this to every page" | A language model with tools that call the store's actions (5.5) | Yes (B or C) | Medium |
| 2 | **Text to design** | Describe an invitation or a pitch deck; get a first draft in the chosen size and brand | Retrieve the best templates (feature 6), let the model rewrite text, colours and images inside them, then run the same tool layer and a render-and-check pass | Yes | Medium to large |
| 3 | **Write and rewrite** | In the text toolbar: shorten, expand, change tone, fix grammar, translate, suggest headlines | A small, fast model; where the browser offers an on-device Writer / Rewriter / Translator API use it first | Optional | Small |
| 4 | **Animation suggestions** | "Animate this page": entrances, timing and transitions chosen for the content | The model picks from the existing presets (`setAnimation`, `setPageTransition`); a unique fit with what you already built | Yes | Small |
| 5 | **Remove background** | One click on a photo | A segmentation model in the browser; keep the result as a new asset. *Shipped on 2026-11-05 (ISNet general-use): see [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md).* | No | Medium |
| 6 | **Semantic search** | "cozy autumn bake sale" finds templates, graphics and photos by meaning | Embeddings for the catalogues computed at build time; embed only the query in the browser | No | Small to medium |
| 7 | **Alt text and accessibility check** | Suggested descriptions for images; warnings for low contrast, tiny text, missing alt text, reading order | A vision model or a captioning model for descriptions; **contrast and size checks need no AI at all** | Optional | Small |
| 8 | **Resize with re-layout** | Turn a post into a story or a slide without redoing it | Rule-based re-layout first (`resizeDesign` already scales), a model for the hard cases | Optional | Medium |
| 9 | **Brand kit from a logo or a website** | Colours, fonts and tone proposed | Colour extraction is classic image maths; the model names and orders them | Optional | Small |
| 10 | **Beautify** | Fix spacing, alignment, hierarchy on the current page | Rules plus a critique pass with a rendered picture | Yes | Medium |
| 11 | **Data to chart** | Paste a table; get the right chart and labels | A model proposes the chart type and the mapping to the existing chart element | Optional | Small |
| 12 | **Outline to deck** | Paste notes; get slides with speaker notes | Same machinery as feature 2, page by page | Yes | Medium |
| 13 | **Translate the design** | Keep the layout, change the language | A model, plus font fallback for other scripts (needs P1 item 11) | Yes | Medium |
| 14 | **Image generation and edit** | Generate or extend a picture | Claude does not generate images; pick an image provider (cost, licence, moderation, labelling) | Yes | Large |
| 15 | **Upscale / enhance** | Sharper uploads | A super-resolution model in the browser. *Shipped on 2026-11-06 (Real-ESRGAN general x4 v3): see [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md).* | No | Medium |
| 16 | **Blur background** | Keep the subject sharp and blur what is behind it | The remover's mask and a blur worked out in the page from the background's own pixels. *Shipped on 2026-11-06: see [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md).* | No | Small |
| 17 | **Colour pop** | Keep the subject in colour and take the colour out of what is behind it | The remover's mask and the grey of the Filters panel's black and white, worked out in the page. *Shipped on 2026-11-06: see [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md).* | No | Small |

Start with 3, 6 and 7 (cheap, visible, safe; 5 is done), then 1 and 4, then 2.

### 5.5 The assistant in detail

**Tools** (all with strict schemas; each validated and clamped to the page, then applied inside one `beginTransaction`):

```
add_text        { text, x, y, width?, fontSize?, fontFamily?, color?, align?, bold? }
add_shape       { shape, x, y, width, height, fill?, radius? }
add_image       { assetId | query, x, y, width, height?, fit? }
update_element  { id, patch }                 patch limited to a whitelist of fields
delete_elements / align / group / reorder     { ids, ... }
set_background  { color | gradient | patternId }
apply_template  { slug, mode: "replace" | "add" }
set_animation   { target: id | page, preset, duration, delay }
search_assets   { kind: "template" | "graphic" | "icon" | "photo", query, limit }
```

**What the model sees:** a digest of the active page (size, background, and one short line per element: id, type, box, text, size, colour), the selection, the brand kit, the design type, and the last few chat turns: roughly 15-25 tokens per element, so a 40-element page is about 1,000 tokens. The big stable part (tool definitions and instructions) is cached. A picture of the page is added only for a critique pass.

**Loop:** the model answers with tool calls; the app validates and applies them, returns results (or errors with a reason), and repeats until the model says it is done; a cap on turns and on elements per turn; a Cancel button; each applied turn is one Undo step. Large `add_*` calls can stream (`eager_input_streaming`), so elements appear while the model is still writing; validate each one before applying.

**Models:** the Anthropic SDK in TypeScript. `claude-opus-5-5` is the default I would start with for the assistant and text-to-design, because tool use over long structured output is where model quality shows. `claude-sonnet-5-5` and `claude-haiku-5-5` are cheaper and faster (5.8): that trade is yours to make **after** the evaluation set (5.7) shows the quality holds, not before. Forced tool choice is not available on the newer models, so the loop uses automatic tool choice with strict schemas. Always check for a `refusal` stop reason and show a plain message.

### 5.6 Safety, privacy and law

- **Data minimisation:** send the digest and the selection, not the library; strip file names and object URLs; show what was sent ("View what will be shared").
- **Prompt injection:** text on a page, imported `.craftly` files and OCR output are *data*. The tool layer can only edit the document (no network, no files, no navigation), which bounds the damage; cap the number of calls; never run model-written script; render model-written SVG only through `<img>` and run it through the existing `sanitizeInline`.
- **Keys and abuse:** in option C the key lives only on the proxy; per-device tokens, a bot check, daily quotas, a kill switch.
- **Disclosure and rights:** label AI-generated images, keep provenance metadata where the provider supports it, and check the licence of every model and dataset you ship or call. Requirements differ by region (transparency for generated content, children's data, GDPR): get advice before a public launch.
- **Trust:** update the About dialog, the README and a short privacy page; AI stays off until the user opts in, and "turn off and delete my AI settings" is one click.

### 5.7 Testing and evaluation

- **Unit and UI tests** with a fake provider that returns canned tool calls (the harness already supports this style), including failure, refusal, cancel and timeout paths.
- **Contract tests** for every tool schema (valid, invalid, hostile input).
- **An evaluation set** of 50-100 prompts per feature with fixed inputs, rendered to PNG in Chromium and scored by automatic checks (text overflow, overlap, contrast of at least 4.5:1, minimum font size, margins, element count) plus a model judge and a human spot check. Run it on every prompt or model change, and nightly against the real API with a spending cap.
- **Cost and latency budgets** per feature, tracked from the `usage` numbers the API returns.

### 5.8 What it costs (estimates; replace them with measured `usage` numbers)

Prices below are per million tokens from the reference I loaded today (cached 2026-10-06): check current pricing before you budget. `claude-opus-5-5` is $4 input / $20 output, `claude-sonnet-5-5` $2 / $10, `claude-haiku-5-5` $0.10 / $0.50, and cached input is read at a small fraction of the input price (a tenth or less). Output includes the model's thinking, which a lower `effort` setting cuts.

| Action | Tokens (estimate) | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
| --- | --- | --- | --- | --- |
| Rewrite one headline | 0.5k in, 0.1k out | about $0.004 | about $0.002 | under $0.001 |
| One assistant turn | 5k cached + 2k fresh in, 1-2.5k out | $0.03-0.06 | $0.015-0.03 | about $0.002 |
| One generated page | 5k cached + 3k fresh in, 5-8k out | $0.12-0.17 | $0.06-0.09 | $0.003-0.005 |
| A 7-page deck | seven pages in parallel, shared cached prefix | about $0.9-1.2 | about $0.45-0.6 | about $0.03 |

A user who makes 100 assistant turns a month costs roughly $3-6 on Opus 5.5 and about $0.20 on Haiku 5.5. These figures are why metered quotas (free tier, then paid) belong in the design from the start (option C).

### 5.9 Phased plan for AI

- **A. Foundation (2-3 weeks):** the `src/ai/` module (provider interface, settings and consent, fake provider), the tool layer with schemas and tests, the About-dialog change, an evaluation harness. Features: write and rewrite (3) and alt text with the contrast checker (7).
- **B. On-device features (2-3 weeks):** remove background (5), semantic search (6). *Remove background shipped on 2026-11-05 (WebGPU only, ISNet general-use; BiRefNet lite, the first choice, did not run on integrated GPUs): see [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md). Upscale shipped on 2026-11-06 (Real-ESRGAN general x4 v3, WebGPU, no half-precision needed). Blur background and Colour pop shipped on 2026-11-06 (the remover's mask, no new model). Semantic search is still open.*
- **C. The assistant (3-4 weeks):** features 1 and 4, streaming, cancel, undo as one step, evaluation set v1.
- **D. Generation (4-6 weeks):** text to design (2), resize with re-layout (8), outline to deck (12), then the proxy and quotas (option C) for a public launch.
- **E. Platform (open-ended):** accounts, sync, collaboration, billing, image generation (14).

## 6. Suggested order of work

| Phase | Weeks (one developer; rough) | Contents | Done when |
| --- | --- | --- | --- |
| 0. Hygiene | 1-2 | **Done (2026-11-05 to 07):** licence, README rewrite and the other project files, the Ellipse entry, security headers and hosting recipes (CSP verified), ESLint and Prettier, CI (written, not yet run). **Open:** the update prompt for the service worker, backup and restore, opt-in error reporting | A stranger can clone, build, test and deploy it; every push is checked |
| 1. Reliable everywhere | 3-4 | Touch gestures, Firefox and Safari in the browser checks, the zoom fast path, accessibility CI, i18n scaffolding and non-Latin fonts | Works on a phone and in three browsers; the accessibility score is tracked |
| 2. AI foundation and first features | 3-5 | Section 5.9 A and B | Three AI features behind a consent screen, covered by tests and an evaluation score |
| 3. Assistant and generation | 6-10 | Section 5.9 C and D | The assistant and text to design pass the evaluation bar |
| 4. Platform | open | Accounts, sync, collaboration, content partnerships | Decided by the business case |

## 7. Decisions I need from you

1. **Licence:** decided, MIT (2026-11-05). Open: whose name goes in the copyright line (it says "Craftly contributors" for now)?
2. **Audience:** a portfolio and personal tool, a public free app, or a product for teams? That decides whether you ever need accounts and a backend.
3. **Hosting stance:** decided for the tools that work on pictures (2026-11-06): they run on this device. A hosted service such as fal.ai (Flux) was offered and not chosen, so image generation (feature 14), which cannot run in a browser, stays off the plan until you say otherwise. Open for the language features (the assistant, text to design): the browser's own on-device text APIs only, bring-your-own-key, or a small proxy service?
4. **First AI feature:** decided by what shipped: Remove background (2026-11-05), then Upscale, Blur background and Colour pop (2026-11-06), all on the device. Open: what comes next; my pick is write and rewrite, then semantic search, then the assistant.
5. **AI budget per user:** is there a free tier, and who pays for the tokens?
