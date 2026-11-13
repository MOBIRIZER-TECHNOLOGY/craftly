# Overnight plan (night of 2026-11-13)

Written before an unattended night of work, with the four decisions the owner made beforehand. The morning report is
`docs/OVERNIGHT-REPORT.md`; it says for every item below whether it was done, how it was checked, and what was left.

## Decisions made beforehand

- **Commits.** Today's fixes go to `main`. All work of the night goes to the local branch `overnight-2026-11-13`, one commit per
  item. Nothing is pushed.
- **Server policy.** Room expiry and a key for making rooms are built but off unless the operator sets `ROOM_TTL_DAYS` /
  `ROOM_CREATE_KEY`. Without them the server behaves as before. The docs recommend values for a public server.
- **Dependencies.** No new npm packages.
- **Order.** Production readiness first (part A), then features (part B) in the order below. Items in different parts of the
  code may run side by side; an item of part B never holds back one of part A.

## Rules of the night

- Tests first, as everywhere in this project: a test that fails for the right reason, then the change.
- Every item passes types, lint, format and the tests of its area before it is committed. The full unit suite with the 95 %
  coverage gate, the build, the server build and the browser journeys run at the end of part A and at the end of the night
  (and before that whenever an item touches shared code).
- An item that cannot be finished properly is left out, not half done: its changes are taken back and the report says why.
- Nothing is pushed, published or deployed. No accounts, keys or services are created. No file outside the project is touched
  except temporary files.
- What cannot be checked on this machine is named in the report, not assumed (Firefox, Safari, a phone, a real host, load).

## Part A: production readiness

| # | Item | Done when |
| --- | --- | --- |
| A1 | Server admission control: drop a slow reader (`bufferedAmount`), a small bucket for `join`, a byte bucket beside the message bucket, a tiny message limit before the key is shown, a cap on all connections and on connections to a room that have not shown a key, one id set per batch in `applyOps` | each limit has a test with real sockets |
| A2 | Room storage: images out of the room record (one file per image, old records still read), the design stringified once per save, group commit while a save runs, a bounded queue that closes with 1013 | `sync.sim.test.ts` passes unchanged; a test shows several batches in one write |
| A3 | A slow image upload can no longer undo newer edits or bring back a deleted room (pin the room while a request is in flight; check it is still the loaded one before saving) | a test reproduces both cases first |
| A4 | Origin: with `ALLOW_ORIGIN` as a list, refuse a WebSocket upgrade and any POST / PUT / DELETE from another origin. Room creation limited per address, `TRUST_PROXY` for `X-Forwarded-For` | tests for each |
| A5 | Expiry: rooms unused for `ROOM_TTL_DAYS` are removed by a sweep (off by default) | tests with a fake clock |
| A6 | Storage errors are logged and answered as errors, not as "not found"; shutdown has a deadline and an error handler; `/api/health` does not write for every request | tests |
| A7 | `ROOM_CREATE_KEY` (off by default): the server refuses to make a room without it; the Share panel has a field for it | server tests, panel tests, the live journey still passes |
| A8 | Operator tools: list and delete rooms (a script over the storage folder and an endpoint behind `ADMIN_KEY`) | tests |
| A9 | Live elements are checked as strictly as elements of a file; `seqs` of a room record no longer grows for ever | tests |
| A10 | Deployment: Dockerfile for the live server, a deploy guide, a metrics endpoint, CI builds and starts the server bundle, actions pinned to commit SHAs | the bundle starts and answers `/api/health` in a test; the Dockerfile is written but cannot be built here if Docker is not installed |
| A11 | Client security left over: uploaded SVG files are checked before they are stored (review finding 13), a `<meta>` Content-Security-Policy fallback for hosts that ignore `_headers`, a warning when the server listens on all addresses without TLS in front | tests; the journeys pass under the policy |
| A12 | The production-build journeys (`offline.cjs`, `update.cjs`, the whole set with `OFFLINE=1` under the enforced policy) are run and what they find is fixed | the run is in the report |

## Part B: features (most valuable first)

| # | Item | Notes |
| --- | --- | --- |
| B1 | Working together: see the others' pointers and selections, with a name and a colour each | presence messages are not stored |
| B2 | Working together: two people typing in one text box no longer lose one side's text | the known last-writer-wins loss |
| B3 | Comments: pin a comment to a place on a page, reply, resolve; shared in a live session | stored with the design |
| B4 | Touch: pinch to zoom and two-finger pan on the canvas | tested with synthetic pointers; no phone here |
| B5 | PDF with real text: selectable and searchable text over each page | within the existing PDF writer, no new package |
| B6 | Print: bleed and crop marks in the PDF | |
| B7 | Dragging stays smooth on heavy pages: measure first, then repaint only what changed | a measurement before and after in the report |
| B8 | SVG import as editable shapes and paths | a known limitation |
| B9 | Custom fonts: upload a font to the brand kit and use it in text and exports | |
| B10 | Export several sizes at once (one design, a set of sizes, one ZIP) | |
| B11 | Backup: a reminder when the last backup is old, and saving to a chosen file | a known limitation |
| B12 | Tables and charts from data: paste or import CSV | |
| B13 | Present as a file: a self-contained HTML presentation for people without Craftly | |
| B14 | The Pen from the keyboard | a known limitation |
| B15 | Text to points: turn a text into editable paths | a known limitation |
| B16 | Templates: 30 more original ones in the thin categories | content |
| B17 | Interface translation: the framework and one more language | large; last |
| B18 | Edge: the browser journeys run in Edge too, and what differs is fixed | the only other browser installed here |

Not possible unattended, and so not in the plan: accounts and sync between devices (needs a backend service and decisions about
data), a library of real stock photos (licences), payments, publishing to a host, pushing to GitHub (no sign-in on this machine),
testing in Firefox or Safari or on a phone, a load test against a public server.
