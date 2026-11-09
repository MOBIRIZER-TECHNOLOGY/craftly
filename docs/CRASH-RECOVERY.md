# Crash recovery and problem reports

**Status: work in progress (built 2026-11-09; committed 2026-11-10, in one commit with the attached lines and the live editing, before it was finished).** The code and its unit tests are in the repository and pass (the whole suite: 7,535 tests in 336 files, types, lint and format clean). The browser journey for it (`e2e/crash.cjs`) is not finished, and the usual verification of this feature on its own (a clean copy, the uncovered lines of its files, deliberate breakages, the dev and production journeys, a hand test in a browser) has not been run. **Read "Status and what is left" at the end first** if you are here to continue or to fix something.

[`ROADMAP.md`](ROADMAP.md) item 6 ("No crash reporting") asked for opt-in error reporting with a clear privacy line, and a way to recover the last autosave after a crash. This is that work.

## What was wrong

- **A crash could make a design impossible to open.** An error while drawing the editor shows a calm screen (`ErrorBoundary`). But the editor's cleanup (`persistOnLeave` in `src/editor/Editor.tsx`) then wrote the state that was on the screen over the stored design, and that state can be the very thing that stopped the screen. Reloading opened it and stopped again, and the crash screen had no way to a version from before.
- **Errors that nothing caught were silent.** A handler that threw, a timer, a promise that rejected: no handler on `window`, so nothing was written down and the person saw a button that did nothing.
- **There was nowhere to report.** The only thing a person could do was read the error message on the crash screen.

## What a person sees

- **The screen stops.** The crash screen (`src/components/CrashScreen.tsx`) says what happened. For a design it says when the design was last saved ("Craftly stopped unexpectedly. Your design is saved on this device (last saved at 12:41), so reloading should bring you back to where you were."). A part of Craftly that could not be fetched (a deployment replaced a file, or the network is gone) gets its own heading and text ("Check your connection, then reload"). The keyboard goes to **Reload Craftly**. **Go to your projects** leaves the screen.
- **The same design stops it again** (twice within two minutes, in the same tab): the screen says "Craftly stopped again when this design was opened" and opens **Go back to an earlier version**: the newest five versions with when and where each came from ("Before the problem", "Saved automatically", "Saved by you", ...), each with **Use this version**, which puts that version's pages in the design (the title and the rest stay), keeps what was there as a version called "Before going back", and reloads. **Save a copy of the design to a file** writes the stored design as a `.craftly` file without opening it. Both work from the library alone, because the editor is what may not open.
- **Report this problem** (folded away on the crash screen): the report exactly as it would be sent, with **Copy report**, **Download report** and, only where the site that hosts Craftly allows it, **Send report**.
- **Something that nothing caught** (an error in a handler or a timer, a rejected promise) is written down. The person sees one toast, "Something unexpected went wrong. If something does not work, reload the page.", with **Details**, at most three times in a page's life and not within a minute of the last one. Extensions' errors, "Script error." from another site, the resize loop notice and cancelled requests are not Craftly's and are ignored.
- **Report a problem** is under **File > Help** in the editor and in the account menu of the dashboard. The dialog (`ProblemsDialog`) lists what was written down on this device (newest first, with how often it came and whether it was sent), shows the report of the chosen one, and can clear the list.

## Privacy: what leaves the device

**Nothing, unless the person presses Send, and only where the site that hosts Craftly has named an address.** There is no automatic sending, no analytics and no background request.

- A report has these twelve fields and no others (`Report` in `src/core/problems.ts`, pinned by a test): `format`, `app`, `build`, `at`, `kind`, `message`, `stack`, `count`, `route`, `browser`, `window`, `online`. The message is at most 300 characters on one line, with web addresses and e-mail addresses replaced; the stack is the frames only, with the address and folders of the site cut off (`Editor-CmJy4Uwp.js:1:2345`); `route` is the screen ("design", "projects"), never which design; `browser` is "Chrome 152 on Windows". It never holds a design, its title, text or pictures, a file name or an id. A test records a problem with a design open and a distinctive title and checks that neither is in the body.
- The person always sees the report as it would be sent (a `pre` in the panel; the text sent is that text). Sending is one `POST` with `Content-Type: text/plain;charset=UTF-8` (a "simple request", so a collector needs no CORS preflight), `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `cache: "no-store"` and a ten second limit.
- The list of problems is kept on this device only, in `localStorage` (not IndexedDB: a problem with the database is the kind that has to be written down). At most twenty; the same problem within a minute is counted, not listed again.

## Configuration

- `VITE_CRAFTLY_REPORT_URL` (build time): a web address (`https://reports.example.org/in`) or a path on the site (`/reports`). Anything else (`javascript:`, `//host`, a bare word) is ignored. With none, a production build has no **Send report** button and the report can only be copied or downloaded.
- The development server has an address of its own, `/__report` (`devReportEndpoint` in `vite.config.ts`: it checks that the body is JSON of at most 20,000 bytes, prints it in the terminal and keeps nothing), so the whole flow can be tried with `npm run dev`.
- **Content-Security-Policy:** when an address is named, its origin has to be in `connect-src` (the policy in the README). A path on the site itself needs nothing.
- **Browser journeys on a production build** need the button, so build with `VITE_EXPOSE_STORE=1 VITE_CRAFTLY_REPORT_URL=/__report npx vite build --outDir dist-e2e` (see `e2e/README.md`; the CI workflow still needs the variable, see below).

## How it works (code map)

| File | Job |
| --- | --- |
| `src/core/problems.ts` | The log (`recordProblem`, `listProblems`, `markProblemSent`, `clearProblems`, 20 entries, dedupe within 60 s, falls back to memory when storage fails), the cleaning (`cleanMessage`, `cleanStack`), the noise rules (`isNoise`), `kindOfLoadFailure`, `routeOf`, `describeBrowser`, the report (`buildReport`, `reportText`), `reportEndpoint`, `sendReport`. Kinds: `screen`, `panel`, `script`, `promise`, `save`, `load` (a `screen` problem whose message says a file could not be fetched is recorded as `load`). |
| `src/core/recovery.ts` | `noteCrash`/`crashCount` (per design, two minutes, in `sessionStorage` key `craftly.crashes.v1`, so a reload does not forget), `markCrashing`/`isCrashing` (a module flag), `keepBeforeProblem` (saves the stored design as a version "Before the problem", unless it is the newest version already), `earlierVersions`, `goBackToVersion`, `savedAt`. Works from the library alone. |
| `src/core/clipboardText.ts` | `copyText`: the clipboard API, then a hidden field and `execCommand`. |
| `src/components/ErrorBoundary.tsx` | Writes the crash down (`recordProblem("screen", ...)`), counts it for the design (`designId` prop, which `App.tsx` gives for `#/design/:id`), and sets `markCrashing(true)` **in `getDerivedStateFromError`** on purpose: it has to be set before the editor's passive-effect cleanup runs, and `componentDidCatch` runs earlier than that cleanup but a flag set in the render phase is the one that cannot be late. Cleared by `recover()` (route change or **Go to your projects**). |
| `src/components/CrashScreen.tsx` | The screen above. |
| `src/components/ReportPanel.tsx` (+ `.css`) | The report, Copy, Download, Send. The `endpoint` prop exists so that tests can say "none". |
| `src/components/ProblemsDialog.tsx`, `ProblemsHost.tsx`, `problemsDialogState.ts` (+ `problemsDialog.css`) | The dialog; a host mounted once in `App.tsx` that loads the dialog chunk the first time it is opened (`opened` counts the openings, and the dialog is keyed by it so each opening reads the list again); a tiny store so that a menu can open it without loading it. (Do not name the store `problemsDialog.ts`: on Windows `./ProblemsDialog` then resolves to it.) |
| `src/problemCatcher.ts` | `window` `error` and `unhandledrejection`: `recordProblem`, then the toast (not while a crash screen is up, not for a repeat, three at most, a minute apart). Installed in `src/main.tsx`. |
| `src/editor/Editor.tsx` (`persistOnLeave`) | When the editor goes away because the screen stopped (`isCrashing()`) and there are unsaved edits, `keepBeforeProblem(design.id)` runs first (and its failure does not stop the write), then the state on the screen is written as before. |
| `src/editor/autosave.ts`, `src/editor/panels/shared/PanelBoundary.tsx` | Record a failed save (`save`) and a stopped side panel (`panel`). |
| `src/editor/topbar/FileMenu.tsx`, `src/dashboard/Shell.tsx`, `src/ui/icons.ts` | The two menu entries and `IconBug`. |
| `vite.config.ts` | `devReportEndpoint`, `answerReport` (exported for tests). |

**Why the stored state is kept, not the state on the screen.** At the moment of a crash the stored design is the last autosave: it was on the screen for at least 700 ms without stopping the editor (a crash at render stops the editor before the autosave timer fires). So it is the best "last known good" there is. The state on the screen is still written to the design, as before, because most crashes are caused by an interaction and the person would lose their last edits otherwise; if that state is what stops Craftly, the screen offers the kept version.

## Tests

Everything below passes today. Run one with `npx vitest run <file>`.

| File | Tests | Covers |
| --- | --- | --- |
| `src/core/problems.test.ts` | 21 | Message and stack cleaning, noise, load-failure words, route names, browser description, the 12-field report. |
| `src/core/problems.dom.test.ts` | 19 | The log in `localStorage` (order, dedupe, cap, storage failing, corrupt storage, sent mark), `reportEndpoint` rules, `sendReport` (what is posted, failure, timeout, nothing of the design). |
| `src/core/recovery.dom.test.ts` | 15 | Crash counts, the flag, `keepBeforeProblem`, `earlierVersions`, `goBackToVersion`, `savedAt` (fake IndexedDB). |
| `src/core/clipboardText.dom.test.ts` | 4 | Clipboard, fallback, failure. |
| `src/components/ReportPanel.test.tsx` | 11 | Report text, with and without an address, copy, download, send, failure, sending state. |
| `src/components/ProblemsDialog.test.tsx` | 10 | The list, choosing, the sent mark, clearing, closing, the lazy host and each opening starting fresh. |
| `src/components/CrashScreen.test.tsx` | 14 | Both kinds of screen, focus, the saved time, the repeated stop, the version list, going back, saving a copy, failures. |
| `src/components/ErrorBoundary.test.tsx` | +6 | The problem written down, the flag, the counts per design. |
| `src/problemCatcher.dom.test.tsx` | 8 | Errors and rejections, noise, the toast rules, the Details button, uninstalling. |
| `src/test/devReportEndpoint.test.ts` | 7 | The dev server's answer to `/__report`. |
| `src/editor/Editor.test.tsx` | +4 | What is kept when the editor goes away because the screen stopped. |
| `autosave.dom.test.ts`, `shared.test.tsx`, `Shell.test.tsx`, `FileMenu.test.tsx`, `src/main.dom.test.ts` | +5 | A failed save and a stopped panel are written down, the two menu entries, the catcher is installed at start. |

## Status and what is left

### Done

Everything in "How it works" exists and its tests pass: 123 new tests (6,829 before, 6,952 after, 317 files, counted when this part was finished), `npx tsc --noEmit`, `npx eslint` and `npx prettier --check` clean on every file this work touched. The whole working tree, with the attached lines and the live editing that were built after it, now has 7,535 tests in 336 files and all of them pass (see [`VERIFICATION.md`](VERIFICATION.md)). It was committed on 2026-11-10 together with that work, in one commit (the commit before it, `5549807`, is Combine shapes), before the steps below were done.

### Not done, in the order to do it

1. **Fix `e2e/crash.cjs`** (it is not in `e2e/run-all.cjs` on purpose, so `npm run e2e` is not affected). Run it alone with `node e2e/crash.cjs` against a dev server (`npm run dev`; restart it first if you changed source files). On 2026-11-09 the first nine steps passed (the design saves, nothing is sent and nothing is written down before a problem, the editor stops and the screen says when the design was saved, the problem is written down with no title or id in it, the report is shown with its twelve fields, the file downloads, **Send** posts exactly the text that was shown, once, with no cookie and no referrer) and these did not:
   - *"the report is read ... and copied"*: it compares the clipboard text with the `innerText` of the `pre` and they differ (probably only in whitespace). Compare `JSON.parse` of both instead. Not yet looked into.
   - *"reloading stops Craftly again, and says so"* and everything after it that needs a second stop: **`damage()` does not do what the journey needs.** It gives the pages `elements: null` through `window.__editor.setState`. That stops the editor once, but the design that `persistOnLeave` then writes is refused when it is opened again (`openDesign` runs `normalizeTexts`, which throws, and `Editor.tsx` shows "We couldn't open this design" instead of stopping again). Nine other damaged states were tried with a probe (apply the patch with `setState`, wait 1.5 s, see whether `.cf-crash` appears, reload, look again): page background as a string, a gradient without stops, an image without a source; `transition` as a string; page `name` and `notes` as numbers; an element of an unknown type; a shape with a gradient fill without stops: **none of them stops the editor at all** (the editor, the page strip and the page bar tolerate them), and a text element without `paragraphs` is refused on reload like `elements: null`. So no stored state that stops the render yet and still opens has been found.
     - *Suggested way out (a)*: make the stop **transient** and test the second stop by stopping it again after the reload: after the first crash and **Reload Craftly** the editor opens (the stored design is the last autosave, because a state that cannot be cloned or is not written leaves it), then damage again within two minutes: the count is 2, so "stopped again" and the open version list appear. A state that stops the render but cannot be saved: define a throwing getter on `design.title` (`Object.defineProperty`), which `Editor` reads on every render; the save then fails to clone it and the stored design stays the last autosave. Then "Before the problem" is the same as the stored one (so it may be "already kept"): use the list that is there ("Saved automatically" or "Before the problem") for the **Use this version** step.
     - *Suggested way out (b)*: try states that stop a render only after a selection (a shape with a gradient fill without stops, selected with `actions.select([id])`: the toolbar's fill button draws the stops) and see whether it can be made to stop at open by selecting on open; it probably cannot.
     - *Keep the unit-level proof*: `src/editor/Editor.test.tsx` ("keeps the last saved state as a version before it writes the one that was on the screen") already proves that a bad state is not the only copy.
   - *"a part of Craftly that cannot be fetched"*: the journey changes the hash in the same document, and by then the editor chunk is loaded, so nothing is fetched. Go to `about:blank`, then load the dashboard fresh, abort the editor module request (`/src/editor/Editor.tsx` on the dev server, `assets/Editor-*.js` in a build), then open a design. The dashboard may also preload the editor chunk; if so, abort it from the start of the page load.
   - *"Report a problem is under File, Help in the editor"* only failed because the design in that run had been damaged by the steps before.
   When it passes: add it to `e2e/run-all.cjs`, add its row to `e2e/README.md` (there is a placeholder row), and count it in the docs.
2. **Production build for the journeys.** The **Send report** button needs an address, so the build that the production journeys use must set `VITE_CRAFTLY_REPORT_URL=/__report` (`/__report` is answered by the journey's own routing, not by a server). Update the production e2e step of `.github/workflows/ci.yml` (it already sets `VITE_EXPOSE_STORE: "1"`, add `VITE_CRAFTLY_REPORT_URL: "/__report"` next to it) and the build command in `e2e/README.md`. Run `crash.cjs` on the production build under the enforced Content-Security-Policy (`connect-src 'self'` allows a path on the site).
3. **The usual verification**, as for every feature (see `docs/VERIFICATION.md`): a clean copy with `npm ci`, types, lint, format, `npm audit`, the whole suite with coverage (look for uncovered lines in the files of the code map: `npx vitest run <tests> --coverage --coverage.include=<file> --coverage.reporter=json` and read `coverage-final.json`), both builds, the dev journeys on a freshly started server, the production journeys under the enforced policy, deliberate breakages of the new code (one line at a time, run the tests that should notice; good candidates: the 12 fields of `Report`, `credentials: "omit"`, the noise rules, the crash-count window, `isCrashing()` in `persistOnLeave`, the label list of `earlierVersions`, `goBackToVersion` keeping "Before going back", the toast limits), then update the counts in the docs.
4. **Look at it in a browser by hand** (the browser pane of the desktop app at about 594 px wide, as for the Pen and Combine): the crash screen, the details, the dialog (its list and report side by side collapse to one column under 720 px: check it), the toast. The styles are in `src/components/ErrorBoundary.css`, `ReportPanel.css` and `problemsDialog.css`; their colours were not looked at.
5. **Accessibility** (see `docs/ACCESSIBILITY.md`, section for this work): not audited.
6. **Commit** the fixes of steps 1 to 5 on their own (the code itself is already in the repository, see "Done"), then the next feature of the plan.

### Open questions (not decided; the defaults are in the code)

- **Automatic sending.** Not built, on purpose: with no backend and the project's "nothing leaves the device" stance, a report is sent one at a time when the person presses Send. An "always send crash reports" setting would be a persistent switch, an auto-send in `problemCatcher` and the crash screen, and a rate limit; decide with the owner before adding.
- **A design that was saved in the state that stops Craftly and has no earlier version** (it is younger than five minutes, so the autosave has made no version): the screen can only offer **Save a copy** and **Go to your projects**. An idea: make a version when a design is opened and the newest version is older than half an hour.
- **Reload once on its own** for a part that could not be fetched after a deployment (the update prompt in `docs/UPDATES.md` covers open tabs; a tab that fails to fetch after the old files are gone is the case it does not cover).
- **A free-text note** in the report: left out so that a report cannot hold what a person typed about their design.
- **`keepBeforeProblem` only runs when there are unsaved edits** (`saveState` is not "saved" or "saving"). If the design had been autosaved when the screen stopped, the stored state is the one on the screen and nothing is kept, because there is nothing to protect from being written over; the earlier versions are the five-minute autosave versions.

### Gotchas met on the way

- A test that dispatches an `ErrorEvent` on `window` with nothing handling it makes Vitest report "Unhandled Errors" and exit with 1 (jsdom hands it to Vitest): test the listener bookkeeping with spies on `addEventListener`/`removeEventListener` instead.
- A toast that was dismissed stays in the DOM for about 200 ms with the class `is-leaving`: count `.cf-toast:not(.is-leaving)` or wait for it to go.
- The jsx-a11y rule `no-noninteractive-tabindex` flags the `pre` of the report; the repo's way is an `eslint-disable-next-line` comment with the reason (a scrolling region has to be reachable by keyboard), as in `PresentMode.tsx`.
- A function called `use...` that is not a hook fails `react-hooks/rules-of-hooks` (it was `useVersion`, now `goBack`).
- On Windows, module resolution is case-insensitive: `problemsDialog.ts` next to `ProblemsDialog.tsx` made `./ProblemsDialog` resolve to the wrong file.
- The working tree has mixed line endings (some files CRLF, many LF); the Edit tool copes, a script has to normalise `\r\n`, and `prettier --write` (`endOfLine: "auto"`) makes a file consistent.
