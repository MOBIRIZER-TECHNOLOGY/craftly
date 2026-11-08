# Test harness

Two kinds of test run under `npm test` (vitest "projects", see `vite.config.ts`):

| Project | Files | Environment | Use it for |
| --- | --- | --- | --- |
| `logic` | `src/**/*.test.ts` | node | pure code: document operations, geometry, text layout, export writers, encoders |
| `ui` | `src/**/*.test.tsx`, `src/**/*.dom.test.ts` | jsdom (`src/test/domSetup.ts`) | React components, anything that needs `document`, canvas or IndexedDB |

Tests sit next to the code they test. `npm run coverage` runs both projects with V8 coverage and enforces the thresholds in `vite.config.ts` (95 % on statements, branches, functions and lines). The gate counts the code that ships: `coverage.exclude` leaves out the tests and this harness, the development pages in `src/dev` and the UI-kit gallery (14 files that are not in the production build), and the two files that need a real browser (`src/ml/worker.ts`, `src/ml/ortRuntime.ts`; `e2e/ml.cjs` runs them). Counted at zero, the development pages would pull the totals down to about 93 to 94 % (measured on 2026-11-07).

## What jsdom does not have, and what the harness gives instead

| Missing in jsdom | Provided by `domSetup.ts` (loaded automatically for the `ui` project) |
| --- | --- |
| canvas 2D context, `toDataURL`, `toBlob`, `Path2D` | `canvasMock.ts`: a **recording** context. `contextOf(canvas)` returns it; `ctx.calls`, `ctx.callsTo("fillText")` tell you what was painted. Text is measured at `length * size * 0.55`. |
| IndexedDB | `fake-indexeddb` (use `clearLibrary()` in `beforeEach`) |
| layout (every rect is 0 x 0) | `stubLayout(width, height)` from `helpers.tsx` (returns a restore function) |
| `matchMedia` | `media.ts`: answers `false`; `setMedia("(max-width: 899px)", true)` flips one query |
| `ResizeObserver`, `IntersectionObserver` | stubs that report once, at once (everything is "visible") |
| image decoding | `new Image()` loads 64 x 48 a tick after `src` is set; a source containing `broken` fires `error` |
| `URL.createObjectURL`, `navigator.clipboard`, `scrollIntoView`, pointer capture, `requestFullscreen`, `window.print`, `createImageBitmap` | trivial stubs |
| `DataTransfer` | not provided: pass plain objects, `fireEvent.drop(el, { dataTransfer: { files: [file], types: ["Files"] } })` |

`afterEach` cleans the DOM and restores mocks; `beforeEach` clears `localStorage` and the media answers. React's "not wrapped in act(...)" warning is dropped (Craftly updates screens from store writes, observers and timers that a test cannot wrap, and thousands of warnings buried the messages that matter); every other `console.error` still shows.

## Helpers (`helpers.tsx`)

`resetEditor()` puts the Zustand store back to its start state (call it in `beforeEach`), `clearLibrary()` empties IndexedDB, `sampleDesign()` is a two page design (text, shape, image, group), `mountEditor(design?)` saves a design and mounts the whole `<Editor>` on it, `flush()` lets promises and effects settle. Importing `helpers.tsx` loads the whole editor module graph; a test of pure code (`src/core`, `src/render`, `src/export`) uses `logicDb.ts` instead.

More helpers sit next to it, one file (or two) per area of the app:

| File | For the tests of |
| --- | --- |
| `canvasUtils.tsx` | the workspace: mount it on a 1000 x 700 layout, turn design coordinates into pointer, wheel and drop events |
| `chromeUtils.tsx`, `chromeEditor.tsx` | top bar, page strip and grid, dialogs, bottom bar, presenter (`chromeEditor` mounts the whole editor) |
| `ctxUtils.tsx` | the context panels and toolbars that appear for a selection (`typeNumber` types into a number field, `stubDomMatrix`, `fakeDataTransfer`) |
| `tabsHarness.tsx` | the left rail and its panels (`mountPanels` lays out the rail, the side panel and the toast, confirm and menu hosts) |
| `dashuiUtils.tsx`, `dashuiLayout.ts` | the UI kit and the dashboard (global hosts, a stand-in for the file dialog, mounting the app on a hash route, layout stubs) |
| `logicPaint.ts`, `logicDb.ts` | painter, export and core tests that need no editor (a paint-state spy on the recording canvas, a `DOMMatrix` stand-in, an IndexedDB wipe) |
| `schema/complete.ts` | `completeDesign()`, `minimalDesign()` and `completeRecords()`: the stored formats with every optional field set, checked by the compiler through `Complete<T>`, so a new optional field cannot be added without the builders and the shape test (`src/core/schema/persistedShapes.test.ts`) hearing about it. `fixtures/schema/` holds the frozen designs and records that a release wrote; they are never edited (its README) |
| `swHarness.ts` | the service worker (`public/sw.js`) run in a `node:vm` context against an in-memory Cache Storage (names in the order the caches were made) and a network that can be switched off, with its listeners fired by hand |
| `zipBuilder.ts` | ZIP archives made the way other tools make them (deflate, extra fields, comments, damaged headers), written separately from `src/export/zip.ts` so that the reader is not only tested against the writer that made its input |

## Conventions

- Test what a person sees or what changes in the document: assert on roles, labels, text, the store (`useEditor.getState()`), calls to the recording canvas. No snapshots. No test without an assertion.
- Query like a user: `getByRole("button", { name: "Share" })`. The browser journeys in `e2e/*.cjs` use the same accessible names and show the flows worth copying.
- `userEvent.setup()` for clicks and typing, `fireEvent.pointerDown/Move/Up` for canvas gestures (jsdom has `PointerEvent`).
- Do not edit the shared files here from a feature test. Need something extra? Add a helper in a new file in this folder.
- A stand-in for an AI model should be a function whose answer you can work out by hand, not a mock that returns one constant. The upscaler's tests use a "model" that turns every pixel into a block of pixels, so the stitched result of all the tiles has to equal the original's pixels exactly, and a tile put in the wrong place, or context left in, cannot hide (`fakeClient` in `src/ml/service.dom.test.ts`; `syntheticUpscaler` in `e2e/syntheticModel.cjs` does the same in a real browser).
- Some rules live in the project's own files, and a test can read those with `node:fs` (a `logic` test): `src/styles/tokens.test.ts` holds the contrast of the colours that carry words and keeps the token contract in `docs/DESIGN.md` equal to `tokens.css`; `src/styles/classNames.test.ts` fails when the stylesheets of two packages (top-level folders of `src`) style one selector, because CSS class names are global and a stylesheet that has been loaded stays loaded, so the two would change each other's screens depending on what was opened first (a fresh page never shows it: `e2e/dashboard.cjs` walks from the dashboard into the editor and back in one page); `src/test/devServerWatch.test.ts` starts a real Vite server. Their failure messages name the offender.

## Do the tests notice a wrong line?

Coverage says which lines ran, not whether a test would fail if one were wrong. For a risky change, break the line on purpose (flip a comparison, change a constant, swap two branches), run the tests that should notice, and put the line back; do it on a copy of the project, never on the only one. On 2026-11-07, 23 lines of the app (colour contrast, animation timing, rotation, the PDF, zip and GIF writers, link safety, the model checksum, undo, hotkeys, the trash, dialogs, number fields, snapping, alignment, autosave and more) were broken this way and the tests of their files were run: 22 were noticed. Two of them had slipped through at first, the 1.2 s window in which edits with one key merge into one undo step and the 40 and 8,000 px limits of a custom size, and now have tests. The last one (a GIF encoder that clears its code table one code early) still writes a valid file, so nothing is wrong to notice.

## Things that bit us

- **Never return or `await` the recording canvas context from an async function.** It answers every property, `then` included, so the promise never settles and the test hangs until its timeout.
- **Fake timers and fake IndexedDB do not mix**, and `vi.useFakeTimers()` with `userEvent` hangs. Use `fireEvent` for hover and timer tests, and switch back to real timers before any database call.
- **jsdom has no `DOMMatrix` and no `DragEvent`.** Stub them in the test that needs them (`stubDomMatrix()` exists in `ctxUtils.tsx` and in `logicPaint.ts`; drag tests use a `fakeDataTransfer()` from `tabsHarness.tsx`, `ctxUtils.tsx` or `chromeUtils.tsx`) and attach drag coordinates by hand.
- **Do not leave the order of typing and animation frames to timing.** A number field selects its text on the next frame; a test that races it passes on a quiet machine and fails on a busy one. Hold the frames (`vi.spyOn(window, "requestAnimationFrame")`) and run them when the test says so.
- **Busy machines are slow in bursts.** `findBy*` and `waitFor` wait up to 20 s (set in `domSetup.ts`) because a lazily loaded screen - the dashboard, a side-panel tab - can take many seconds to import when the CPUs are shared; a passing test never waits for it. Never assert right after an `await user.click(...)` that starts async work (applying a template): `await waitFor(...)`. After typing into a search that debounces (140 ms in the Templates tab) wait for the list to settle before taking an element from it, or the element may be replaced under you.
- **Chunks requested ahead of need must not reject unhandled.** The side panel warms up its tabs and the icon cells ask for the icon library; when a test run ends first, the import fails. The app swallows that, and the tests that prove it listen for `unhandledRejection` (see `SidePanel.warmup.test.tsx`).
- **A Blob that goes through fake IndexedDB in jsdom comes back without its methods.** jsdom's `Blob` is not the one Node can copy, so `arrayBuffer()` is gone on the stored copy. Check the bytes of a stored file in a Node test (`modelStore.test.ts` imports `fake-indexeddb/auto` itself), and in a jsdom test only check that the record exists.
- **The `confirm()` queue is module state shared by every test in a file.** A test that opens a question and never answers it leaves the next test clicking the old one (it then hangs). Settle every question you ask (`askToDownload.test.tsx`).
- **`vi.restoreAllMocks()` restores spies but does not reset `vi.fn()` mocks.** A `vi.mock` factory's mocks keep their calls and implementations between tests: call `mockReset()` in `beforeEach` (`ToolsTab.test.tsx`, `ModelsDialog.test.tsx`).
- **A job that changes pixels in place changes the test's own picture, if the stand-in gives it that picture.** The stand-in `readPixels` of `service.dom.test.ts` hands out a copy every time, as the real one does; without it the test compared the result with a picture the job had already blurred.
- **The 2 x 2 mask of the stand-in model is soft over half of the picture.** Stretched over a 200 x 100 picture it fades from subject to background between row 25 and row 75, so a test of "the surround is transparent" must make rows 25 and below transparent, not the lower half: an opaque row in the fade is part of the subject's soft outline (`service.dom.test.ts`, `colourful(...)`).
- **Never `toEqual` two arrays of a million numbers.** When they differ, vitest prints the whole diff and the worker can die with exit code 143 instead of failing the test. Compare with `every()` (`service.dom.test.ts`, the tall picture).
- **Test the worker's logic without a worker.** `src/ml/engine.ts` takes the ONNX runtime as an argument and `client.ts` takes the worker, so both run in Node with stand-ins; the real runtime, GPU and worker are checked in a browser by `e2e/ml.cjs`.
- **The dashboard paints the last thing it read, then refreshes** ("instant paint, then a silent refresh", `liveStore.ts`). A test that writes the library and then looks at once sees the kit or the list of the test before, on a busy machine: wait for what you expect (`findBy*`, `waitFor`) and do not take "the heading is there" for "the data is there". `resetDashboardStores()` waits until the brand kit has been read again, and `withKit()` in `BrandPage.test.tsx` makes the store hold the kit before the page mounts. To check a test for this, put a 40 ms delay before `load()` in `liveStore.ts` for one run (and take it out again): `BrandPage` and `ProjectsPage` failed 7 tests that way until they were fixed.
- **The words for an age depend on the hour of the day.** `formatRelative` goes by the calendar, so an hour ago is "yesterday" at 00:30 and two hours after 22:30 is "yesterday" too. A test that builds times from `Date.now()` and expects "1h ago" or "2h ago" passes by day and fails at night. Pin the clock (`vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0))`, then `vi.useRealTimers()` in `afterEach`) or build the times from a fixed noon (`TrashPage.test.tsx`, `cards.test.tsx`). Offsets under an hour are safe: they never reach the calendar.
