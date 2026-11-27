# Craftly 1.0: release notes (draft)

A draft for the first release, made from the Unreleased sections of [`CHANGELOG.md`](../CHANGELOG.md), which has every detail
and how each part was checked. The version number, the date and the wording for the announcement are for whoever publishes it.
Nothing here is released yet.

## For the people who design

**Design anything in the browser.** Templates and design types for social posts, presentations, posters, print and more; text
with every weight of a font, spell-check when asked for, text converted to shapes; pictures in any shape of frame, with
straightening, crop to a shape and adjustments; tables with merged cells; charts (bars, lines, areas, scatter, shares of 100 %);
lines between shapes that follow them; margins, a grid, equal gaps, Smart resize, and editing inside a group; links on any
element; Check accessibility; Bulk create, a design for every row of a spreadsheet, with pictures.

**Video.** A clip is an element like any other: trim, crop, filters, volume and fades, a start time, play once or loop, captions
typed or read from a subtitle file, in any font and colour. A timeline under the page holds up to twelve rows of clips and
sounds, with transitions and Split; a clip can run on under the pages after its own, and sounds can span pages. Record from the
camera, the microphone or the screen in Uploads. Download an MP4 with sound, up to ten minutes at 1080p.

**Present.** Transitions and animations, auto-play, a presenter window with notes, a clock and a pointer; a clip carried across
pages keeps the presenter's pace.

**Work together.** Share a live link to edit with others, see where they are, and comment: pin a note to a place, answer it,
resolve it. With an account, designs sync between devices, and a team shares a space of designs that its members edit live
without a link. A clip or a picture added in a team's live room reaches the team's space.

**Download.** PNG, JPEG, SVG, PDF (with bleed, registration marks and CMYK for a print shop), PowerPoint with text and shapes
that can be edited, and video. A first PowerPoint import.

**On every device, in two languages.** The editor works on phones and tablets, and in English and Hindi. It keeps working
offline, and everything stays on the device unless the person shares or signs in. The AI photo tools (background removal,
upscaling) download their model once, with permission, and run on the device.

## For whoever runs the live server

The editor is static files on any host; the live server, for sharing and accounts, is optional
([`docs/DEPLOY.md`](DEPLOY.md)).

- **A container image**, built for amd64 and arm64 by CI and published on a version tag, running as a user of its own and writing
  its files for that user only. Compose files for running it behind Caddy or nginx with TLS are in `deploy/`.
- **Backups** with the documented commands were rehearsed: a server with accounts was restored into a new volume, whole.
- **Monitoring:** Prometheus metrics behind a key, and nine alert rules with tests (`deploy/prometheus/`).
- **Checks from outside:** `scripts/live-check.mjs` checks any running server; `scripts/live-load.mjs` load tests one.
- **Capacity:** one CPU carried about 1,000 people all busy at once, with edits acknowledged in about 0.1 s
  ([`docs/PERFORMANCE.md`](PERFORMANCE.md)).
- **Hardened by a security review:** no way around the keys or sessions was found. The denial-of-service findings were fixed: a
  costly batch of edits is refused, uploads reserve their size before they are received, and connections are limited per
  address. Pictures in rooms are now checked as those in spaces are, and team comments are signed with their author's account.
  For a server open to the internet, set `ROOM_CREATE_KEY` and `ROOM_TTL_DAYS`; the server says so at start when they are not set.

## Known limits

- A video download with a clip that has a transparent background is slow: about 3 frames a second, ten minutes for a minute of
  video. Clips from cameras and phones are not affected.
- A video download is at most ten minutes long.
- Under a sign-in flood from many addresses, sign-ins can be answered "busy" for a while.
- The open-source licences are published with the site (About Craftly, "Open-source licences").

## Not checked before this release

These need people, devices or accounts that the work so far did not have: Safari on a Mac, iPhone and iPad; Firefox on Android
and real phones in general; exported decks opened in PowerPoint; a native Hindi speaker's review; an outside security review; a
load test on the production machine; a privacy policy and terms; a licence review by a lawyer; a real domain with its TLS
certificate; and the CI workflows on GitHub, which have not run because the branch has not been pushed.
