# Crash recovery and problem reports

**Status: finished and verified (2026-11-10).** Built on 2026-11-09 and committed unfinished with the live-editing work (`bc7eaf3`); the browser journey (`e2e/crash.cjs`, 20 checks), the tests that close the gaps, the deliberate breaks, the checks of access and the fixes that finished it were committed on 2026-11-10, in one commit with the fix that keeps the room key out of the address of the socket (the commit after `bc7eaf3`). After that commit the screen "We couldn't open this design" got the same way back as a crash (a design that `openDesign` refuses was a dead end; committed on 2026-11-10, in the commit after `7900782`). **Read "Status and what is left" at the end first** if you are here to continue or to fix something.

[`ROADMAP.md`](ROADMAP.md) item 6 ("No crash reporting") asked for opt-in error reporting with a clear privacy line, and a way to recover the last autosave after a crash. This is that work.

## What was wrong

- **A crash could make a design impossible to open.** An error while drawing the editor shows a calm screen (`ErrorBoundary`). But the editor's cleanup (`persistOnLeave` in `src/editor/Editor.tsx`) then wrote the state that was on the screen over the stored design, and that state can be the very thing that stopped the screen. Reloading opened it and stopped again, and the crash screen had no way to a version from before.
- **Errors that nothing caught were silent.** A handler that threw, a timer, a promise that rejected: no handler on `window`, so nothing was written down and the person saw a button that did nothing.
- **There was nowhere to report.** The only thing a person could do was read the error message on the crash screen.

## What a person sees

- **The screen stops.** The crash screen (`src/components/CrashScreen.tsx`) says what happened. For a design it says when the design was last saved ("Craftly stopped unexpectedly. Your design is saved on this device (last saved at 12:41), so reloading should bring you back to where you were."). A part of Craftly that could not be fetched (a deployment replaced a file, or the network is gone) gets its own heading and text ("Check your connection, then reload"). The keyboard goes to **Reload Craftly**. **Go to your projects** leaves the screen.
- **The same design stops it again** (twice within two minutes, in the same tab): the screen says "Craftly stopped again when this design was opened" and opens **Go back to an earlier version**: the newest five versions with when and where each came from ("Before the problem", "Saved automatically", "Saved by you", ...), each with **Use this version**, which puts that version's pages in the design (the title and the rest stay), keeps what was there as a version called "Before going back", and reloads. **Save a copy of the design to a file** writes the stored design as a `.craftly` file without opening it. Both work from the library alone, because the editor is what may not open.
- **A design that cannot be opened.** When the stored design is refused by `openDesign` (a text without `paragraphs`, pages with no elements: what a state that stopped the screen and was stored may leave), the editor says "We couldn't open this design" and, under **Back to home**, shows the same **Go back to an earlier version** section as the crash screen, open: **Use this version** (what was there is kept as "Before going back") and **Save a copy of the design to a file**. It is shown on this screen only: not for a design that is not there, and not where a reload or an update is the way on (a design saved by a newer Craftly, or one that could not be brought up to date).
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
- **Browser journeys on a production build** need the button, so build with `VITE_EXPOSE_STORE=1 VITE_CRAFTLY_REPORT_URL=/__report npx vite build --outDir dist-e2e` (see `e2e/README.md`; the CI workflow sets the variable). In Git Bash on Windows put `MSYS_NO_PATHCONV=1` in front, or the shell turns `/__report` into a path in the Git folder and the build has no Send button.

## How it works (code map)

| File | Job |
| --- | --- |
| `src/core/problems.ts` | The log (`recordProblem`, `listProblems`, `markProblemSent`, `clearProblems`, 20 entries, dedupe within 60 s, falls back to memory when storage fails), the cleaning (`cleanMessage`, `cleanStack`), the noise rules (`isNoise`), `kindOfLoadFailure`, `routeOf`, `describeBrowser`, the report (`buildReport`, `reportText`), `reportEndpoint`, `sendReport`. Kinds: `screen`, `panel`, `script`, `promise`, `save`, `load` (a `screen` problem whose message says a file could not be fetched is recorded as `load`). |
| `src/core/recovery.ts` | `noteCrash`/`crashCount` (per design, two minutes, in `sessionStorage` key `craftly.crashes.v1`, so a reload does not forget), `markCrashing`/`isCrashing` (a module flag), `keepBeforeProblem` (saves the stored design as a version "Before the problem", unless it is the newest version already), `earlierVersions`, `goBackToVersion`, `savedAt`. Works from the library alone. |
| `src/core/clipboardText.ts` | `copyText`: the clipboard API, then a hidden field and `execCommand`. |
| `src/components/ErrorBoundary.tsx` | Writes the crash down (`recordProblem("screen", ...)`), counts it for the design (`designId` prop, which `App.tsx` gives for `#/design/:id`), and sets `markCrashing(true)` **in `getDerivedStateFromError`** on purpose: it has to be set before the editor's passive-effect cleanup runs, and `componentDidCatch` runs earlier than that cleanup but a flag set in the render phase is the one that cannot be late. Cleared by `recover()` (route change or **Go to your projects**). |
| `src/components/CrashScreen.tsx` | The screen above. |
| `src/components/RecoveryPanel.tsx` | The ways back for a design that cannot be used, a `details` section named **Go back to an earlier version**: the earlier versions to put back (`earlierVersions`, `goBackToVersion`, then a reload) and a copy of the design to save to a file. Works from the library alone. Shown by the crash screen (open from the second stop) and by the editor's screen "We couldn't open this design" (always open). |
| `src/editor/Editor.tsx` (the `broken` status), `editor.css` | When `openDesign` refuses the stored design, the screen "We couldn't open this design" shows `RecoveryPanel` under **Back to home** (`.cf-editor-state__recovery`). |
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
| `src/core/problems.test.ts` | 22 | Message and stack cleaning, noise, load-failure words, route names, browser description (down to iOS, ChromeOS and no system), the 12-field report. |
| `src/core/problems.dom.test.ts` | 23 | The log in `localStorage` (order, dedupe, cap, storage failing and working again, a list cleared in another tab not coming back, corrupt storage, sent mark), the build a report names, `reportEndpoint` rules, `sendReport` (what is posted, failure, timeout, nothing of the design). |
| `src/core/recovery.dom.test.ts` | 15 | Crash counts, the flag, `keepBeforeProblem`, `earlierVersions`, `goBackToVersion`, `savedAt` (fake IndexedDB). |
| `src/core/clipboardText.dom.test.ts` | 4 | Clipboard, fallback, failure. |
| `src/components/ReportPanel.test.tsx` | 11 | Report text, with and without an address, copy, download, send, failure, sending state. |
| `src/components/ProblemsDialog.test.tsx` | 10 | The list, choosing, the sent mark, clearing, closing, the lazy host and each opening starting fresh. |
| `src/components/CrashScreen.test.tsx` | 10 | Both kinds of screen, focus, the saved time, the repeated stop, the way back for a design, a library that cannot be read. |
| `src/components/RecoveryPanel.test.tsx` | 8 | Open or folded as it is told, the versions of this design only, nothing to go back to, a library that cannot be read, going back and the reload, a version that cannot be put back (the buttons work again), a copy to a file (and another can be made), a copy that cannot be saved. |
| `src/components/ErrorBoundary.test.tsx` | +6 | The problem written down, the flag, the counts per design. |
| `src/problemCatcher.dom.test.tsx` | 9 | Errors and rejections, noise, the toast rules (a problem that came again is not told, whether or not it was the first time), the Details button, uninstalling. |
| `src/test/devReportEndpoint.test.ts` | 7 | The dev server's answer to `/__report`. |
| `src/editor/Editor.test.tsx` | +4 | What is kept when the editor goes away because the screen stopped. |
| `src/editor/Editor.test.tsx` | +2 | A damaged design gets the way back (the versions open, one put back and the page reloaded), or is told that there are none and still offered a copy; the screens for a missing design and for a design from a newer or an older Craftly do not show it. |
| `autosave.dom.test.ts`, `shared.test.tsx`, `Shell.test.tsx`, `FileMenu.test.tsx`, `src/main.dom.test.ts` | +5 | A failed save and a stopped panel are written down, the two menu entries, the catcher is installed at start. |

## Status and what is left

### Done (2026-11-10)

Everything in "How it works" exists, is tested, and was tried in real browsers. It was committed unfinished on 2026-11-10 with the live-editing work (commit `bc7eaf3`); what is described here was done after that and committed on 2026-11-10, in one commit with the fix that keeps the room key out of the address of the socket.

- **Tests.** 135 new tests (123 when it was built, 12 more while it was finished). Every statement and branch of the files in the code map is covered: a run of those files alone (`npx vitest run <tests> --coverage --coverage.include=<file> --coverage.reporter=json`, read from `coverage-final.json`) lists nothing that no test reaches. The whole suite, with the numbers of the last run, is in [`VERIFICATION.md`](VERIFICATION.md).
- **Deliberate breaks.** 75 lines were broken on purpose, one at a time on a clean copy, and the tests that should notice were run: the cleaning of messages and stacks, the noise rules, the list (its minute, its twenty, the copy in memory), what is sent (`credentials: "omit"`, no referrer, no cache, exactly the text that was shown, the ten seconds, a refusal not marked as sent, the twelve fields), the crash count and its two minutes, keeping the stored design before it is written over, the labels and the five versions, going back (keeping "Before going back", the right design, the title staying), the screen (the text of the second stop, the versions opening, the keyboard on Reload, the load failure, the copy to a file), the report panel, the catcher (the three toasts, the minute, a problem that came again, a crash screen on show, Details), and the places that write down or open (the editor, autosave, a panel, both menus, `main.tsx`, the development endpoint). The first pass caught 74; the survivor, "a problem that came again is told again" (the minute between notices hid it), got a test and is caught: 75 of 75. 17 more, of the way back on the screen that cannot open a design (the panel, that screen, and the crash screen's use of it), one at a time on a clean copy: all caught, so 92 of 92.
- **Browser.** `e2e/crash.cjs` has 20 checks, is in `npm run e2e` and in CI, and passes on the dev server and on the production build under the enforced Content-Security-Policy, with no violation. How it makes the editor stop twice is explained below; its last step of the first half tries a state that is stored as well (a design that is stored damaged is refused with the way back on the screen that says so, read and put back).
- **Looked at, and access.** The screens were looked at in the screenshots of the journey (the crash screen at 1280 px, the dialog at 594 px), and the journey measures the keyboard walk, the contrast of the text, the size of the controls and the fit of a narrow window (`docs/ACCESSIBILITY.md`).
- **Found and fixed while finishing it.** (1) A list of problems that was cleared in another tab came back with the next problem, because the page's own copy was used whenever nothing was stored; it is used now only while the browser refuses to store. (2) The headings of the two folded sections of the crash screen were 20 px tall, and the project's minimum is 24 (now 28). (3) The list of problems in the dialog was a `listbox` of `option` rows, which promises arrow keys that were never there; it is a plain list of buttons, the current one with `aria-current`. (4) Two guards in the crash screen that its buttons could never reach were taken out. (5) The build of the journeys in CI now sets `VITE_CRAFTLY_REPORT_URL=/__report`.
- **The screen that cannot open a design** (after the owner chose "Fix it first", 2026-11-10; committed the same day, after `7900782`). A stored design that `openDesign` refuses (the state that stops the screen, when it is stored too) left the person on "We couldn't open this design" with only **Back to home**: what `keepBeforeProblem` had kept could not be reached. The versions-and-copy section of the crash screen is now a component of its own (`RecoveryPanel`), and that screen shows it, open, under the button. Tests came first (the two new editor tests and the new panel's tests failed, then passed); every line of the new code is covered; the journey tries it in a real browser and measures its contrast, its controls and its fit at 375 px.

### How the journey makes the editor stop twice

No state is known that stops the screen **and** is stored so that the design still opens: the nine that were tried stop nothing, and a design with pages that have no elements stops the editor once but is refused by `openDesign` afterwards ("We couldn't open this design", which is not a stop of the screen). So the journey gives the store a state that stops the editor at once (pages with no elements) and that cannot be stored (the design also carries a function, which IndexedDB refuses to keep). When the editor goes away, the stored design is kept as a version ("Before the problem") and the write fails, so the stored design stays the last autosave: a reload opens it with its three shapes, and stopping it again within two minutes is the second stop (the count is 2: "Craftly stopped again", the versions open). From the count on, that is the path of a real repeated stop. The step after "Go to your projects" then tries the other case, the same state **stored** (no function in it): the editor keeps the stored design as a version ("Before the problem") and writes the damaged state over the design, a reload gives "We couldn't open this design", and the earlier versions on that screen put the design back with its three shapes. The unit test of the editor (`Editor.test.tsx`, "keeps the last saved state as a version before it writes the one that was on the screen") shows the keeping on its own.

### Left

- **A screen reader and axe-core** were not used on the new screens (the permission to fetch axe that the first audit used is spent). The screens were looked at in the journey's screenshots (real Chrome), not in the browser pane of the desktop app.
- **A report address.** Nobody has named one: a build made without `VITE_CRAFTLY_REPORT_URL` has no **Send report** button, and a report can only be copied or downloaded. That is the owner's to decide (see "Configuration").

### Open questions (not decided; the defaults are in the code)

- **The other screens that refuse a design** do not show the earlier versions: "Update Craftly to open this design" (saved by a newer Craftly: a reload is the way on) and "We couldn't bring this design up to date" (nothing has been changed, and the stored design is the one the person wants back). Whether either should offer them is not decided.

- **Automatic sending.** Not built, on purpose: with no backend and the project's "nothing leaves the device" stance, a report is sent one at a time when the person presses Send. An "always send crash reports" setting would be a persistent switch, an auto-send in `problemCatcher` and the crash screen, and a rate limit; decide with the owner before adding.
- **A design that was saved in the state that stops Craftly and has no earlier version** (it is younger than five minutes, so the autosave has made no version): the screen can only offer **Save a copy** and **Go to your projects**. An idea: make a version when a design is opened and the newest version is older than half an hour.
- **Reload once on its own** for a part that could not be fetched after a deployment (the update prompt in `docs/UPDATES.md` covers open tabs; a tab that fails to fetch after the old files are gone is the case it does not cover).
- **A free-text note** in the report: left out so that a report cannot hold what a person typed about their design.
- **`keepBeforeProblem` only runs when there are unsaved edits** (`saveState` is not "saved" or "saving"). If the design had been autosaved when the screen stopped, the stored state is the one on the screen and nothing is kept, because there is nothing to protect from being written over; the earlier versions are the five-minute autosave versions.

### Gotchas met on the way

- In Git Bash on Windows, `VITE_CRAFTLY_REPORT_URL=/__report npx vite build` makes the value `C:/Program Files/Git/__report` (the shell converts what looks like a path), so the build has no **Send report** button and `crash.cjs` fails at Send. Put `MSYS_NO_PATHCONV=1` in front. CI on Linux is not affected.
- `page.route` does not see a request that a service worker answers, so `crash.cjs` opens its browser context with `serviceWorkers: "block"`; otherwise the refusal of the editor's file would not reach a production build.
- The editor's module is `src/editor/Editor.tsx` on the development server and `assets/Editor-<hash>.js` in a build; the pattern that refuses it (`/\/Editor(?:-[^/]*)?\.(?:js|tsx)(?:\?.*)?$/`) has to match both and not `ChartEditor.tsx`. The first one matched only the build, so nothing was refused on the dev server.
- The page's own list of problems was used whenever `localStorage` had none, so a key removed from outside (another tab, a journey) came back with the next problem. The copy in memory is now used only while the last attempt to store failed.

- A test that dispatches an `ErrorEvent` on `window` with nothing handling it makes Vitest report "Unhandled Errors" and exit with 1 (jsdom hands it to Vitest): test the listener bookkeeping with spies on `addEventListener`/`removeEventListener` instead.
- A toast that was dismissed stays in the DOM for about 200 ms with the class `is-leaving`: count `.cf-toast:not(.is-leaving)` or wait for it to go.
- The jsx-a11y rule `no-noninteractive-tabindex` flags the `pre` of the report; the repo's way is an `eslint-disable-next-line` comment with the reason (a scrolling region has to be reachable by keyboard), as in `PresentMode.tsx`.
- A function called `use...` that is not a hook fails `react-hooks/rules-of-hooks` (it was `useVersion`, now `goBack`).
- On Windows, module resolution is case-insensitive: `problemsDialog.ts` next to `ProblemsDialog.tsx` made `./ProblemsDialog` resolve to the wrong file.
- The working tree has mixed line endings (some files CRLF, many LF); the Edit tool copes, a script has to normalise `\r\n`, and `prettier --write` (`endOfLine: "auto"`) makes a file consistent.
