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

## Checked again on the morning of 2026-11-14

After the branch was merged into `main`, everything was run again on `main`, with a freshly started dev server.

| Check | Result |
| --- | --- |
| Types, lint, format | pass |
| Build, `npm run server:smoke` | pass |
| Browser journeys, dev server, Chrome | 234 of 234 |
| Editing together, by hand as four people (below) | 22 of 22 steps |
| Unit tests | **no clean full run this morning** (see below) |

**The unit suite.** The first run of the morning passed 9,186 of 9,187. Every run after it failed in other places, and of those failures all but one were tests that ran out of their 30 seconds: the last run had 6 timeouts and no failed assertion. The laptop was running at about a quarter of its speed while the tests ran (Windows reported "% Processor Performance" of 24 to 27, with its own limit at 100, so the slowing came from the hardware; heat after a night of load is the likely cause, and the temperature could not be read without administrator rights). A suite that took 12 minutes in the night took 13, then 24, then longer. Two tests were found that could fail on a slow machine for a reason of their own, and were corrected:

- `EmojiApp.test.tsx`, "adds a found emoji like any other": the search waits 100 ms after the last key, and when the keys came slower than that the test clicked a cell of the list for a half-typed word, which was replaced before the click arrived. It waits for the list of the whole word now. This test had failed once on each of the two days before.
- `PageView.test.tsx`, "paints at the device pixel ratio": it waited for the first call to the canvas and then asked about the placing of the page, which comes a moment later. It waits for the placing now. Two agents had seen it fail once in the night.

Later that morning, after a rest, the machine was no faster under load (24 % again). The suite with the coverage gate failed 9 of 9,187 tests, every one by its time limit and none by an assertion; run alone with more time, those tests passed. Then the whole suite was run with longer time limits (`npx vitest run --maxWorkers=3 --testTimeout=300000 --hookTimeout=300000`, the code unchanged): **all 9,187 tests in 395 files passed**, in 32 minutes, with no timeout and no failed assertion. That run does not measure coverage; the coverage figures above are those of the night, on the same code but for the two tests. A run of the suite as CI runs it, with its usual time limits, is still owed on a machine at its normal speed.

**Editing together, tried by hand as four people.** Four separate browser profiles against the real server: Ann and Bob with the edit link, Cat with the view link, Dev joining late. After every action the whole design of each person was compared with the others', and the screenshots of each window were looked at. All 22 steps passed, with no error in any console:

- joining by the edit link and by the view link; adding boxes and a text; typing with the keyboard
- two people changing different properties of one element at the same moment (both kept), and the same property (everybody ends with one value, the later one)
- resizing while the other turns; deleting, undo of one's own change only
- a second page, its background, and edits to two pages at once; grouping by one and moving the group by the other; the title
- the viewer trying to change something (nothing changes for anybody)
- pointers, names, selection outlines and the list of who is here
- a text box that one person is typing in refused to the other, with a message, and opened once the first is done
- 40 quick changes each from two people at once
- the server stopped and started again in the middle, with edits made meanwhile
- a reload, a fourth person joining late, and stopping to share

Not shown by it: one person offline while the others stay connected (the tool that was to cut one person's network left the connection open, so that step proved nothing; reconnecting is shown by the restart of the server); more than four people; a slow network; a server on the internet. The loser of two changes to the same property at the same moment is not told.

## Part A: production readiness

| # | Item | State | Commit |
| --- | --- | --- | --- |
| A1 | Admission control: slow reader, join bucket, byte bucket, limit before the key, connection caps, one id set per batch | done | `263438f` |
| A2 | Storage: design stringified once, images out of the room record (old records are moved on their first save) | done | `e3bcc94` |
| A2 | Storage: group commit and a bounded queue | done on 2026-11-15, after the night; a group too large is saved one edit at a time since 2026-11-16 | `302211a` `5bf1fc9` |
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

*Since then (2026-11-15 and 16):* group commit was built (`302211a`), and corrected the next day (`5bf1fc9`): the size limit
was checked once for the whole group, so an edit that fit was refused when another came with it. A group refused for its
size is now saved one edit at a time, and only the edit that does not fit is refused. It has still not been measured under load.

## Part B: features

| # | Item | State | Commit |
| --- | --- | --- | --- |
| B1 | See the others: pointers, selections, names, a list of who is here | done | `ac7d991` |
| B2 | Two people in one text box: one person at a time types (an advisory lock through presence) | done, as a lock, not a merge | `dc2a59c` |
| B3 | Comments | done on 2026-11-14, after the night | `dad4097` |
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
| B15 | Text to points | done on 2026-11-15, after the night, with fontkit 2.0.4 (committed on 2026-11-16) | `4b16eb1` |
| B16 | 30 more templates (102 templates, 175 pages) | done | `f854df5` `30c5eba` `c1c98a8` |
| B17 | Interface translation | **not started** | |
| B18 | Journeys in Edge | done: all 234 pass, nothing had to be fixed | |

Why three were not started in the night (B3 and B15 were built after it, see the table; B17 is the one still open):

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

## Checked again on 2026-11-16, before the push

Group commit, comments and text to points were done by then (see the tables), and `main` was pushed to GitHub on 2026-11-16
(44 commits, ending at `5bf1fc9`). Run on `main` at that commit, on the same slowed laptop:

| Check | Result |
| --- | --- |
| Types, lint, format | pass |
| Unit tests, with `--maxWorkers=3 --testTimeout=300000 --hookTimeout=300000` | 9,423 of 9,423 in 405 files, in 17 minutes |
| Build, `npm run server:smoke` | pass |
| Browser journeys, dev server, Chrome | 232 of 234 |
| Browser journeys, production build under the policy, `OFFLINE=1`, `LIVE_PORT=8788` | 248 of 250 |

The four failed journey checks are the same two in both runs: the WebM download and Cancel of `animated-export.cjs`. Chrome
157 on this laptop records nothing from a canvas: a page with only a coloured canvas and `MediaRecorder`, without Craftly,
got no data and no error, headless and in a window. The video code has not changed since the first commit; CI is the next
place to see these two pass. With the usual 30-second limits the unit suite still fails here on time alone.

Still open: translation (B17), a merge (not a lock) for text edited by two people, CMYK, accounts and sync, real stock
photos, Firefox and Safari, a load test of group commit, the video journey on a machine whose Chrome records, and for text to
points a real uploaded font and a screen reader.
