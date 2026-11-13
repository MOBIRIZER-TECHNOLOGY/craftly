# Report of the night of 2026-11-13

What was done of `docs/OVERNIGHT-PLAN.md`, how it was checked, and what is left. Everything is on the local branch
`overnight-2026-11-13` (36 commits on top of `main`, 219 files, about 27,900 lines added). Nothing was pushed, published or
deployed, and `main` was not touched after the commit of the day's fixes.

## In one paragraph

The live server is hardened except for one part (grouping several edits into one write), it has a Dockerfile, a deploy guide,
metrics and operator tools, and 15 of the 18 planned features are built. The whole branch passes types, lint, format, the unit
suite with the coverage gate, the build, the server build, and every browser journey on the dev server (234 checks) and on a
production build under its Content-Security-Policy with the offline and update journeys (250 checks). Much of the new interface
was never looked at by a person or used on real hardware: read "What nobody has seen" before you rely on it.

## Checks at the end of the night

| Check | Result |
| --- | --- |
| Types, lint, format | pass |
| Unit tests | 9,187 of 9,187 in 395 files (7,934 before the night) |
| Coverage (gate 95 %) | statements 99.15 %, branches 97.09 %, functions 99.5 %, lines 99.71 % |
| Build, server build, `npm run server:smoke` | pass (the clean-exit check of the smoke test cannot run on Windows) |
| Browser journeys, dev server, Chrome | 234 of 234 |
| Browser journeys, production build under the policy, `OFFLINE=1`, with `offline.cjs` and `update.cjs` | 250 of 250 |
| Browser journeys, dev server, Edge | 234 of 234 |

The first full run found one failure in 9,187 tests: a new stylesheet coloured a message with the red that is kept for fills.
It is fixed (`34f96a2`). A second full run had two timeouts in the tests of combining shapes, the same two that timed out once
the day before: the geometry library loads on first use, and with every worker busy that load alone took longer than the 30
seconds one test may take. Both files now load it before their tests, and the third run passed whole. The journeys ran before
that last change, which touches two test files only.

## Part A: production readiness

| # | Item | State | Commit |
| --- | --- | --- | --- |
| A1 | Admission control: slow reader, join bucket, byte bucket, limit before the key, connection caps, one id set per batch | done | `263438f` |
| A2 | Storage: design stringified once, images out of the room record (old records are moved on their first save) | done | `e3bcc94` |
| A2 | Storage: group commit and a bounded queue | **not done** | |
| A3 | A slow upload cannot undo edits or bring back a deleted room | done | `581da9a` |
| A4 | Origin checks; room creation limited per address; `TRUST_PROXY` | done | `5c88dfd` |
| A5 | Expiry with `ROOM_TTL_DAYS` (off by default) | done | `10ac4dc` |
| A6 | Storage errors are errors, not "not found"; shutdown deadline; health without a write per request | done | `6dbef88` |
| A7 | `ROOM_CREATE_KEY` (off by default) and its field in the Share panel | done | `e71c322` |
| A8 | Operator tools behind `ADMIN_KEY`: list and delete rooms, `npm run server:rooms` | done | `30cd7a7` |
| A9 | Live elements checked as strictly as files; `seqs` bounded | done | `fc87762` |
| A10 | CI builds and starts the server; actions pinned to SHAs; Dockerfile and `docs/DEPLOY.md`; metrics behind `METRICS_KEY` | done | `2d62dd7` `fcbfe82` `831b7aa` `2a0fb0b` |
| A11 | Uploaded SVG checked (or stored as a picture); `<meta>` policy in production builds; warning when listening publicly | done | `8e7d794` `45a95d6` `e02a3ac` |
| A12 | Production-build journeys run | done | (table above) |

**Group commit was left out on purpose.** It changes how a room publishes edits, and a mistake there loses people's edits; the
agent could not prove it correct in the time and did not start it. Every edit still writes the whole design (without the
images now) and flushes. This is the remaining cost under load.

## Part B: features

| # | Item | State | Commit |
| --- | --- | --- | --- |
| B1 | See the others: pointers, selections, names, a list of who is here | done | `ac7d991` |
| B2 | Two people in one text box: one person at a time types (an advisory lock through presence) | done, as a lock, not a merge | `dc2a59c` |
| B3 | Comments | **not started** | |
| B4 | Pinch to zoom and two-finger pan | done | `4e29bcc` |
| B5 | PDF with selectable, searchable text (an invisible layer over the page image) | done | `16dbcb2` |
| B6 | Bleed and crop marks in the print PDF | done | `7b68e6f` |
| B7 | Drag performance: measured, then only what moves is repainted | done | `dafb7a6` `02df22a` |
| B8 | "Convert to shapes" for graphics and uploaded SVG | done | `5297d88` |
| B9 | Upload your own fonts | done | `6aae811` |
| B10 | Several sizes in one ZIP | done | `f9ecf56` |
| B11 | Backup reminder; keep a chosen backup file up to date | done | `29eb571` |
| B12 | Tables and charts from pasted or imported data | done | `66c149a` |
| B13 | Download as a web page (a self-contained slideshow) | done | `384a1dc` |
| B14 | The Pen from the keyboard | done | `1fa8fb0` |
| B15 | Text to points | **not started** |  |
| B16 | 30 more templates (102 templates, 175 pages) | done | `f854df5` `30c5eba` `c1c98a8` |
| B17 | Interface translation | **not started** | |
| B18 | Journeys in Edge | done: all 234 pass, nothing had to be fixed | |

Why three were not started:

- **Comments (B3)** need a decision first. New kinds of operation are refused by an older server and end the session of an
  older browser; putting the comments through the existing "design" operation would lose comments made at the same moment.
  Somebody has to choose how old and new versions meet before this is built.
- **Text to points (B15)** needs the outlines of the letters, which a browser does not hand out and which no installed package
  reads. With "no new packages" it cannot be done.
- **Translation (B17)** touches every screen. It was last in the plan and the night ended before it.

The measurement of B7, on a production build (median / 95th percentile of a frame in ms; 18.0 is the floor of this machine):

| Page | Before | After |
| --- | --- | --- |
| 150 text boxes | 53.2 / 107.5 | 18.0 / 18.2 |
| 40 filtered photos and 100 shapes | 36.0 / 143.1 | 18.0 / 18.1 |
| 60 blended shapes | 36.0 / 72.0 | 18.0 / 18.2 |
| 300 shapes | 18.0 / 36.1 | 18.0 / 18.2 |

## Decisions that were made for you, and that you may want to change

1. **One finger no longer scrolls the canvas on a touch screen** (B4). It selects and drags; two fingers move the view.
2. **An SVG upload with styles, comments or an XML declaration becomes a PNG picture** (A11), because the strict check that
   keeps scripts out refuses those too. Most SVG files from design tools carry styles, so most uploads of that kind will no
   longer be vectors, and "Convert to shapes" (B8) will not be offered for them.
3. **A room forgets a client that stayed away for 30 days** (A9). To stay safe against applying a batch twice, an edit that
   such a client had sent and that was never applied is dropped when it comes back. A browser running older code, in a room
   that has forgotten somebody, can lose edits it made before its first welcome.
4. **A room that already holds a damaged element can no longer be joined** (A9). Only a tampered editor could have made one.
5. **During a drag, elements above the dragged one may differ by 1 or 2 levels of 255 on soft edges** (B7). The picture at
   rest and every export are unchanged.
6. **The text lock is advisory and covers text boxes only** (B2), not tables or charts. When two people open one box at the
   same instant the server lets the first one keep it; what the second typed until then is replaced by the holder's next key.
7. **The key for making rooms is not remembered** by the editor (A7); it is typed each time.
8. **With crop marks the PDF page grows by 27 pt on each side** beyond the bleed (B6), because the marks have to sit somewhere.
9. **Custom fonts are stored in the existing `meta` store** (B9), not in a store of their own, so the database version did not
   change. Font files are not sent to collaborators: they see a substitute and are told which font is missing.
10. **Every production build now carries the Content-Security-Policy in a `<meta>` tag** (A11). A site that uses a live server
    must build with `VITE_CRAFTLY_CSP_CONNECT` naming that server, or the editor cannot reach it.

## What nobody has seen

The checks above are tests and scripted browsers. These were not looked at or used by a person, or need hardware or software
this machine does not have:

- **No PDF reader opened a PDF of the night.** That the text can be selected where it is drawn, that the fonts are accepted, and
  how the crop marks look rest on the PDF specification and the tests' own parser. Open one PDF in a reader before you rely on
  B5 and B6. Nothing was printed.
- **No touch screen.** Pinch and two-finger pan were driven with made-up pointer events.
- **No real font file, no real "Save as" picker, no real spreadsheet clipboard, no real SVG from Illustrator, Figma or
  Inkscape.** B9, B11, B12 and B8 were tested against stand-ins (B8 was compared pixel by pixel for all 161 built-in
  illustrations in Chrome; 153 differ in under 0.2 % of pixels).
- **The Docker image was never built** (Docker is not installed). The Dockerfile was checked by hand, step by step, outside a
  container.
- **No reverse proxy, no Prometheus, no load.** Origin checks, `TRUST_PROXY`, the metrics format and every limit were tested
  with real sockets on this machine, not behind a proxy and not under load.
- **The new panels and dialogs were mostly not looked at**: the comments above about looks, contrast and focus come from tests.
  The templates were seen rendered small (230 to 520 px wide), never at full size, and their invented names were not searched
  against trademarks.
- **Two real browsers side by side** were used for presence and the text lock only inside the scripted live journey.
- **Firefox, Safari, a phone, a screen reader**: not available here.

## Things that went differently than planned

- Agents committed their own items by path. `README.md` and `CHANGELOG.md` were edited by several at once, so some commits
  carry a neighbour's lines of those two files. The content at the tip of the branch is right; the history of those two files
  is not tidy. No source file was mixed up this way.
- One commit (`f9ecf56`) has a byte-order mark at the start of its subject line.
- One agent ran `npx vite-node` for a scratch script, which put that package into npm's cache on this machine. `package.json`
  and the lockfile are unchanged, and the project gained no dependency.
- One agent tried to open a PDF in the Browser pane, which showed a save dialog on the screen. If it is still open, cancel it.
- An existing test with a 40 ms heartbeat failed once on the busy machine; it now uses 150 ms.
- A first frame of 50 to 430 ms at the start of most drags was seen before and after the performance work; its cause was not
  found.

## What to do in the morning

1. Read "Decisions that were made for you" and say which to change.
2. Try the new things by hand in the editor, above all the PDF in a reader, an SVG upload, a font upload, and two browser
   windows in a live session.
3. To take the work: `git switch main` and `git merge overnight-2026-11-13`. To drop one item: `git revert <its commit>`.
4. Still open after this night: group commit on the server, comments, text to points, translation, a merge (not a lock) for
   text edited by two people, CMYK, accounts and sync, real stock photos, Firefox and Safari, a load test, pushing to GitHub
   (this machine has no sign-in, and git has no name and email set: the commits use the author of the earlier ones).
