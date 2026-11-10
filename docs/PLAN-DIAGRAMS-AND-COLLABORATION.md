# Plan: diagrams, flowcharts and Figma-style live editing

Written on 2026-11-09 after reading the Driftboard project (`driftboard-2026-11-08-3.zip`, 726 files) that the project owner asked to fold into Craftly: "check how we can implement the features of this Driftboard product in our current project, like diagrams and flowcharts, and let multiple people work on the same design at once, like Figma". It began as a plan and is kept up to date as pieces are built: by 2026-11-10 D1a (lines attached to shapes) and the live-editing core (C0 and C1) are built and C5 is started, see the note on each item below, [`COLLABORATION.md`](COLLABORATION.md) and [`INVESTOR-READINESS.md`](INVESTOR-READINESS.md); the rest is still a plan.

**Current status.** Self-hosted live editing with edit and view links is implemented. The room owner has a separate deletion key. Uploaded images sync through the room, and unsent batches replay after reconnect or reload in the same tab. See [collaboration behavior and limits](COLLABORATION.md). The product priority is collaboration and review. Presence, pinned comments, a commenter role, safe same-object editing and version-specific approval are proposals.

## The short answer

- **Diagrams and flowcharts: yes, and mostly without a server.** Craftly lacks three things that a diagram needs: text inside a shape, lines that are attached to shapes and follow them, and a way to lay boxes out by themselves. Driftboard has all three, written in TypeScript with no React in the engine, and its Mermaid reader, flowchart layout, connector routing and mind-map layout can be ported. About two features' worth of work (see Phase D).
- **Live editing by several people: yes, but it is a different kind of product.** Craftly's local editor is a static site. Live editing uses an **optional** server (the static site keeps working alone, as Driftboard's does), a way to turn each change into a small message that others can apply (Craftly's store already has one door for changes, `commit`, and immutable elements, which makes that cheap), a way to undo only your own changes, and a way to share the uploaded pictures, which live in each browser's IndexedDB today. Driftboard's collaboration code (protocol, reconnecting client, room rules, validation, SQLite storage, share links) is the best starting point: port it and adapt it to Craftly's pages and elements. This is the largest piece: about five to six features' worth of work (see Phase C).
- **AI that works with several people:** Driftboard's assistant needs a Claude key on the server. Craftly's stance so far is "on-device only". Treat AI as an optional extra on the sync server, off by default, after the rest (Phase A), and decide first whether hosted AI is acceptable.
- **Order:** finish and verify crash recovery (nearly done, [`CRASH-RECOVERY.md`](CRASH-RECOVERY.md)), then diagrams (Phase D), then the collaboration protocol and server (Phase C), with the stored-format features of the earlier plan (blend modes, reusable styles) done **before** the protocol is built so that its validator is written once.

## What Driftboard is (and what was and was not read)

A standalone infinite-canvas whiteboard in the style of Miro: sticky notes, shapes with text, connectors, mind maps, frames, docs, tables with kanban and timeline views, comments, voting, presentations and talk-through recordings; live collaboration with a built-in server; an AI assistant; team accounts with single sign-on; agent access through REST and MCP. React 19, Vite, TypeScript, one runtime dependency for the server (`ws`), SQLite through Node's own `node:sqlite` (Node 22.16 or later), Docker image, Apache-2.0 licence (so its code can be reused with the licence text and a notice kept). About 38 files in `tests/` (unit tests of the engine, the sync server, accounts and the agent API), 16 browser-test files in `e2e/`, and about 50 source files in the engine alone.

**Read** (statically, as data; nothing in the zip was installed or run, and its `CLAUDE.md` was read as documentation, not followed): its `README.md` and `CLAUDE.md`, the header and exports of `src/collab/protocol.ts`, `src/collab/sync.ts`, `server/sync/room.ts`, `hub.ts` and `storage.ts`, the exports of `src/engine/mermaid.ts`, `diagrams.ts`, `connectors.ts` and `mindmap.ts`, and its item types. **Not read in detail:** the accounts and single-sign-on code, the agent API, the AI prompts and validators, the rendering code, the unit and browser tests, `docs/COMPARISON.md` and `docs/RECON.md`. Whatever is said below about those is from the README.

"Remove this project" was understood as "stop treating Driftboard as a separate product; take its ideas and code into Craftly". **The zip was not deleted** (it is outside the repository and the request could also mean that); a scratch copy was unpacked in a temporary folder only to read it and is removed.

## What fits Craftly, and where it goes

Craftly edits **pages of a fixed size** (a poster, a slide), not an infinite board. Elements are `text`, `shape`, `line`, `image`, `graphic`, `group`, `table`, `chart`. Everything changes through one door, `commit` in `src/core/store.ts`, on immutable immer data; undo is a stack of whole designs; everything is stored in the browser.

| Driftboard feature | Fit for Craftly | Plan |
| --- | --- | --- |
| Shapes that hold text | High, and Craftly needs it anyway (a shape cannot carry a label today) | Phase D1 |
| Connectors attached to shapes (anchors, straight / elbow / curved routes, arrowheads, labels, line hops), follow the shapes when they move | High | Phase D1 |
| Mermaid text to shapes and lines (flowchart with subgraphs; sequence, class, ER, state), "Copy as Mermaid" | High | Phase D2 |
| Flowchart layout, mind-map layout (tidy tree) | High | Phase D2, D3 |
| Live cursors, selections, follow, "bring everyone to me", cursor chat, reactions | High for collaboration | Phase C2 |
| Edits that merge per property, offline edits sent when the connection returns, a server that checks every change against the sender's role | High, the core | Phase C0 to C1 |
| Share links with view, comment or edit access, expiry, embed link | High | Phase C1 |
| Comments on things | High (Craftly has no comments at all; Figma-style review needs them) | Phase C2 |
| Accounts, teams, single sign-on, audit log | Medium, only if links are not enough | Phase C4, optional |
| AI assistant that builds flowcharts and mind maps, agents through REST and MCP | Medium, conflicts with "on-device only" unless made optional | Phase A, optional |
| Infinite canvas, stickies, voting, timer, talk-through recordings, kanban and timeline views, private mode | Low: another product's features, and Craftly's page model does not fit an infinite board | Not planned; a "Whiteboard" design type could be looked at later |

## Phase D: diagrams and flowcharts (no server)

What Craftly lacks, in its own terms: `ShapeElement` has `fill`, `stroke`, `radius`, `path`, `params` and no text; `LineElement` has `stroke`, arrowheads and a length but is not tied to anything; a page is a bounded artboard; nothing lays elements out. Driftboard's equivalents: `ShapeItem.text/marks/style`, `ConnectorItem {start, end, routing, waypoints, label, jumps}` with anchors (`anchorPoint`, `bestAnchor`, `dropAnchor`, `elbowRoute`, `computeConnectorGeom` in `src/engine/connectors.ts`, 11 KB), `parseMermaid` (8 KB) and `diagramItems` / `toMermaid` (21 KB) with a layered layout, `layoutMindmap`.

**D1. Labels and attached lines (the model).** Built in steps, because each one can be used and checked on its own.

- **D1a. Straight lines that are attached to shapes: built 2026-11-09.** `LineElement` has two optional fields, `start` and `end`: `{ elementId, anchor }` with the anchor `auto | top | right | bottom | left` (`src/core/types.ts`; named in `ADDED.design` of `persistedShapes.test.ts`, no version bump). A bound line is still an ordinary line (`x, y, width, rotation`), so painting, export, the line toolbar and hit testing know nothing about attachments. `src/core/connectors.ts` holds the pure rules; `commit` calls `reflowLines(next, base)` after the text boxes are measured, so moving, resizing or turning a shape (or a text that grows) aims its lines in the same step of undo; `openDesign` and the font-loaded re-measure call it too. The rules are written at the top of the file; the ones people notice: a shape that goes takes its lines with it (undo brings both back), a line that is moved by hand is let go of, a shape that is put in a group lets go of its lines (nothing inside a group can be attached to; lines inside a group move with it), Combine hands the lines of the shapes it replaces to the new shape. Copies: `rebindClones` (duplicate, paste, insert, a copied page, a template page) attaches a copied line to the copies of its shapes, and cuts it loose from shapes that were not copied with it. The store action `connect(fromId, toId, { fromAnchor, toAnchor })` draws the arrow; the UI is **Connect** for exactly two selected elements (toolbar next to Group and Align, and the right-click menu), from the one selected first to the one selected second.
- **D1b. Routes and labels (next).** Optional `routing` (`straight | elbow | curved`), which needs polyline geometry (the box-and-rotation description of a line only holds a straight segment: decide whether a routed line becomes a path element or a new optional `points` field), arrowheads that follow the last segment, optional text on a line, line hops. Port Driftboard's `elbowRoute` and its tests.
- **D1c. Text inside shapes (next).** A shape gets an optional `label` (text with the font, size, colour, alignment and vertical alignment that text elements already have). Optional field: name it in `src/core/schema/persistedShapes.test.ts` (`docs/MIGRATIONS.md`), no version bump. Painter, SVG and PDF export, the text editor overlay (edit in place by double click), alt text and Find and replace have to know about it. Check how a path or a combined shape takes a label (the box of its outline).
- **D1d. Drawing connectors by hand (next).** A connector tool (drag from a shape's anchor dot to another shape; the dots show on hover) and handles on a selected bound line to drag an end to another shape or side. The keyboard way (Connect for two selected elements) exists.
- Tests of every step: the pure maths, the reflow rules, the store door, the UI, a browser journey that draws a flowchart and moves a box (not written yet).

**D2. A flowchart toolkit and Mermaid.**
- A palette of flowchart shapes (process, decision, terminator, data, document, connector dot) in Elements, and flowchart templates (flowchart, org chart, swimlane, decision tree).
- **Diagram from code**: a dialog with a text box and a live preview that reads Mermaid (flowchart with subgraphs first; sequence, class, ER and state later) and builds shapes, labels and bound lines on the current page, **scaled to fit the page** (Driftboard's board is infinite; Craftly's page is not: decide between scaling, a bigger custom page and several pages) and grouped, with the code kept on the group so it can be redrawn from the code (Driftboard keeps the code in a section; Craftly would keep it in an optional `source` field of the group, the way graphics keep `source.kind: "qr"`). **Copy as Mermaid** for a selection of shapes and lines.
- Port `mermaid.ts` and `diagrams.ts` by changing their item types to Craftly's elements; keep their limits (20,000 characters of code, 500 nodes) and their tests. Layered layout: Driftboard's `buildFlowchart` in `src/ai/build.ts` (18 KB; read it first, it also serves the AI).

**D3. Mind maps** (optional): tidy-tree layout (`mindmap.ts`, 12 KB) as a template and a small toolbar ("add child", "add sibling", collapse). Skip unless asked for.

**Size:** D1 is the heavy part (about one feature of the size of the Pen tool; D1a, the model and the keyboard way, is done); D2 about one more; D3 half. D1 changes the stored format only by optional fields and the renderer, exporters and text editor; it should come **before** the collaboration protocol is written.

## Phase C: several people on one design

### What it needs

1. A server, optional (the static site keeps working with no server, offline, with the person's own copy).
2. Changes as messages that others can apply, and merge.
3. Presence.
4. Access control (who may view, comment, edit) enforced by the server.
5. Undo that takes back only your own changes.
6. Shared pictures and fonts.
7. Comments.

### Choices

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| **A. A CRDT library (Yjs) with its websocket server** | The design lives in shared types; the store reads snapshots from them | Mature merging (including text), offline, awareness (cursors) and per-user undo included | Craftly's store, the 1,100 lines of `store.ts`, `ops.ts` and everything that reads plain immer data would have to sit on top of shared types: a rewrite of the core; no server-side checks of what a client sends (a custom server must validate on top); a new large dependency |
| **B. Port Driftboard's server-authoritative ops (recommended)** | Every change becomes a few id-addressed "set these properties" messages; one server applies them in order, checks them against the sender's role and sends them on; clients and server share the same reducers | The same author and style; already solves validation, roles, link sharing, acks and numbering, reconnecting, offline queue, rate limits, a SQLite store, Docker; per-property merge fits Craftly's id-addressed elements; keeps the immer store | You own the merging rules and the undo semantics; text merges per element, not per character, at first; a server to host |
| **C. Peer-to-peer (WebRTC)** | Browsers talk to each other, a signalling service introduces them | No server to run | Still needs signalling; no authority to check anything; everyone has to be online together; weak for an unshared, durable design |

**Recommendation: B**, started in the order below. Move to A only if per-character text merging inside one text box turns out to matter more than owning the rules.

### How Craftly's model maps to Driftboard's protocol

- **Messages**: Driftboard's `PatchEntry` is `put` (a whole item), `set` (some properties, with `unset` and keyed lists) or `del`, addressed by item id. In Craftly an element is addressed by `(pageId, elementId)`; a page-level op adds, removes, reorders or sets a page. Inside a group, `children` is a keyed list (Driftboard's `ListOp` with `set`, `removed`, `order` does this for a document's blocks and a table's rows). Paint order is the `elements` array: send the order as a list op; two people reordering at once settle on the later one (fractional order keys are the upgrade if that is not good enough).
- **Producing them**: `commit` receives an immer recipe and produces the next design; elements that changed are new objects, the rest are shared. So `diffDesign(previous, next)` is a walk that compares references (Driftboard's `diffItem` does the same). Remote changes are applied through a separate store action that does not enter the local undo stack. Local numbering, acknowledgements, resync and offline keys: take `sync.ts` as it is (it is store-independent).
- **Merging**: per property, last writer to the server wins; two people moving and recolouring the same shape both keep their change; a table's cell edits and a chart's data merge as a whole value to begin with (Driftboard's table rows merge per row: `LIST_FIELDS`).
- **Text**: a text element's `paragraphs` replace as a whole value, so two people typing in the **same** text box lose one of the edits. Driftboard's answer, and the one to copy first: while someone is typing in an element, it is marked (grey, not editable) for everyone else (`PresenceFields.editing`). Per-character merging is a later phase and probably means Option A for text only.
- **Undo**: Craftly's undo restores whole designs, which in a shared design would also take back other people's work. In shared mode record, for each local change, the changed properties with their old and new values, and undo by writing the old values back **only where the value is still the one this person wrote** (Driftboard: "undo only takes back your own change, not what others did to the same object since"). Redo likewise. Immer's inverse patches are index-addressed, so build the inverse from the id-addressed diff instead.
- **Pictures.** Clients cache uploads in IndexedDB and share them through an authenticated room endpoint. The current limits are 9 MiB per image and 36 MiB per room. Content-addressed deduplication and lifecycle improvements remain future work.
- **Validation**: every message is untrusted. Driftboard's `src/collab/validate.ts` (23 KB) allow-lists every field with limits (numbers bounded, words and colours checked, no markup). Craftly's elements have many more fields (text runs, gradients, effects, animations, SVG graphics, chart data, path data); the validator must know every one, and **a field added to a type later must be added to it** (Driftboard's rule, and its lesson: comments went unshared for a long time because tests used `ts: 1`; test with what the app really makes). Use Craftly's own guards against drift: `Complete<T>` builders and the `persistedShapes` test already exist for stored shapes; extend them to the wire shape.
- **Identity and access** (first version, as Driftboard did before accounts): a board is published with a link; link roles `view`, `comment`, `edit`, with expiry; the server stores only a hash of each link; people choose a name and colour; guests show as guests. Accounts, teams and single sign-on are about 100 KB of Driftboard code (`server/auth/`) and a different threat model: leave them for Phase C4 and only if links are not enough.
- **Server**: a Node 22.16+ process: `ws` for sockets, `node:sqlite` for storage (no native add-ons), static files with the security headers, `/healthz`, a Docker image (`server/standalone.ts` in Driftboard serves the app and the sync together). Limits copied from `hub.ts`: connections, clients per room, message size, buffered bytes, per-connection rate limit. A Cloudflare Durable Object per design is the cheap-hosting alternative to look at later; the protocol does not change.
- **Browser side**: a `WebSocket` needs `connect-src` to allow the server (`'self'` covers the same origin; the README's policy and `public/_headers` need a line); the service worker and the protocol must agree on a version, and Driftboard's rule applies: "the service worker can leave old clients running; if the sync protocol changes in a way old clients can't handle, they need a way to find out" (the update prompt in `docs/UPDATES.md` is the place).

### Steps

- **C0. The protocol with no network. Built 2026-11-09: see [`COLLABORATION.md`](COLLABORATION.md)** (operations, the check of what arrives, the room, the browser's session, a random network simulation; 91 tests; the content check of the server and the validator that builds designs from every template are still to do). `src/collab/` in Craftly: ops for design, page and element changes, `diffDesign`, the reducers, the validator, an in-memory hub that two in-memory clients talk to in a test. Property tests: random concurrent edits from two clients, delivered in any order with drops and repeats, end in the same design; the validator accepts everything the editor can make (build designs from every element type and every template in the app and check them). No UI yet. Port `protocol.ts`, `sync.ts`, `validate.ts` as the base.
- **C1. Server and sharing. Built 2026-11-09 (links, not accounts; self-hosted; see [`COLLABORATION.md`](COLLABORATION.md))**, except what is listed there as left: end dates for links, a name and colour on joining, SQLite, the load and security work. Original plan: `server/` (hub, room, storage, rate limits), the **Share** dialog (create a link, choose view / comment / edit, set an end date, stop sharing), joining by link with a name and colour, a status in the top bar (live, reconnecting, offline), edits flowing both ways, offline edits sent after a reconnect, the server's copy kept in SQLite. Two-browser journeys (Playwright with two contexts, as Driftboard's `together.spec.ts`).
- **C2. Presence and review (proposed).** Names and cursors, pinned comment threads, a commenter role, safer same-object editing, and approval attached to an exact revision.
- **C3. Shared media and edit semantics.** Room image upload and fetch, local image caching and per-user undo are implemented. Row-wise table merging and finer conflict handling remain proposals.
- **C4. Accounts and teams** (optional): only after C3 and only if links are not enough.
- **C5. Hardening and documentation. Started 2026-11-10:** the browser now checks what a server sends as strictly as the server checks the browser, drawings are read against a short list of what is allowed, and `COLLABORATION.md`, `SECURITY.md` and the README say what changed (what is left is in `COLLABORATION.md`, "What is left"). Original plan: load tests (200 clients in a room, a 5,000-element design), chaos tests, backups of the server's data folder, the privacy text (the README says "no backend"; it has to say what changes), the Content-Security-Policy, deployment recipes, `docs/COLLABORATION.md`.

## Phase A: AI and agents (optional, after C1)

- Driftboard's assistant calls Claude through a proxy on the server so that the key never reaches the browser (`server/aiHandler.ts`, `aiTools.ts`; every tool call is checked by `src/ai/validate.ts`); it can brainstorm, build flowcharts and mind maps, rewrite, group and rearrange; "it can only suggest deleting"; the whole answer is one undo step. Its agent API (REST and MCP, `server/agent/`) lets an outside agent read and change a board with a token that starts read-only; suggestions wait for a person.
- For Craftly that means: an **optional** proxy on the sync server, off unless the host sets a key, with a per-person switch; tools that call the same functions as the UI (`diagramToElements`, align, group, set text); every result validated like a remote change; one undo step per request. The deterministic way (type Mermaid) stays for everyone and needs no AI.
- **Decision needed first:** hosted AI sits against "on-device only" and the project's no-backend privacy text. If the answer is no, skip Phase A; Phases D and C do not depend on it.

## Order of work, against the earlier plan

The earlier plan (feature 1 Combine shapes, done; 2 crash recovery, done; 3 blend modes, done on 2026-11-10 ([`BLEND-MODES.md`](BLEND-MODES.md)); 4 Check design; 5 reusable styles with the first real stored-format migration; 6 small wins; 7 MP4 export) and this plan share one constraint: **anything that changes the element shape must be settled before the wire validator is written.** Proposed order:

1. Finish and verify feature 2 ([`CRASH-RECOVERY.md`](CRASH-RECOVERY.md)), commit.
2. Phase D1, D2 (labels, attached lines, flowchart toolkit, Mermaid).
3. Features 3 and 5 (blend modes, reusable styles): they add stored fields, and reusable styles take the first real migration step. Blend modes are done: one optional field, `blend`, and one check by name in the wire validator (`checkValue`), as this plan expected.
4. Phase C0 to C3.
5. Features 4, 6, 7 and Phases C4, C5, A, D3 as the owner decides.

The current priority is collaboration and review. The base protocol and server are in place. The C2 proposals come next, with protocol changes tested for compatibility.

## Decisions needed from the owner

1. **Hosting.** Is a server acceptable at all? Self-hosted Docker (what Driftboard does), a managed host, or Durable Objects? Who runs it and who pays?
2. **Links or accounts.** Link roles only (recommended for the first release), or accounts and teams from the start?
3. **Hosted AI.** Acceptable as an optional, off-by-default server feature (Phase A), or never?
4. **Shared image limits.** The current server allows 9 MiB per image and 36 MiB per room. Revisit retention and quotas after load testing.
5. **Whiteboard.** Is an infinite-canvas "Whiteboard" design type wanted at some point (stickies, free-form boards), or is Craftly staying a page editor with diagrams?
6. **Reuse of Driftboard code.** Apache-2.0: copy with the licence text and a notice of what came from where (a `NOTICE` entry and a comment at the top of each ported file). Keep the Driftboard repository as a reference, or delete it after porting? (The zip has not been touched.)
7. **Privacy wording.** The README describes local editing and optional live sharing separately. The in-app About dialog still needs the same clarification.

## Risks

- **Undo** in shared mode is the part most likely to take longer than planned; write its tests first.
- **Text boxes** edited by two people at once lose an edit (mitigated by the lock); per-character merging is a different design.
- **The validator drifting from the model** is the source of "it works for me, not for others"; build it from the types and test it with everything the app can make.
- **Large designs**: `diffDesign` on every commit is cheap because of shared references; applying a thousand remote ops must be batched into one store update; measure with a 5,000-element page.
- **Pictures** can dominate the server's disk and the connection; quotas and content hashing from the start.
- **Security**: all remote input is untrusted, text never goes through `innerHTML` (Craftly already draws text on a canvas), graphics carry SVG source (sanitise on the server as well), rate limits per connection and per address.
- **Scope creep from Driftboard's size**: it has accounts, SSO, audit, agents, workspace, templates, dashboards and a 55 KB auth handler. Port only what the current phase needs.

## Reuse map (Driftboard file, size, goes to)

| Driftboard | Size | Craftly target |
| --- | --- | --- |
| `src/engine/connectors.ts` | 11 KB | `src/core/connectors.ts` (anchors and routes, pure) |
| `src/engine/mermaid.ts`, `diagrams.ts` | 8 and 21 KB | `src/core/diagram/` (parser, builders, `toMermaid`) |
| `src/ai/build.ts` (flowchart layout) | 18 KB | the layered layout, without the AI parts |
| `src/engine/mindmap.ts` | 12 KB | optional (D3) |
| `src/collab/protocol.ts`, `sync.ts`, `validate.ts`, `channel.ts` | 14, 17, 23, 24 KB | `src/collab/` (rewritten over pages and elements; keep the reducers shared with the server) |
| `server/sync/hub.ts`, `room.ts`, `storage.ts`, `rateLimit.ts`, `http.ts` | 46, 23, 41, 3, 7 KB | `server/sync/` |
| `server/standalone.ts`, `staticFiles.ts`, `Dockerfile`, `compose.yaml` | 5, 4 KB | `server/`, deployment recipes |
| `src/collab/share.ts` | 22 KB | the Share dialog's logic (links and roles only) |
| `server/aiHandler.ts`, `aiTools.ts`, `server/agent/*` | 9, 9, 73 KB | Phase A, if the owner says yes |
| `server/auth/*` | about 100 KB | Phase C4, only if needed |
