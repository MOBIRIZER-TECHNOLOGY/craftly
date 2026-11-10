# Handoff: where Craftly stands and how to pick it up

Written on 2026-11-10 (evening), at the owner's request, so that the owner, another developer or another assistant (a later Claude session, for instance) can continue without the conversation that built this. The dated implementation notes below are historical. See the latest verification for current test results.

## What this is

Craftly is a browser-only graphic design studio in the manner of Canva: React 19, strict TypeScript, Vite, a Zustand store with immer, its own canvas renderer, IndexedDB for storage, no backend (an optional live server for editing together is the one exception, `npm run server`). It lives in `C:\Users\pawan\OneDrive\Desktop\RnD\REA\craftly`. The README tells a person what it does; [`DESIGN.md`](DESIGN.md) is the architecture.

## The state on 2026-11-10 (evening)

**Git.** Branch `main`, no remote, **nothing has ever been pushed**, so the GitHub Actions workflow has never run. The git directory is outside OneDrive on purpose (`C:\Users\pawan\.gitdirs\craftly.git`; the file `.git` in the project points to it). The latest commits, newest first:

| Commit | What it holds |
| --- | --- |
| `d96ddf2` | the way back (earlier versions, a copy as a file) on the screen that says a design cannot be opened |
| `7900782` | the room key kept out of the socket address, and crash recovery finished |
| `bc7eaf3` | live editing with other people, attached lines (Connect), crash recovery in progress, the security hardening of what arrives |
| `5549807` | Combine shapes (union, subtract, intersect, exclude) and Convert to path |
| `a1acefb`, `0ae5050` | the Pen tool and the five problems that testing it by hand found |
| `0cb51a3` | Back up & restore, the update prompt, versioned storage with migrations |

**Not committed: blend modes** (feature 3 of the plan below). It is built, tested first and checked in a real browser; the owner has not yet said to commit it. The changes: `src/core/blend.ts` and its test, `BlendMode` and `blend?` in `src/core/types.ts`, the layer painter in `src/render/renderPage.ts`, the SVG style in `src/export/svg.ts`, `releaseLayers()` in `src/export/raster.ts`, the check in `src/collab/protocol.ts`, ungrouping in `src/core/ops.ts`, the Blend mode box in `src/editor/toolbar/common.tsx`, the thumbnail in `src/editor/panels/context/LayerThumb.tsx`, tests in a dozen files, `src/render/blend.dom.test.ts`, `e2e/blend.cjs` (registered in `e2e/run-all.cjs`), and the documents (`docs/BLEND-MODES.md`, README, CHANGELOG, SECURITY, CONTRIBUTING, ACCESSIBILITY, COLLABORATION, DESIGN, ROADMAP, MIGRATIONS, the plans, `e2e/README.md`). `git status` lists them. When the owner says to commit, one commit is what the earlier features got; the message style is that of `git log` and it ends with the `Co-Authored-By` line that the tool in use asks for.

**Historical blend-mode baseline.** The checks for that snapshot passed on 2026-11-10 (details and what they found: "Blend modes" in [`VERIFICATION.md`](VERIFICATION.md)): types; 339 test files with 7,693 tests (132 of them new) and coverage of 99.32 % statements, 97.24 % branches, 99.53 % functions and 99.86 % lines; format; lint (796 files, no error or warning); `npm audit` (0 vulnerabilities); the build; every browser journey, 232 checks on a freshly started dev server and 246 on a production build under the enforced Content-Security-Policy with no violation (250 different ones, 20 of them the new `e2e/blend.cjs`); and 50 deliberate breaks of the new code, 49 noticed and one that changes nothing. The one weak point that is known and measured is the cost of many elements with a mode on a big canvas ([`BLEND-MODES.md`](BLEND-MODES.md), "Cost").

**The plan the owner approved on 2026-11-09 ("implement all of them one by one"):**

| # | Feature | State |
| --- | --- | --- |
| 1 | Combine shapes | done, committed (`5549807`) |
| 2 | Crash recovery and opt-in problem reports | done, committed ([`CRASH-RECOVERY.md`](CRASH-RECOVERY.md)) |
| 3 | **Blend modes** | built and checked, **not committed** ([`BLEND-MODES.md`](BLEND-MODES.md)) |
| 4 | Check design: low-contrast text, tiny text, missing alternative text, no AI | not started |
| 5 | Reusable colour and text styles tied to the brand kit | not started; it is the first **real** change of the stored format (a version and frozen designs, see [`MIGRATIONS.md`](MIGRATIONS.md)) |
| 6 | Small wins: a font weight picker, a link editor, grid and margin snapping with equal spacing, a picture as the page background, automatic page numbers, CSV import for charts | not started |
| 7 | MP4 export with WebCodecs (Mediabunny, MPL-2.0, one dependency, newer browsers only) | not started |

Around it, the owner asked on 2026-11-09 to make Craftly "investor ready", with diagrams and several people editing at once: [`INVESTOR-READINESS.md`](INVESTOR-READINESS.md) has the milestones M0 to M6 (M1 diagrams: the first part, attached lines, is done; M2 together: live editing works end to end, with edit and view links, with shared uploads now available and presence and review still proposed), and [`PLAN-DIAGRAMS-AND-COLLABORATION.md`](PLAN-DIAGRAMS-AND-COLLABORATION.md) has the plan and the **decisions that are the owner's** (hosting, links or accounts, hosted AI, pictures in shared designs, a whiteboard design type, what to do with the Driftboard project zip, the wording of the privacy promise). Features 4 to 7 fit between M1 and M2.

**Open and waiting for the owner:** putting the repository on GitHub so that CI runs for the first time; a contact address for reports, which a `CODE_OF_CONDUCT.md` needs and which does not exist yet ([`ROADMAP.md`](ROADMAP.md): fifteen minutes with that address); the Driftboard zip (`C:\Users\pawan\Downloads\driftboard-2026-11-08-3.zip`), which is not deleted and is not to be without asking; hosting and rollout decisions for the collaboration work.

**Readiness handoff.** The working tree includes 16 verified fixes for saves, collaboration, portable files, service-worker updates and room readiness. The [verification record](VERIFICATION.md#production-readiness-regressions) separates current tests from historical measurements. Prioritize collaboration next. Presence, pinned comments, commenter permissions, safer same-object editing and revision-specific approval remain proposals, along with bulk creation, campaign packs and the design quality checker.

## How to run and check things

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm test             # the whole suite (two projects: node for *.test.ts, jsdom for *.test.tsx and *.dom.test.ts)
npm run coverage     # fails below 95 % on statements, branches, functions or lines
npm run typecheck
npm run lint         # ESLint, no warning allowed
npm run format:check # Prettier (npm run format writes)
npm run build
npm run e2e          # every browser journey against BASE (default http://127.0.0.1:5173): start npm run dev first
```

The browser journeys (`e2e/`, [`e2e/README.md`](../e2e/README.md)) drive a real Chrome or Edge through playwright-core and read pixels. Run them on a **freshly started** dev server (one that has seen edits breaks the job-layer steps of `ml.cjs`), and once on a production build served with the Content-Security-Policy of the README enforced (`OFFLINE=1`, and `MSYS_NO_PATHCONV=1` in Git Bash when a variable holds a path that starts with a slash). [`VERIFICATION.md`](VERIFICATION.md) says how each check was done and how to repeat it, including the clean copy and the deliberate breaks ("mutation spot checks"). The scripts that automated those runs were helpers in the temporary folder of the assistant's session and are not part of the repository.

## How work is done here

- **Tests first, seen to fail.** Write the tests of a feature before the code and run them to see them fail for the right reason, then build. After it works, break lines of the new code on purpose, one at a time, on a **clean copy of the project outside OneDrive**, and check that a test notices each break; count a break as caught only when a test ran and failed (a copy with a damaged `node_modules` makes every test fail to start, and that is not a catch).
- **One verified feature at a time**, then the numbers into the documents, then the owner is asked about committing. **Commit only when the owner says so**; never push (there is no remote).
- **The stored format is a promise** ([`MIGRATIONS.md`](MIGRATIONS.md)): an optional field needs no version but must be named in `src/core/schema/persistedShapes.test.ts` and have a default in every reader; anything else is a new version with a migration step and frozen designs.
- **What arrives from outside is checked against a list of what is allowed**, never a pattern for what to keep out ([`SECURITY.md`](../SECURITY.md), [`COLLABORATION.md`](COLLABORATION.md)): a value that reaches a canvas, a file or the page by name needs a line in `checkValue` of `src/collab/protocol.ts` and a reader that cannot be fooled (see how `blend` does it).
- **Documents are part of the work**: README (what a person gets), CHANGELOG, the feature's own document, ACCESSIBILITY for new controls, VERIFICATION for the evidence, ROADMAP and the plans for status. Counts in them come from the real runs, not from memory.
- **Line endings.** On this Windows machine the files of the working tree are CRLF, `.gitattributes` says LF in the repository (`* text=auto eol=lf`) and Prettier is `endOfLine: auto`. A script that edits a file must keep the line ending that the file has; git's warning that CRLF will be replaced by LF is expected.
- **Replies** are in English, and in Hindi when the owner writes Hindi. On-device only for AI features (no hosted service), few model downloads, and the size of a model is said before it is proposed.

## Where things are written down

| Document | What is in it |
| --- | --- |
| [`../README.md`](../README.md), [`../CHANGELOG.md`](../CHANGELOG.md) | what a person gets, the known limitations, every change |
| [`DESIGN.md`](DESIGN.md) | the architecture: model, renderer, store, catalogues |
| [`ROADMAP.md`](ROADMAP.md) | what to improve next, with the status of each item |
| [`INVESTOR-READINESS.md`](INVESTOR-READINESS.md), [`PLAN-DIAGRAMS-AND-COLLABORATION.md`](PLAN-DIAGRAMS-AND-COLLABORATION.md) | the milestones M0 to M6 and the plan for diagrams and editing together, with the owner's open decisions |
| [`BLEND-MODES.md`](BLEND-MODES.md), [`CRASH-RECOVERY.md`](CRASH-RECOVERY.md), [`COLLABORATION.md`](COLLABORATION.md), [`BACKUP.md`](BACKUP.md), [`UPDATES.md`](UPDATES.md), [`ON-DEVICE-AI.md`](ON-DEVICE-AI.md), [`MIGRATIONS.md`](MIGRATIONS.md) | one feature or mechanism each: model, code map, decisions, limits, tests |
| [`ACCESSIBILITY.md`](ACCESSIBILITY.md), [`../SECURITY.md`](../SECURITY.md), [`VERIFICATION.md`](VERIFICATION.md) | the audit and the rules for new work, the threat model and what is checked, the evidence |
| [`DEMO.md`](DEMO.md), [`REA-REPORT.md`](REA-REPORT.md), `../reports/` | a three-minute demo script, how the Canva web application was studied, the comparison with Canva and Figma |

## Asking an assistant to continue

Say what you want next and point it at this file. For example:

> Read `docs/HANDOFF.md` in the Craftly project (and the memory notes if you have them), then `git status` and `docs/BLEND-MODES.md`. Blend modes are built and checked but not committed. [Commit them / start feature 4, Check design / ...]. Follow "How work is done here": tests first, one verified feature, documents updated with real numbers, and ask before committing.
