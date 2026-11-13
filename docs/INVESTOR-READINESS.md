# Investor readiness

Written on 2026-11-09 after the owner said: "we need to make it investor ready, so we need to add all possible features, like multi-user diagrams". "All possible features" has no end, and an investor does not reward a long list. They look for a clear reason to exist, a demo that works, proof that it is built well, and a path to money. This document turns the request into **milestones with exit criteria**, says where Craftly stands today (facts from this repository), and lists what only the owner can decide or do. It does not invent market numbers, traction or prices: those are the owner's to supply.

The technical plans it points to: [`PLAN-DIAGRAMS-AND-COLLABORATION.md`](PLAN-DIAGRAMS-AND-COLLABORATION.md) (diagrams, live editing, AI), [`ROADMAP.md`](ROADMAP.md) (production readiness, content, AI features), [`CRASH-RECOVERY.md`](CRASH-RECOVERY.md) (the crash screen and the problem reports), [`VERIFICATION.md`](VERIFICATION.md) (how the quality claims were checked).

## 1. The pitch, as a working assumption (the owner should correct it)

> Craftly is an open-source, privacy-first design and diagram editor that runs in the browser, works offline, can be self-hosted, and lets a team edit the same design live. Designs and photos stay on the device unless you share them on a server you run.

Why that could be a wedge: organisations that cannot put designs in a hosted American SaaS (regulated industries, schools, public sector, privacy-minded EU buyers), people who want ownership and offline use, and teams that want AI help without sending their work to a third party (the on-device photo tools exist today). What it is up against, and must be able to answer: Canva and Figma (the big hosted products), and the open-source tools Penpot (design), tldraw and Excalidraw (whiteboards with collaboration), draw.io (diagrams). "Open-source" alone is not a difference from those; **self-hosted, offline-first, page-based design with built-in diagrams and live editing, plus on-device AI** is.

## 2. Where Craftly stands, by what an investor looks at

| Area | What they look for | What this repository shows today | Gap | Milestone |
| --- | --- | --- | --- | --- |
| A working product they can try | A public URL, a 3-minute path from nothing to something good | Runs locally and as a static build; **no public deployment, no landing page, no demo video** | Deploy, landing page, demo script and video | M0 |
| A reason to exist | A clear difference | Offline PWA, local designs by default, four on-device photo tools, vector Pen and Combine tools, animation with GIF and WebM export, Back up & restore, an accessibility audit | Live collaboration and diagrams are what people will ask for first | M1, M2 |
| Collaboration | Teams can share and review a design | Optional self-hosted co-editing, view and edit invites, owner-only room closure and shared images | Presence, pinned comments, commenter role, safer same-object editing and version-specific approval are proposed | M2 |
| Diagrams | The owner's named headline | Lines attach to shapes and follow them (**Connect**, built 2026-11-09); no text inside shapes, no elbow or curved routes, no flowchart palette, no Mermaid, no layout | Labels, routing, drawing connectors by hand, Mermaid, layout | M1 |
| Proof of quality | Tests, CI and a verification record | 16 readiness regressions verified, 12 in Edge and 4 with server integration. See [verification](VERIFICATION.md#production-readiness-regressions) for coverage and test scope. | Cross-browser, real assistive technology, performance, deployment headers and print fidelity | M0 |
| Security and privacy | A threat model, a policy people can read | `SECURITY.md`, CSP and headers, privacy text in the README and About dialog | A server changes all of it: threat model, validation of every message, rate limits, a privacy policy and terms, a security review | M2, M4 |
| Performance | Numbers | 60 fps editing at 1,000 elements; start-up under 2 s on a fast desktop; zoom repaints everything (ROADMAP 13) | Budgets in CI, a 5,000-element test, mobile hardware | M6 |
| Reach | Phones, other browsers, other languages | Touch gestures missing, only Chrome tried, English only, Latin fonts only (ROADMAP 9 to 12) | All of it | M6 |
| Content | Libraries that compare with the incumbents | 102 templates, 161 illustrations, 47 shapes, 44 fonts, procedural photos | A content pipeline and licensed stock (ROADMAP 18) | M6 |
| A way to make money | A model and the features it needs | None, on purpose | Accounts, teams, plans: the owner's decision | M5 |
| Traction | Users, retention, growth | None, and no analytics by design | Opt-in analytics (ROADMAP 23), a hosted demo, a waitlist, GitHub activity | M0, M5 |
| Legal and IP | Clean ownership | MIT licence, generated third-party notices, original name, code and assets, model licences recorded | Craftly and Driftboard were designed after studying commercial products (Canva, Miro); **get a lawyer's opinion on look-and-feel before raising**, keep competitors' names out of the product and the marketing, and note that much of the code was written with an AI assistant (keep the history, tests and reviews as evidence) | M0 |
| Operations | Hosting, monitoring, backups, a status page | None (static site) | Needed for any hosted offer | M4 |
| Team and process | Docs, contribution rules, roadmap | README, CONTRIBUTING, SECURITY, ROADMAP, CHANGELOG, DESIGN, VERIFICATION, issue templates, handoff documents | The code of conduct needs a contact; the repository is not public | M0 |

## 3. Milestones and their exit criteria

An exit criterion is something a stranger can check. A milestone is done when all of it is true, verified the way [`VERIFICATION.md`](VERIFICATION.md) describes.

**M0. Publishable** (mostly the owner's actions, a little work).
- The repository is on GitHub, CI runs and is green on Linux with Node 22, with a badge in the README. Lighthouse and the browser journeys run in CI.
- A public demo is deployed with the security headers and the policy from the README; a landing page says what it is and links the demo and the repository.
- Crash recovery is finished and verified ([`CRASH-RECOVERY.md`](CRASH-RECOVERY.md) lists what is left); the code of conduct has a contact.
- A written 3-minute demo script and a recorded 90-second video.
- **Exit:** a stranger opens the URL and makes and exports a design in three minutes; CI is green.

**M1. Diagrams** (Phase D of the plan).
- Text inside shapes; connectors that attach to shapes and follow them (straight, elbow, curved; arrowheads; labels); a flowchart shape palette; flowchart, org-chart and swimlane templates; "Diagram from code" for Mermaid flowcharts with a live preview, scaled to the page; Copy as Mermaid; layered auto-layout.
- **Done so far (2026-11-09):** straight lines attached to shapes, with the Connect button and menu item for two selected elements (step D1a of [`PLAN-DIAGRAMS-AND-COLLABORATION.md`](PLAN-DIAGRAMS-AND-COLLABORATION.md)). Next: routes and labels (D1b), text in shapes (D1c), drawing connectors by hand (D1d), then the palette, templates and Mermaid (D2).
- **Exit:** a 20-node flowchart drawn in under two minutes; moving a box moves its lines in one undo step; a Mermaid flowchart of 100 nodes imports and lays out in under a second; export to PNG, SVG and PDF is correct; everything works from the keyboard; unit tests of the routing and layout maths, a browser journey, an accessibility pass.

**M2. Together.** The optional server, live editing, edit and view links, owner-only closure, per-user undo, same-tab reload replay and room images are implemented. The next proposals are presence, pinned comments, commenter permissions, safer same-object editing and approval tied to a specific revision. See [collaboration](COLLABORATION.md).
- SQLite, container packaging, link expiry, hosted identity and operational rollout remain planned work.
- **Exit:** two browsers edit one design live and see each other's changes in under 300 ms on a local network; a property test (random concurrent edits delivered with drops, repeats and reordering) ends with identical designs in 10,000 runs; a load test uses an explicitly raised peer limit for 200 clients in one room and a 5,000-element design; every message is validated (a fuzz test sends malformed ones); the static, serverless mode still works unchanged.

**M3. AI help** (Phase A; only if the owner accepts an optional hosted model).
- An assistant that draws a diagram from a sentence, rearranges, rewrites text and explains a design; a REST and MCP interface for outside agents, whose changes are ordinary, undoable edits that wait for a person where they delete.
- **Exit:** every tool call is validated like a remote edit; the assistant is off unless the host sets a key and can be switched off per person; no design leaves the device or server without that switch; the on-device alternatives are named.

**M4. Teams and trust.** Accounts and teams (optional), roles, an audit log, server backups and restore, single sign-on for enterprise buyers, an admin view, monitoring and a status page, a published security review. **Exit:** a team of ten can use a self-hosted instance, an admin can remove a person and their access ends at once, and data can be restored from backup.

**M5. Business.** Plans and billing, usage limits, opt-in analytics, brand kits for teams (ROADMAP 20), a templates marketplace if wanted. **Exit:** the owner can state the model, the price and the first ten customers' needs; a trial user can become a paying team without help.

**M6. Reach and scale.** Touch and phones, Firefox and Safari, languages (right-to-left, CJK, an interface in more than English), vector PDF and PPTX, performance budgets in CI, a plugin or embed API, licensed stock content. **Exit:** the browser journeys pass in Chrome, Firefox and WebKit; a phone can make a design; the 5,000-element budget holds.

**Order.** Continue reliability and deployment checks alongside M2. Prioritize collaboration and review next. Check design, reusable styles, bulk creation, campaign packs and MP4 remain proposals.

## 4. "All possible features", sorted by what they do for an investor

1. **Headline:** live multi-user editing, diagrams and flowcharts, AI help (draw, rearrange, rewrite), comments and review.
2. **Table stakes for a team product:** accounts, teams, roles and brand kits; version history (exists); PPTX and vector PDF export; importing PPTX, PDF and SVG; stock content and a template pipeline; touch and mobile.
3. **The moat:** self-hosting, offline, on-device AI, an agent interface, an embed and plugin API, accessibility.
4. **Nice to have, later:** a video and audio timeline, CMYK print, mind maps, an infinite whiteboard design type.

Anything not on this list is not "possible features" worth building before M2; say no to it, politely, in the backlog.

## 5. What an investor will ask, and the honest answers today

- *Who is it for, and why will they switch?* The working assumption in section 1; no evidence yet.
- *What have you built, and does it work?* A large, well-tested editor; no public demo; the verification record is the evidence.
- *Is it defensible?* Open source cannot be a moat by itself; the self-host, privacy, offline and on-device AI combination, a good diagram and collaboration experience, and a community could be.
- *Why now?* The owner's to answer (AI-assisted work, privacy rules, the cost of the incumbents).
- *How does it make money?* Undecided (section 6).
- *What is the cost to run?* Nothing today (a static site). Collaboration adds a server per customer or per hosted team; estimate it in M2 from the load test.
- *Who built it?* A small team with an AI assistant; say so, and show the tests, the history and the documents.

## 6. What only the owner can decide or do

Decisions: the positioning and the first audience; hosted server or self-hosted only (the plan's decision 1); links or accounts; whether hosted AI is acceptable (the stance so far is on-device only); the business model and price; the name and branding (and a trademark check); how Driftboard's code is credited and what happens to that project. Actions: put the repository on GitHub, register a domain, deploy the demo, record the video, write the deck and a simple financial model, get the legal opinion, line up the first users for feedback.

## 7. Keeping it honest

Update section 2 and the exit criteria with measured numbers as each milestone lands. Do not write a claim here that the repository cannot show. The milestone work follows the same rules as before: tests first, verification from a clean copy, the documents updated, one commit per step, and a handoff note for anything left unfinished.
