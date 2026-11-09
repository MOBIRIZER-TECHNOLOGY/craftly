# Craftly versus Figma

Written 2026-11-08. The Craftly side comes from its own code and documents (the feature inventory of 2026-11-05, re-checked against the code, plus what was added since: the four on-device photo tools, the accessibility work and the verification). The Figma side comes from Figma's own product pages, pricing page, help centre and the Config 2026 recap on its forum, all read on 2026-11-08, plus two third-party sources where Figma's pages were silent (offline use, Specs). Figma ships quickly and several products are in beta: treat its side as a snapshot. Where a Figma capability below is not on the pages that were read but is long established, it is marked *(known, not re-checked)*.

A companion report compares Craftly with Canva, the product it is modelled on: [`Craftly versus Canva feature gaps.md`](Craftly%20versus%20Canva%20feature%20gaps.md).

**Update, later on 2026-11-08:** the first of the vector gaps below has been closed. Craftly now has a **Pen tool with point editing** (corner and smooth points, handles, add and delete points, close a path, from the keyboard too; see the README). Where this report says "no pen tool" or "no node editing", read it as it stood in the morning. **Update, 2026-11-09:** boolean operations are closed too. **Combine** (union, subtract, intersect, exclude) makes one path of several shapes, and **Convert to path** turns a preset shape into editable points (see the README). Turning text into points, SVG import as paths, text on a path, blend modes and several fills and strokes are still open.

## 1. The short answer

Craftly and Figma are different kinds of product, and they overlap in a narrow band.

- **Figma** is a collaborative platform for designing software and for the systems and handoff around it: an infinite canvas, auto layout, components and variables, prototyping, Dev Mode, real-time multiplayer, and in the last two years more products on top of it (Draw, Slides, Buzz, Sites, Make, FigJam, Motion, Specs, an AI agent). It is a cloud product with accounts, seats and AI credits.
- **Craftly** is a single-user, Canva-style studio for finished graphics: social posts, presentations, posters, documents, cards. It starts from templates, ships its own content, exports to image, PDF, SVG, GIF and video, and runs entirely in the browser with no account, no server and no upload.

The overlap is the "make a graphic or a deck" work that Figma Slides, Figma Buzz and Figma Draw also do. Outside that band Craftly has none of Figma's platform: no components or styles, no auto layout, no real-time collaboration, no prototyping, no Dev Mode, no plugins, no libraries. Inside it, Craftly is ahead on offline use, privacy, cost and on-device AI, and behind on depth (vector editing, effects, typography) and on everything that needs a backend.

**Craftly is not a Figma replacement for interface design or team workflows, and it should not try to be one.** It is a credible private, offline alternative to the poster-and-deck side of Figma and Canva.

## 2. Everything Craftly can do

### Dashboard and library
- Home with a search over designs and templates, a row of nine quick-create tiles (Presentation, Social media, Printables, Doc, Resume, Logo, Custom size, Upload, More), recent designs and template carousels.
- Create dialog: 29 design types by category, a search, a custom size in px, in, mm or cm (40 to 8,000 px a side, ratio lock), and "start from an image".
- Projects: folders, stars, drag to a folder, sort and filter, card menus (open, rename, make a copy, star, move, move to trash).
- Templates browser with categories, previews and favourites; Trash with restore, delete forever and empty trash; Brand kit (colours, fonts, logos).
- Import of `.craftly` project files; an About dialog with storage use and a request for persistent storage.

### Canvas and editing
- Select, shift-select, marquee; move, eight-handle resize (corners proportional, Alt from the centre), rotate with snapping (45 degrees, 15 with Shift), flip, nudge with the arrow keys.
- Group and ungroup, z-order, align and distribute, lock and hide, a Layers panel, copy, paste, duplicate, copy and paste style.
- Smart snapping to the page, to elements and to guides; rulers and draggable guides; zoom 5 to 400 % (fit, fill), pan with Space or middle drag, a snap toggle.
- 120-step undo and redo (a drag or a slider scrub is one step), autosave, version history snapshots, find and replace text, Resize (with a ratio lock, or into a copy).
- Context panels: Position (arrange, layers, size, rotation), Effects, Colour, Font, Filters, Background, Data, Animate.

### Text
- Rich text on a canvas: 44 bundled font families (Latin only), size, colour and gradient, bold, italic, underline, strike, case, alignment including justify, bullet and numbered lists, letter and line spacing, formatting of a selection, curved text.
- Nine effects: shadow, lift, hollow, splice, outline, echo, glitch, neon, background. Default text styles, font combinations, a font search, dynamic page numbers.

### Shapes, lines, drawing
- 47 shapes (45 drawings plus a rounded square and an ellipse), lines and arrows with arrowheads, a freehand draw tool, frames and photo grids.

### Images and media
- Upload by button, drag and drop or paste; an asset manager; replace image; drop photos onto frames; crop with live zoom and reposition; flip; corner radius; borders; shadow.
- Filters and adjustments (brightness, contrast, saturation, warmth, fade, vignette, blur, hue), duotone, alt text.
- **On-device AI photo tools:** Remove background, Blur background, Colour pop, Upscale (2x or 4x). They run on the user's own graphics card (WebGPU) through ONNX Runtime in a Web Worker; each model is downloaded once, after the user agrees, and photos never leave the device.

### Content that ships with the app
- 72 templates (141 pages): ten seven-page presentation decks, 24 social posts, stories and thumbnails, posters, flyers, documents, resumes, logos, invitations, business cards, certificates, menus and banners.
- 161 hand-drawn illustrations, 2,000+ icons, 44 procedural stock photos (no real photography), 136 backgrounds, colour palettes.

### Charts, tables and built-in apps
- Tables (table-wide styling) and six kinds of chart with an editable data grid.
- Apps tab: QR code (link, Wi-Fi or text), emoji, lorem ipsum, placeholder image, colour palette from a picture. Tools palette: select, text, shape, line, draw, hand.

### Pages, animation and presenting
- Add, duplicate, delete, reorder (strip or grid view), page names, speaker notes, a timer, a page counter, full screen.
- Animation: 17 element effects (entrance and exit: fade, rise, pan, pop, zoom, wipe, slide, drop, tumble, typewriter, flicker; emphasis: breathe, pulse, float, wiggle, spin, flash) with direction, duration and delay; eight one-click page animations that stagger a page; page timing; six transitions (dissolve, slide, push, wipe, zoom, dip to black).
- Present: full screen, plays the animations and transitions (backwards when going back), auto-play on `P`, notes on `N`, reduced motion respected.

### Export, import and sharing
- PNG (scale, transparent), JPG (quality), PDF (screen or 300 dpi print; one image per page, with clickable links), SVG (vector, optionally with embedded fonts), multi-page ZIP, animated GIF (480p, 720p, 1080p; 10, 15 or 20 fps), WebM video (recorded as it plays), `.craftly` project files, print, copy as image.
- "Share" means local outputs: there are no links, no accounts and no collaboration.

### Platform
- Offline after the first visit (service worker), installable as an app, IndexedDB storage, no backend, no analytics or tracking.
- Responsive layouts: desktop; tablets keep the side panel; phones switch to a bottom dock with a sheet. No pinch-zoom or two-finger pan yet.
- Keyboard shortcuts for nearly everything, with a searchable list (`?`).
- Accessibility: every menu and dialog works with the keyboard, focus returns to what opened it, the canvas is a named stop of the tab order, colours were audited against WCAG, and Lighthouse reads 100 for accessibility, best practices and SEO on the production build.

### Quality
- 6,121 tests with 99.4 % statement coverage (gate 95 %), 115 scripted browser checks, ESLint and Prettier, a CI workflow that has not yet run on GitHub. See [`../docs/VERIFICATION.md`](../docs/VERIFICATION.md).

## 3. Everything Figma offers (snapshot, 2026-11-08)

### Figma Design
- **Layout:** auto layout (frames that resize and reflow), grid layouts, multi-edit across frames and component sets, branching and merging. Constraints and nested frames *(known, not re-checked)*.
- **Vector and illustration:** vector tools, Vectorize (turn a flat image into editable vector layers), brushes, advanced strokes and fills.
- **Design systems:** components, variants *(known)*, slots (customise a component without detaching it), variables for colour, spacing, text and modes, styles, shared libraries of components, fonts and assets, and "check designs" against the system.
- **Effects:** shadows, blur, noise, texture, glass, and custom WebGPU shader effects and fills that can be exported.
- **Motion and prototyping:** Figma Motion (open beta; keyframes and a timeline, reusable motion systems, dev-ready export); prototyping with triggers, Smart Animate, interactive components, variables, conditional logic, mathematical expressions, play on the canvas, a responsive viewer, GIF and video in prototypes; code layers (open beta since 2026-10-14).
- **Collaboration:** real-time multiplayer, cursor chat, comments. Plugins and widgets, version history *(known, not re-checked)*.
- **AI:** the Figma agent (generates, remixes and automates designs, gives feedback; open beta on all paid plans), Weave tools in Design (swap backgrounds, add logos, change aspect ratios), generative plugins, prompt-based editing through Figma Make, and an MCP server that gives coding tools design context.

### Figma Draw
- A separate illustration workspace: brushes (and your own), variable-width strokes, dynamic strokes, progressive blur, noise and texture, text on a path, repeats (transforms), lasso selection, colour reduction for vectorized images, multi-vector editing, components for illustration, colour variables.

### Dev Mode, Code Connect and Specs
- Inspect with code snippets, component properties and structured layer data; Code Connect (map design components to production components); dev statuses ("ready for dev") and notifications; compare changes; dev resources (link GitHub files, Jira tickets and Storybook stories to layers); focus view; annotations; a component playground; code syntax shown in variables.
- MCP server that can write to the canvas and turn live UI into an editable file; works with Claude, Codex, Cursor and OpenAI tools.
- Figma Specs (beta, from 2026-10-15): a shared Markdown brief on the canvas that people and AI agents read.

### Figma Slides
- Templates and community templates, a slide builder with Design Mode (auto layout and the layers panel), importing Figma designs and PPTX files, plugins, video styling, shared editing with chat, audio and comments, co-presenting, presenter notes, live polls and voting, interactive prototypes in a deck, FigJam to a deck outline, AI tone changes and AI presenter notes.

### Figma Buzz (beta, all seats)
- Brand template library, locked regions so teams stay on brand, a simplified editor for non-designers, multi-edit across many assets, a grid view of all assets, AI image tools (remove background, combine images, upscale, rewrite, shorten, translate), AI image generation, video import and trim, plugins.

### Figma Sites (beta, Full seats) and Figma Make
- Sites: design, prototype and publish responsive websites from Figma, with a CMS, preset and AI-made interactions, code editing and templates.
- Make: prompt to a working, code-backed prototype or app, with a built-in CMS, Make kits (npm packages and library styles), MCP connectors, plan mode, attachments, version history, comments and voice prompts.

### FigJam
- A whiteboard: 300+ templates, stickies, connectors, diagramming, real-time cursors, audio and chat, reactions, guest access, an iPad app, integrations (Asana, Jira, GitHub), widgets, and AI that generates templates, sorts stickies into themes and summarises.

### Platform and pricing
- Browser app plus desktop and mobile apps. No fully featured offline mode (Figma's help centre says it has no plans for one); an account is required.
- Export: PNG, JPG, SVG and PDF with scale options and slices, `.fig` files, Motion output, dev-ready code.
- Plans (per seat per month, as listed on 2026-11-08): Starter free (150 AI credits a day, 500 a month); Professional Full $16, Dev $12, Collab $3 (Full seat: 3,000 AI credits a month); Organization $55, $25, $5 (annual only); Enterprise $90, $35, $5. A Full seat includes Design, Make, Draw, Motion, Sites, Dev Mode, FigJam, Slides, Buzz and Specs; Dev and Collab seats get Dev Mode, FigJam, Slides, Buzz and Specs and can view and comment in Design files.

## 4. Side by side

"Craftly" and "Figma" say what each has. The last column is a judgement: **Figma** ahead, **Craftly** ahead, **even**, **Figma only**, **Craftly only**.

| Area | Craftly | Figma | Ahead |
| --- | --- | --- | --- |
| Canvas model | One fixed-size page at a time per design; pages in a strip | Infinite canvas with many frames of any size, nested frames, sections | Figma |
| Basic object editing | Select, resize, rotate, group, align, distribute, layers, lock, snapping, rulers, guides | The same, plus constraints, multi-edit, nested selection, measurements *(known)* | Figma (depth); even on basics |
| Layout system | Absolute positioning only | Auto layout, grids, constraints, responsive frames | Figma only |
| Components, styles, variables | None; a brand kit (colours, fonts, logos) and text style presets | Components, variants, slots, styles, variables with modes, shared libraries | Figma only |
| Vector editing | 47 preset shapes, a freehand pen, and (added later on 2026-11-08) a Pen tool with point editing; (added 2026-11-09) union, subtract, intersect and exclude, and Convert to path | Vector tools, Vectorize, brushes, variable-width strokes, text on a path, repeats | Figma |
| Fills and effects | Solid and gradient fills, shadow, opacity, photo filters, nine text effects; no blend modes | Multiple fills and strokes, blur, progressive blur, noise, texture, glass, shaders, blend modes *(known)* | Figma |
| Typography | 44 Latin families, styles, lists, spacing, curved text, nine effects; no weight picker, no custom fonts, no right-to-left or non-Latin text | Text styles, variable fonts and OpenType *(known)*, local and custom fonts *(known)*, text on a path, international text | Figma |
| Images and photo editing | Upload, crop, adjustments, duotone, frames, replace; remove background, blur background, colour pop, upscale on the device | Image fills, crop, adjustments *(known)*; Weave and Buzz AI tools in the cloud (swap background, aspect ratio, upscale, generate) | Even on basics; Figma on AI breadth, Craftly on privacy |
| Charts and tables | Native: tables and six chart kinds | None built in; plugins *(known)* | Craftly |
| Templates and content | 72 templates, 161 illustrations, 2,000+ icons, 136 backgrounds, built in and offline; no real photography | Community templates and UI kits at very large scale, Slides, Buzz and FigJam (300+) templates | Figma (scale); Craftly (works offline, no account) |
| Presentations | Full-screen presenter, auto-play, notes, transitions, ten template decks | Slides: community templates, PPTX import, interactive prototypes, polls, co-presenting, AI notes | Figma |
| Marketing assets at scale | Resize, make a copy and resize | Buzz: brand templates, locked regions, multi-edit, grid view, AI | Figma |
| Animation | 17 element effects, eight page animations, six transitions; no keyframes or timeline | Figma Motion (beta): keyframes, timeline, reusable systems; Smart Animate | Figma |
| Video output | Animated GIF and WebM, rendered from the design | Motion output and prototypes; video import in Buzz | Craftly (direct GIF and WebM export) |
| Prototyping and interaction | None (the presenter only) | Triggers, actions, interactive components, variables, conditions, device preview | Figma only |
| Real-time collaboration | None | Multiplayer, cursor chat, comments, audio chat, guests | Figma only |
| Version history and branching | Local snapshots | Version history, branching and merging | Figma |
| Sharing and publishing | Local files, downloads, print | Share links, view and comment access, prototypes, published sites | Figma |
| Dev handoff and code | None | Dev Mode, Code Connect, MCP server, code layers, Specs | Figma only |
| Websites and apps | None | Sites, Make | Figma only |
| Plugins and extensibility | Five built-in apps; no API | Plugins, widgets, generative plugins, a plugin API, an MCP server | Figma only |
| AI | Four on-device photo tools, free and private; needs WebGPU | Agent, Weave tools, Make, generative plugins, image generation and text tools; metered in AI credits by plan | Figma (breadth); Craftly (private, no metering) |
| Export | PNG, JPG, PDF (raster pages), SVG, ZIP, GIF, WebM, `.craftly`, print | PNG, JPG, SVG, PDF, `.fig`, slices and export presets, Motion output | Even: Craftly has direct GIF and WebM, Figma has vector PDF and export settings |
| Import | Images and `.craftly` files | `.fig`, images, SVG *(known)*, PPTX (Slides), and more *(known)* | Figma |
| Offline use | Full offline after the first visit, installable | No fully featured offline mode; an account is required | Craftly |
| Privacy | Everything stays on the device; no account, no analytics; photos never uploaded | Cloud files and accounts; AI runs in the cloud | Craftly |
| Cost | Free and MIT-licensed; you host it | Free Starter with limits; paid seats from $16 a month for a Full seat | Craftly on price (you carry the hosting and support) |
| Devices | Browser; responsive; no pinch-zoom or two-finger pan | Browser, desktop and mobile apps; FigJam on iPad | Figma |
| Accessibility of the editor | Keyboard-operable throughout, WCAG colour audit, axe-core and Lighthouse clean | Not described on the pages read | Not compared |
| Maturity and scale | Version 0.1.0, one developer, tested in Chrome only | A public company, millions of users, years of production use | Figma |

## 5. What Craftly has that Figma does not

- **Works fully offline and needs no account.** Figma has no fully featured offline mode and needs an account for everything.
- **Private by construction.** There is no server, so no design or photo can leave the device, and the AI photo tools run on the user's own graphics card.
- **Free of seats and credits.** The AI tools are not metered; Figma's agent, Weave and Buzz tools use AI credits that depend on the plan.
- **Native charts and tables** and a set of small built-in apps (QR code, emoji, palette from a picture).
- **Ready-made graphic content** that works with no connection: 72 templates, illustrations, icons, backgrounds.
- **Animated GIF and WebM export** straight from the design.
- **Self-hosting:** it is a static site that can be published anywhere, with the headers and a Content-Security-Policy documented in the README.

## 6. What Figma has that Craftly does not, in order of what would matter to Craftly's users

1. **Vector depth:** a pen tool with node editing (done, 2026-11-08), boolean operations (done, 2026-11-09), blend modes, multiple fills and strokes, SVG import. These are the gaps a designer meets first, and they need no backend.
2. **Reusable styles:** text and colour styles, and eventually components. Craftly has a brand kit but no way to restyle many objects at once from one definition.
3. **Layout help:** constraints and a simple auto layout, and snapping to a grid, margins and equal spacing.
4. **Typography:** a weight picker, custom font upload, non-Latin scripts and right-to-left text.
5. **Collaboration:** comments, share links and real-time editing. These need a backend and accounts, which would change what Craftly is.
6. **A keyframe timeline** for animation, and video and audio as design elements.
7. **Dev Mode, prototyping, Sites, Make and the plugin platform:** these belong to Figma's purpose and are not worth chasing.

## 7. Where Craftly should aim

Do not follow Figma into product design. The overlap worth owning is the band that Figma Slides, Figma Buzz and Figma Draw share with Canva: finished graphics and decks, made quickly, with good content, and now with private AI. Three things follow:

- **Keep the advantage Figma cannot copy:** offline, private, no account, free of credits. Make it visible in the product and in the README.
- **Close the cheap gaps first:** a pen tool (done, 2026-11-08), boolean operations (done, 2026-11-09), blend modes, link editing, grid and margin snapping, a font weight picker, SVG import. They make the editor feel complete to someone coming from Figma or Illustrator, and none needs a server.
- **Decide on collaboration deliberately.** It is the one thing every user of Figma expects and the one thing that would need an account system and a backend. The ROADMAP already treats it as a separate product decision (P2).

## 8. Sources

Figma, read on 2026-11-08:
- [Figma Design](https://www.figma.com/design/), [Dev Mode](https://www.figma.com/dev-mode/), [Prototyping](https://www.figma.com/prototyping/), [Slides](https://www.figma.com/slides/), [Buzz](https://www.figma.com/buzz/), [Sites](https://www.figma.com/sites/), [Make](https://www.figma.com/make/), [Draw](https://www.figma.com/draw/), [FigJam](https://www.figma.com/figjam/), [Pricing](https://www.figma.com/pricing/)
- [Everything announced at Config 2026](https://forum.figma.com/product-updates-3/everything-announced-at-config-2026-55221), [export help article](https://help.figma.com/hc/en-us/articles/360040028114-Export-formats-and-settings)
- Third party, where Figma's pages were silent: [can Figma run without internet](https://supercharge.design/articles/can-figma-run-without-internet) (offline, with Figma's help-centre position), [Figma Specs launch](https://pricingsaas.com/news/article/figma-launches-specs-in-beta-for-full-dev-and-collab-seats)
- Earlier market research in `research_notes/Craftly versus Canva feature gaps/design_tool_landscape.md` (Figma's products, Q3 2026 results, Code Layers beta date).

Craftly: `README.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`, `docs/VERIFICATION.md`, `research_notes/Craftly versus Canva feature gaps/craftly_inventory.md` and the code under `src/`.

What this report did not do: use Figma itself (every Figma statement is from its public pages and help centre), check Figma's accessibility, or compare performance on large files.
