# From launch-ready to world class: the task list

Written 2026-11-28, after the launch work in pull request #15. It takes what [`TODO.md`](TODO.md), [`ROADMAP.md`](ROADMAP.md),
[`INVESTOR-READINESS.md`](INVESTOR-READINESS.md) and the two comparison reports in `reports/` say is missing, adds what the
launch work found, and puts it all in one order: each phase is worth finishing before the next is started.

"World class" here means three things a stranger can check: it never loses work and never feels slow; the first ten minutes
make something good without help; and it does what people come from Canva or Figma expecting, with Craftly's own reason to
exist on top (private by default, offline, self-hosted, AI on the device).

Each line says who can do it:

- **[here]** can be built and tested in this repository with no outside help.
- **[people]** needs a person, a device, an account or a service.
- **[decision]** is the owner's to decide before anyone builds it.

Sizes are judgement, not measured: **S** is days, **M** one to four weeks, **L** more than a month.

## Phase 0. Launch (the next two weeks)

Nothing in later phases matters until real people can use it safely.

- [ ] Merge #9 and #15 into `main` once CI is green; tag `v1.0.0` so the image is published. [people] S
- [ ] Deploy the editor and the live server on a real domain with TLS, following `docs/DEPLOY.md` and `deploy/`. [people] S
- [ ] A load test on the production machine with `scripts/live-load.mjs`, and alerts wired to someone's phone. [people] S
- [ ] Safari on a Mac, iPhone and iPad; Firefox on Android; two real mid-range Android phones. Fix what they find. [people] then [here] M
- [ ] An outside security review (penetration test) of the live server and accounts. [people] M
- [ ] A privacy policy and terms; a lawyer's view of the licences and of the look and feel next to Canva. [people] M
- [ ] A native Hindi speaker reviews the whole interface. [people] S
- [ ] Open exported decks in PowerPoint, Keynote and Google Slides, and a print PDF at a print shop. [people] S
- [ ] Where problem reports go (`VITE_CRAFTLY_REPORT_URL`) and who reads them. [decision] S
- [ ] A landing page, a 3-minute demo script and a 90-second video. [here] for the page, [people] for the video. S

## Phase 1. The quality bar: nothing lost, nothing slow, nothing confusing

People forgive a missing feature. They do not forgive lost work or a tool that stutters.

**Reliability**
- [ ] Two people typing in the same text box at once: merge the letters instead of the last one winning (`COLLABORATION.md`). [here] M
- [ ] Each person joining a room is sent the whole design, re-written each time: send a cached copy, then only changes. [here] S
- [ ] Sign-in hashing has one shared queue, so a flood of sign-ins can make real ones answer "busy": a queue per address. [here] S
- [ ] Version history people can see: named versions, compare two, restore one, for local designs as well as synced ones. [here] M
- [ ] A crash-free rate measured from the opt-in problem reports, with a target (99.9 % of sessions). [decision] then [here] S

**Speed**
- [ ] Performance budgets checked in CI: start-up, a 5,000-element design, a drag at 60 frames a second, and the bundle's size. [here] M
- [ ] Zoom and pan without repainting everything (ROADMAP 13). [here] M
- [ ] The same budgets measured on a mid-range phone. [people] S
- [ ] Video download with a transparent clip: about 3 frames a second today; decode such clips with WebCodecs instead. [here] M

**First use and finish**
- [ ] The first ten minutes: watch five people who have never seen Craftly make something, and fix every place they stop. [people] then [here] M
- [ ] Empty states, error messages and confirmations written to one standard; one pass over all of them. [here] S
- [ ] A design-system pass over the interface: spacing, type sizes, icons and motion made consistent. [here] M
- [ ] A help centre: short how-to pages linked from the editor's Help menu. [here] M
- [ ] Accessibility with real assistive technology: NVDA, VoiceOver on Mac and iPhone, TalkBack; keyboard-only use of every panel. [people] then [here] M

## Phase 2. What people expect when they come from Canva or Figma

In the order people will ask for them.

**Content** (the biggest gap people notice)
- [ ] A content pipeline: templates made, checked and added without a code change, with tags and search. [here] M
- [ ] Many more templates, in the most-used formats (social posts, presentations, documents, print). [people] for the design work. L
- [ ] Licensed stock photos, illustrations, icons and music, or an outside library with an API. [decision] [people] M
- [ ] Fonts for other scripts (Devanagari first, given the Hindi interface; then Arabic, CJK), each licence checked. [here] M

**Editing**
- [ ] Right-to-left and mixed-direction text in layout, the caret, selection and the PDF. [here] L
- [ ] PDF import (pdf.js, a new dependency). [decision] then [here] M
- [ ] PDF export as vector pages with embedded fonts, tags and alternative text. [here] L
- [ ] PowerPoint export, the rest: irregular shapes and lines as native objects. [here] M
- [ ] Mockups: a design drawn into a scene with perspective. [here] M
- [ ] A heal and clone brush, without a model. [here] M
- [ ] A whiteboard: a canvas without a fixed page, sticky notes, the diagram tools that exist. [here] L

**Teams**
- [ ] The commenter role, mentions and approval tied to the content (open pull request #14: review and finish it). [here] M
- [ ] Notifications by email for mentions, comments and shares. [people] for the mail service, [here] for the rest. M
- [ ] Brand: several kits, brand templates, locked elements, an approval step. [here] M
- [ ] Publish a view-only page of a design from the live server: a link anyone can open, with no account. [here] M

## Phase 3. AI that respects privacy (the reason to choose Craftly)

The on-device photo tools exist. Each of these needs a model, so each starts with a licence check and a size the browser can
carry ([`ON-DEVICE-AI.md`](ON-DEVICE-AI.md)).

- [ ] Magic eraser and click-to-select (MI-GAN or LaMa, SlimSAM or EdgeTAM), after a ruling on the weights' licence. [decision] then [here] M
- [ ] Automatic captions for clips with a Whisper model on the device. [here] M
- [ ] Alternative text for pictures written by a small vision model, to feed Check accessibility. [here] M
- [ ] An assistant that writes and rewrites text, translates a design and builds a first draft from a sentence: with the user's
      own key for a hosted model, or a local model server. Which providers, and whether Craftly ever pays for one. [decision] then [here] L
- [ ] An evaluation set for every AI feature, run in CI, so a new model can be compared with the old one. [here] M

## Phase 4. A product people can buy

- [ ] The business model: open source plus hosted plans, paid self-hosting support, or both. [decision]
- [ ] A hosted Craftly: sign-up, plans, billing, usage limits, deleting an account and exporting everything (GDPR). [here] L, [people] for payments
- [ ] For organisations: single sign-on (SAML and OIDC), an admin console, an audit log, data kept in a chosen region. [here] L
- [ ] A plug-in API: apps in a sandboxed frame talking to the editor through the store's actions; then a public API. [here] L
- [ ] Integrations people use every day: Google Drive, Dropbox, Slack, and posting to social networks. [people] for each account. M
- [ ] Opt-in, privacy-preserving product analytics, so decisions rest on numbers. [decision] then [here] S
- [ ] Apps in the stores (the PWA wrapped, or native): developer accounts, signing, review. [people] M

## Phase 5. Running it as a world-class service

- [ ] Service levels written down (uptime, how fast a problem is answered) and a public status page. [decision] [people] S
- [ ] An on-call rota, an incident process and a review after each incident. [people] S
- [ ] Backups made automatically, kept off the machine, and a restore rehearsed every month. [people] S
- [ ] A security programme: a bug bounty or a disclosure address that someone reads, dependency updates merged weekly,
      a penetration test every year. [people] S
- [ ] A release rhythm: a version every two weeks, release notes, and a staging server that each release passes through. [people] S
- [ ] A community: the repository public, issues triaged, a roadmap people can vote on. [decision] [people] S

## Where to start

The first lines of Phase 1 that are **[here]** can start now, while Phase 0's **[people]** lines are being done: the join copy
and the sign-in queue (both small, and found by the security review), then the performance budgets in CI, then merging text
typed at once. Phase 0 still decides the launch date; nothing in Phase 1 is a reason to wait for it.
