# How Craftly was verified

The evidence behind calling the app ready to deploy, as it stood on 2026-11-07, how to repeat each check, and what was not checked. The README says what the app does, [`ROADMAP.md`](ROADMAP.md) what is open, and [`ACCESSIBILITY.md`](ACCESSIBILITY.md) how it was audited for accessibility.

## Method

Everything below was run from a clean copy: the project folder without `node_modules`, `dist`, `dist-*` or `coverage`, then `npm ci` from `package-lock.json` (26 s, 288 top-level packages, no native add-ons). That shows that the repository holds everything it needs, and the numbers do not depend on what an earlier run left behind. The machine was Windows 11 with Node 26.13 and a local Chrome; **the GitHub Actions workflow has never run** (the repository has not been pushed to GitHub yet), so Linux and Node 22 are unchecked.

## Results

| Check | How to repeat | Result |
| --- | --- | --- |
| Packages | `npm ci`, `npm audit` | installs from the lockfile; 0 vulnerabilities, dev tools included (one `minimatch` advisory is overridden, see `CONTRIBUTING.md`) |
| Types | `npm run typecheck` | strict mode, no errors |
| Lint | `npm run lint` | ESLint with typescript-eslint, React hooks and jsx-a11y: 0 errors, 0 warnings in 673 files |
| Layout of the code | `npm run format:check` | every code file follows Prettier |
| Tests | `npm test` | 6,121 tests in 279 files pass |
| Coverage | `npm run coverage` | statements 99.41 %, branches 97.13 %, functions 99.66 %, lines 99.92 %; the gate is 95 % on each |
| Production build | `npm run build` | passes; about 4.8 MB without the 28.7 MB ONNX runtime, which is fetched when a photo tool is first used |
| Browser journeys, dev server | `npm run dev`, `npm run e2e` | 109 checks pass |
| Browser journeys, production build, with the offline check | `e2e/README.md` | 111 checks pass, served with a strict Content-Security-Policy enforced (the policy is in the README) |
| Browser journeys from a sub-folder (`/craftly/`) | `e2e/README.md` | the journeys of the editor, the dashboard, the on-device tools and offline use pass: 19, 7, 13 and 4 checks; the others were not run there |
| Lighthouse, production build, desktop and phone | DevTools, Lighthouse | accessibility 100, best practices 100, SEO 100; the experimental "agentic browsing" group flags a layout shift of 0.10 (desktop) and 0.06 (phone) while the dashboard loads, and the lack of an `llms.txt` |
| Do the tests notice a wrong line? | `src/test/README.md` | 23 lines were broken on purpose, one at a time: 22 were noticed, two of them only after two tests were added; the last still writes a valid GIF |
| The app, used by hand in a browser | the browser pane of the desktop app (Chrome 152) | dashboard, create dialog (custom size refused and accepted), projects, templates, brand kit, trash (restore, delete forever), the editor's tabs, insert, undo and redo, pages, the File-menu dialogs, Share, Resize, Present, Animate, and a design reopened after a reload |

## What the coverage number counts

The gate counts the code that ships. `vite.config.ts` leaves out the tests and their harness, the development pages (`src/dev`, the UI-kit gallery: 14 files, 1,639 statements, not in the production build) and two files that only run in a real browser (`src/ml/worker.ts`, `src/ml/ortRuntime.ts`: 5 statements, which `e2e/ml.cjs` runs). With the two browser-only files counted as uncovered the totals are 99.40, 97.14, 99.65 and 99.90 %. With the development pages counted as uncovered too they would be about 93.5, 92.6, 93.7 and 94.0 %.

The totals hide thin spots. Of 338 files, 214 are covered completely on all four measures; 53 are under 95 % on at least one, nearly always on branches. By folder the thinnest are `src/ml` (branches 94.1 %, functions 93.2 %, the model store, the service and the engine) and `src/data` (branches 94.8 %). Each folder is above 90 % on every measure.

## Not checked

- **GitHub Actions.** The workflow has never run.
- **Other browsers and devices.** Firefox, Safari, a real phone or tablet with touch, and a real screen reader (NVDA, VoiceOver) were not used. The journeys run in Chrome.
- **A real model download** from Hugging Face behind the Content-Security-Policy, and from a sub-folder. The journeys use hand-made models; the hosts in the policy for the real download are not verified.
- **Performance on weak hardware** beyond the measurements in [`ROADMAP.md`](ROADMAP.md). The dashboard shows a layout shift of 0.06 to 0.10 while its carousels appear.
- **Load.** There is no server to load: it is a static site.
