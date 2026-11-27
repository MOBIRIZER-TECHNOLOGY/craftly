# Performance: dragging on heavy pages

Measured on 2026-11-14 with `e2e/perf-drag.cjs`, before and after the change described below. This page holds the numbers,
how they were taken, where the time went and what is still open.

## The claim that was tested

An architecture review, made by reading the code, said that every pointer move of a drag runs the whole commit pipeline and
repaints the whole page, with nothing left out and nothing kept. Measured, that was **true for the repaint and wrong for the
commit**:

- **The repaint: true, and it was the cost.** Every move of a drag changed the document, and the page canvas was then painted
  from nothing: 450 canvas calls for 300 shapes, 3,625 for 150 text boxes. On top of that the page strip painted its thumbnail of
  the page again (the whole page once more, on a small canvas) up to every 400 ms during the drag.
- **The commit: not a problem.** The pointer listeners (the store commit with Immer, text boxes, attached lines, snapping) took
  0.3 to 2.8 ms a move at the median on a production build, also with 60 attached arrows. The script that runs outside the
  listeners and the repaint (what React renders after a move, mostly) took 0 to 5 ms a repaint. Neither was changed.

## The machine

| | |
| --- | --- |
| CPU | Intel Core i5-8300H, 2.3 GHz, 4 cores, 8 threads (a laptop of 2018) |
| GPU | Intel UHD Graphics 630 (driver 31.0.101.2140), used by Chrome through ANGLE / Direct3D 11 |
| Memory | 16 GB |
| System | Windows 11 |
| Browser | Chrome 157.0.8103.79, a window of 1440 x 900 at device pixel ratio 1 |
| Build | production (`npx vite build` with `VITE_EXPOSE_STORE=1`, served by `vite preview`); "before" is the same code with the two changes switched off, built the same way |

Other programs were running tests on the machine at the same time, so single numbers are noisy: every row is three drags, the
table gives the median of the three, and the two builds were measured one after the other.

## How it is measured

The script opens a new presentation (1920 x 1080), fills the page through the store and drags the element on top with the real
pointer along a figure of eight: 120 pointer moves, sent on a clock at 60 a second without waiting for the page (a mouse does
not wait either). In the page it records:

- **Frame**: the time from one animation frame to the next, between frames that repainted the page. 16.7 ms is 60 frames a
  second. This Chrome ticks every 18.0 ms when driven this way, which the page with one shape shows: **18.0 is the floor**, and
  36 or 54 means that one or two frames were missed.
- **Paint**: the time inside the animation-frame callbacks of a frame (the canvas repaint is one of them). This is script time
  only; the graphics process then has to draw what the calls asked for, which shows in the frame time, not here.
- **Main thread per repaint**: Chrome's own count of task time (CDP `Performance.getMetrics`) over the drag, divided by the
  repaints.
- **Canvas calls**: `fill`, `stroke`, `fillText`, `drawImage` and the like, counted per repaint of the page, and counted apart
  for canvases smaller than the page canvas (thumbnails).
- **Long tasks**: tasks over 50 ms, in the three drags together.
- **The picture**: the last frame of the drag against the page after the pointer is let go at the same place, pixel for pixel.

The pages: (1) one shape, as the floor of the measurement; (2) 300 shapes, a third of them turned, half with an outline;
(3) 150 text boxes of four wrapped lines; (4) 40 photos with filters, rounded corners and shadows, and 100 shapes, a third with
shadows; (5) 60 large shapes with ten different blend modes, the dragged one too; (6) 120 boxes and 60 arrows attached to them,
four of them to the box that is dragged. Each at 100 % and at the zoom that fits the page (46 %).

## Before and after

All times in ms, "before → after".

### Headless

| Page | Zoom | Frame median | Frame p95 | Paint per frame (median) | Main thread per repaint | Canvas calls per repaint | Thumbnail canvas calls per drag | Long tasks in 3 drags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 shape (the floor) | 100 % | 18.0 → 18.0 | 18.2 → 18.2 | 0.2 → 0.2 | 5.6 → 3.8 | 3 → 3 | 24 → 0 | 0 → 0 |
| 1 shape (the floor) | fit, 46 % | 18.0 → 18.0 | 18.2 → 18.2 | 0.1 → 0.1 | 3.4 → 3.0 | 3 → 3 | 20 → 0 | 0 → 0 |
| 300 shapes | 100 % | 18.0 → 18.0 | 18.2 → 18.2 | 3.4 → 0.2 | 8.8 → 4.1 | 450 → 3 | 2255 → 0 | 0 → 0 |
| 300 shapes | fit, 46 % | 18.0 → 18.0 | 36.1 → 18.2 | 3.7 → 0.2 | 11.5 → 5.9 | 450 → 3 | 2255 → 0 | 0 → 0 |
| 150 text boxes | 100 % | 18.2 → 18.0 | 71.2 → 18.1 | 18.2 → 0.4 | 30.6 → 4.5 | 3625 → 27 | 18130 → 0 | 7 → 0 |
| 150 text boxes | fit, 46 % | 53.2 → 18.0 | 107.5 → 18.2 | 28.1 → 0.4 | 52.0 → 4.3 | 3625 → 27 | 18130 → 0 | 21 → 0 |
| 40 photos + 100 shapes | 100 % | 18.1 → 18.0 | 88.0 → 18.1 | 3.4 → 0.2 | 11.7 → 3.4 | 218 → 4 | 1843 → 0 | 0 → 0 |
| 40 photos + 100 shapes | fit, 46 % | 36.0 → 18.0 | 143.1 → 18.1 | 5.7 → 0.2 | 22.7 → 4.4 | 218 → 4 | 1843 → 0 | 1 → 0 |
| 60 blended shapes | 100 % | 54.9 → 18.0 | 109.0 → 18.2 | 15.0 → 0.3 | 34.7 → 4.2 | 182 → 5 | 315 → 0 | 2 → 0 |
| 60 blended shapes | fit, 46 % | 36.0 → 18.0 | 72.0 → 18.2 | 7.4 → 0.3 | 16.9 → 4.4 | 182 → 5 | 378 → 0 | 0 → 0 |
| 120 boxes + 60 arrows | 100 % | 18.0 → 18.0 | 18.2 → 18.2 | 1.7 → 0.3 | 6.5 → 5.6 | 241 → 12 | 1452 → 0 | 0 → 0 |
| 120 boxes + 60 arrows | fit, 46 % | 18.0 → 18.0 | 18.2 → 18.2 | 2.0 → 0.3 | 8.2 → 4.4 | 241 → 12 | 1210 → 0 | 0 → 0 |

### Headed (a window on the screen)

| Page | Zoom | Frame median | Frame p95 | Paint per frame (median) | Main thread per repaint | Long tasks in 3 drags |
| --- | --- | --- | --- | --- | --- | --- |
| 1 shape (the floor) | 100 % | 18.0 → 18.0 | 18.1 → 18.2 | 0.1 → 0.1 | 3.1 → 3.5 | 0 → 0 |
| 1 shape (the floor) | fit, 46 % | 18.0 → 18.0 | 18.1 → 18.3 | 0.1 → 0.2 | 2.7 → 4.7 | 0 → 0 |
| 300 shapes | 100 % | 18.0 → 18.0 | 18.2 → 18.2 | 3.6 → 0.2 | 9.8 → 5.6 | 0 → 0 |
| 300 shapes | fit, 46 % | 35.5 → 18.0 | 54.1 → 18.1 | 4.6 → 0.2 | 15.0 → 4.0 | 0 → 0 |
| 150 text boxes | 100 % | 36.0 → 18.0 | 90.1 → 18.1 | 21.4 → 0.4 | 38.0 → 4.2 | 11 → 1 |
| 150 text boxes | fit, 46 % | 53.0 → 18.0 | 90.2 → 18.2 | 28.1 → 0.4 | 50.8 → 4.9 | 21 → 0 |
| 40 photos + 100 shapes | 100 % | 18.1 → 18.0 | 88.8 → 18.2 | 3.8 → 0.2 | 12.5 → 5.3 | 0 → 0 |
| 40 photos + 100 shapes | fit, 46 % | 35.4 → 18.0 | 90.0 → 18.3 | 4.5 → 0.3 | 14.2 → 8.3 | 0 → 0 |
| 60 blended shapes | 100 % | 53.5 → 18.0 | 107.1 → 18.2 | 4.8 → 0.3 | 12.6 → 4.0 | 0 → 0 |
| 60 blended shapes | fit, 46 % | 35.9 → 18.0 | 88.9 → 18.1 | 4.7 → 0.2 | 12.0 → 3.5 | 0 → 0 |
| 120 boxes + 60 arrows | 100 % | 18.0 → 18.0 | 18.3 → 18.2 | 2.3 → 0.2 | 9.5 → 4.4 | 0 → 0 |
| 120 boxes + 60 arrows | fit, 46 % | 18.0 → 18.0 | 18.2 → 18.1 | 2.0 → 0.2 | 8.5 → 3.8 | 0 → 0 |

Read in a sentence: before, a drag on the text, photo and blend pages showed 18 to 28 frames a second at the fit zoom, with 70
to 140 ms for a frame at the 95th percentile; after, every page is at the floor of the measurement (18.0 ms at the median, 18.1 to 18.3 at
the 95th percentile), headless and headed.

**The worst single frame** is not in the tables because it says nothing about the change: in nearly every row, the one-shape
page included, before and after alike, one frame of a drag (near its beginning) takes 50 to 430 ms with no long task on the
main thread. What that is was not found out.

**The development server** is slower in another way: there most of the time of a move is React's development build (in a CPU
profile of a drag, the function that creates an element was the largest single entry, 11 to 23 % of the time). One drag of each
page, before the change: 27 to 29 ms of main thread a repaint with one shape on the page, 90 to 150 ms on the heavy pages.
Judge speed on a production build.

## Where the time went

On a production build, before the change, for the slow pages:

| | 150 text boxes (fit) | 40 photos + 100 shapes (fit) | 60 blended shapes (100 %) |
| --- | --- | --- | --- |
| Pointer listeners: store commit, Immer, text boxes, attached lines, snapping (median a move) | 2.6 to 2.8 | 0.9 to 1.3 | 0.5 to 1.1 |
| Repaint of the page, script part (median a frame) | 24 to 28 | 4 to 6 | 5 to 15 |
| Main thread a repaint, all of it | 47 to 52 | 13 to 23 | 13 to 35 |
| Frame, median | 53 | 36 | 54 |

- **The repaint of elements that had not changed** was nearly all of the script time, and behind it the graphics process had
  to draw the same hundreds of things again: on the photo and blend pages the frame took two to three times as long as the main
  thread was busy. A blended element costs most, because it is painted on a layer the size of the canvas and laid over the
  page: 60 of them are 120 full-canvas operations a frame.
- **The thumbnail in the page strip** was the long tasks: on the text page it was painted five times in a two-second drag
  (18,130 canvas calls on small canvases), and the page had 7 to 21 tasks of more than 50 ms in three drags, the longest 113 ms.
  After the change there were none headless and one headed (180 ms, once).
- **Not the cause:** the store commit, Immer, `reflowLines` (60 attached arrows: 0.9 to 1.5 ms a move for everything in the
  listeners), text layout (kept per text element since before), filtered photos (kept per picture since before; they showed up
  only as the time to draw them), React (0 to 5 ms a repaint in production).

## What was changed

1. **While a pointer gesture is under way, the elements that stay as they are are painted once and kept**
   (`src/render/dragLayers.ts`, used by `src/editor/canvas/PageView.tsx`). One layer holds the page background and everything
   under the lowest element that changes, a second everything over the highest; a frame lays the first on the empty canvas,
   paints the elements between the two the usual way, and lays the second on top. The layers are painted by `renderPage` itself
   (a new `part` option), at the scale, place and size of the page canvas.
2. **The page strip leaves its thumbnail alone while a gesture is under way** and paints it when the gesture ends
   (`useHeld` in `src/editor/pages/pageParts.tsx`). Without a gesture it follows changes a few times a second as before.

Nothing else changed: the document, the store, undo (one step for a drag, which the script checks on every drag), exports,
thumbnails elsewhere and Present do not use the layers.

### When a layer is used again, and when not

What moves is not asked for, it is seen: the store never changes an element in place, so an element that is the same object
as in the frame before has not changed. A layer is used for a frame only if all of this holds, and is painted again otherwise:

- every element on it is the same object as when the layer was painted (so any change to any of them, down to an element
  inside a group, or even a new name, takes that element off the layer: it joins the ones painted every frame for the rest of
  the gesture);
- the page has the same elements in the same order as in the frame before (an element added, taken away or moved in the stack:
  that frame is painted whole and the layers are made again);
- the same page, page background, design size, canvas size, zoom and device pixel ratio, scroll position, and the same elements
  left out (the text that is edited, the picture that is cropped);
- no font and no picture has arrived since (the canvas is told and paints the layers again).

There are no layers at all, and the page is painted as before:

- outside a pointer gesture; when the gesture ends the page is painted from nothing once more, so **the picture at rest is
  never one made of layers**;
- while an animation preview plays;
- when fewer than 12 elements would be on the layers;
- while something on a layer is still loading (a layer must not keep the grey box that stands in for a picture);
- when a canvas for a layer cannot be had.

**Blend modes.** Elements under the moving ones may have a blend mode: what they mix with is all on the layer under. The
moving elements are painted the usual way over that layer, so their own modes mix with the real page under them. An element
with a mode *over* the moving ones mixes with them, so if there is one (also inside a group), nothing over the moving elements
is kept: all of it is painted every frame, and only the layer under is used.

Each of these rules has a test in `src/render/dragLayers.dom.test.ts`; `PageView.test.tsx` has the gesture itself (only what
moves is painted, the whole page when it ends, the layers let go, a picture that arrives in the middle).

### What is not exactly the same picture, and for how long

The layer under is an exact copy. The layer over the moving elements is not always: laying a layer of half-transparent pixels
over the page rounds twice where painting straight onto the page rounds once. In the measurement the page with attached arrows
is the one with elements over the dragged one, and there the last frame of the drag differed from the page at rest in about
2,400 pixels by 1 level of 255 at 100 %, and in 5,387 pixels by up to 2 levels at the fit zoom (the 56 arrows that are kept
on the layer over have soft edges). On the five other pages the two pictures were the same in every pixel. The difference lasts as long as
the pointer is down; the frame after it is painted from nothing.

## Checked, and not

- The numbers above: three drags a row, one machine, one browser. Not measured: Firefox, Safari, Edge, a phone or a tablet, a
  screen with a device pixel ratio of 2 (four times the pixels, and two more canvases of that size while a gesture runs:
  about 33 MB each for a canvas of 3840 x 2160), a slower GPU, a design with pictures of many megapixels.
- Resizing and turning use the same path as moving and are covered by the unit tests, but only moving was measured.
- Dragging many elements that are far apart in the stack keeps less on the layers (everything between the lowest and the
  highest is painted every frame); it was not measured.
- Not changed, and measured only as far as said in [`ROADMAP.md`](ROADMAP.md): zooming and scrolling still repaint the whole
  page every frame, and so does typing into a panel field.
- The Layers panel paints a small picture of each layer; with it open during a drag on a heavy page it may cost what the page
  strip cost. It was closed in these measurements.
- The one slow frame near the beginning of a drag (above) is unexplained.

## Running it again

```bash
npx vite build --outDir dist-perf        # with VITE_EXPOSE_STORE=1 in the environment
npx vite preview --outDir dist-perf --port 4179
BASE=http://127.0.0.1:4179 node e2e/perf-drag.cjs
```

`ONLY=text,blend` picks pages, `RUNS=5` repeats more, `HEADED=1` shows the window, `PROFILE=text` adds a CPU profile of one
drag of that page (use the development server for it: a production build has no function names). The script is not part of
`npm run e2e` and never fails; it prints the table and writes `result.json` into the journeys' output folder.

# Performance: long video downloads

Measured on 2026-11-27 on the machine above, in Chrome headless, against the dev server, with `e2e/perf-video.cjs`: a design of
ten pages of a minute, each filled by a looping 720p clip, downloaded as a 1080p video (MP4, H.264, 30 fps, a target of 10 Mbit/s).
The longest video the panel makes is ten minutes (`VIDEO_MAX_SECONDS`). Memory is the working set of all the browser's processes
together; the editor with the design open was about 0.8 to 1.0 GB before the download.

| The clip | Made in | File | Memory, peak |
| --- | --- | --- | --- |
| flat colour with a moving box | 507 s | 53 MB | 1.45 GB |
| detail that changes every frame (the most the encoder writes) | 178 s | 413 MB | 2.12 GB |
| the same, after the change below | 203 s | 426 MB | 1.86 GB |
| a clip with a transparency layer, one minute only | 634 s | 41 MB | 0.93 GB |

The flat run was the first of the day and the machine was busier; the detailed runs go at about 100 frames a second. Encoding and
decoding are not what limits it: on their own, 1080p frames were encoded at 160 a second and the clip's frames decoded at 160 a
second.

**What was changed.** The MP4 was built whole in the page's memory and copied into a file at the end (Mediabunny's
`fastStart: "in-memory"` into a `BufferTarget`), which is about three times the file at the peak. It is now written into a Blob as it
is made (`src/export/animated/blobFile.ts`): `fastStart: "reserve"` keeps room at the start of the file for its index, which works
because the number of frames and packets of sound is known before the first frame, so the file is still an ordinary MP4 with its
index first (`ftyp`, `moov`, a `free` box of what was kept and not used, then `mdat`). The peak went down by 0.26 GB for a file of
0.43 GB; what is left is mostly the browser keeping the file's bytes, which a download has to have somewhere.

**The size estimate** left clips out: the panel said "~2.3 MB" for a minute that came to 42 MB. A clip now counts as a picture over
its area, as an image does (`weighPage` in `src/export/options.ts`), so a page filled by a clip is estimated at the full rate: about
75 MB a minute at 1080p, where detailed footage measured 42 MB and a flat clip 5 MB. It cannot know how much detail a clip has; it
errs on the large side.

**What is still slow or large.**
- A clip with a transparency layer (a WebM with alpha, as a canvas records one) is read by seeking a hidden `<video>` for every
  frame (`SeekReader` in `clipFrames.ts`), because Mediabunny decodes alpha in workers that the app's policy does not allow: about
  3 frames a second, so a minute of video takes ten minutes. A clip from a camera or a phone has no such layer.
- At the encoder's ceiling (10 Mbit/s for ten minutes, 750 MB) the peak would be about 1.9 GB above the editor's own memory. That
  was not measured; the detailed clip above reached 5.7 Mbit/s.
- A clip near the limit of an upload (250 MB): a real 720p MP4 padded to 240 MB with a `free` box, which players skip, was taken by
  Uploads at its full size, placed, kept across a reload and downloaded in a 1080p video; the browser stayed under 0.95 GB. Its
  decoding was not heavier than a small clip's (the padding is not pictures).
- Not tried: a computer with less memory, a phone, Firefox and Safari (whose encoders differ).

# Performance: the live server under load

Measured on 2026-11-28 with `scripts/live-load.mjs` against the server's image (`Dockerfile.server`) in Docker Desktop on Windows,
limited to **one CPU and 512 MB** (`docker run --cpus 1 --memory 512m`), about what a small virtual server has. The load ran
on the same machine (an AMD Ryzen 9 9900X), outside the container. Every room has five people. Each of them joins with the edit
key, adds a shape, then moves it again and again and moves their pointer. An edit is acknowledged only once it is on disk, so
the time to acknowledge includes the write.

Two profiles:
- **Busy:** an edit every 2 s and 5 pointer moves a second per person, all the time. The editor sends a pointer move at most
  every 80 ms and only while the mouse moves, and an edit when something changes, so this is a room where everybody is busy
  at once, more than people are.
- **Extreme:** an edit every 0.5 s and 10 pointer moves a second per person, all the time. It shows where the server breaks.

| Profile | Connections | Edits a second | Acknowledged in, p50 / p95 / p99 | CPU | Memory, peak |
| --- | --- | --- | --- | --- | --- |
| busy | 1,000 | 498 | 40 / 104 / 137 ms | 89 % | 66 MB |
| busy | 2,000 | 997 | 1.7 / 2.3 / 2.4 s | 100 % | 85 MB |
| extreme, before the change below | 500 | 997 | 242 / 363 / 450 ms | 100 % | 61 MB |
| extreme, after it | 500 | 986 | 161 / 251 / 274 ms | 87 % | — |
| extreme, before | 1,000 | 1,998 | 4.4 / 5.7 / 6.0 s | 100 % | 100 MB |
| extreme, after | 1,000 | 1,975 | 0.98 / 1.3 / 1.4 s | 100 % | — |
| extreme, before | 2,000 | 2,355 | 79 / 102 / 113 s | 100 % | 246 MB |

In every run but the last nothing was refused, lost or closed. In the last one the server was far past what one CPU does:
joining took eleven minutes instead of thirty seconds, 100 people could not join, and 733 connections were sent away with
"try again later" (close 1013, `connections_closed_total{reason="queue"}`), as the server is made to do when edits wait too
long to be saved; a browser comes back by itself and sends again what was not acknowledged. The process stayed up, was not
killed for its memory, and went back to idle afterwards.

**What was changed.** A profile of the server under the extreme load of 500 connections (`node --cpu-prof` in the container)
showed its JavaScript idle 44 % of the time and the writes to the network at 25 %: one write for each message to each person,
and a person in a room of five is told four pointer moves for each of their own. Turning messages into JSON was under 2 %.
The server now holds each connection's socket at the first message of a turn of the event loop and lets it go when the turn
is over (`hold` in `src/server/live.ts`), so what one person is told at once leaves in one write. It costs less than a
millisecond, and it made the extreme load of 1,000 connections four times faster.

**What it means.** One CPU carries about 1,000 people who are all busy at once with an edit acknowledged in about a tenth of
a second, and degrades slowly past that; most people in most rooms are idle most of the time, which costs a ping every 30 s.
The server is one Node process and does not use more cores, so a bigger machine helps only up to one fast core; more people
than that need more servers (docs/DEPLOY.md, "What is not there yet").

**Not measured.** The load on a machine of its own (here the load and the server shared one), designs with many pages and
pictures, clips and pictures uploaded during the load, rooms of 20 or 50 people, a slow disk, and a run of hours.
