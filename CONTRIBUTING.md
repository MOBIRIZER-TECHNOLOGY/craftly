# Contributing to Craftly

Thanks for helping. Craftly is a browser-only design editor (React 19, TypeScript in strict mode, Vite, Zustand, a custom 2D-canvas renderer). This page is what you need to make a change that passes review.

## Set up

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Requires Node 22.22.2+, 24.15+ or 26+ (`.nvmrc` pins 22): the test tools (Vitest 5 and jsdom 30) need these, while the dev server and the build alone also run on Node 20.19+. Two rules about dependencies: add one only when it is really needed, and never add one with a native add-on (`.node` file). The project builds with `@rollup/wasm-node` (see the `overrides` in `package.json`) precisely so that it runs on machines whose application-control policy blocks native modules. The other `overrides` are there for the linter: the jsx-a11y plugin names ESLint 9 as its newest peer and works on 10, and ESLint and typescript-eslint use a `minimatch` that `npm audit` flags (GHSA-g3hv-75wg-m249, fixed in 11.0.1). Remove those entries once ESLint and typescript-eslint depend on a patched `minimatch` themselves, and check that `npm audit` stays clean.

If the folder is inside OneDrive or Dropbox, exclude `node_modules` from syncing, and keep the git directory out of the synced folder too (`git init --separate-git-dir <a folder outside it>`): a sync client that touches the files of `.git` while git writes them can corrupt the repository.

The dev server does not watch `coverage/`, `dist/` and `dist-<name>/` folders (`server.watch.ignored` in `vite.config.ts`), so you can run a coverage run or build a copy next to it. On Windows a file watch on a folder that is then deleted keeps sending events, about 100,000 a second, and a dev server holding one stays at two or three CPU cores until it is stopped. If you add a folder that a tool deletes and writes again, add it to that list too.

## Before you open a pull request

Run these and say in the description that they passed:

```bash
npm run typecheck   # strict TypeScript, tests included
npm run lint        # ESLint (typescript-eslint, React hooks, accessibility); no warning allowed
npm run format:check # Prettier: the layout of the code (npm run format writes it)
npm run coverage    # all tests with V8 coverage; fails below 95 % on any measure
npm run build       # type-check and production build
```

If you changed anything a user can see, also start the dev server (`npm run dev`) and run `npm run e2e` in a second terminal; it drives the real app in Chrome. Add a screenshot or a short recording of the change to the pull request.

Also: update `CHANGELOG.md` under "Unreleased", and the README or `docs/` when behaviour they describe changes.

## How the code is organised

The folder map and the key ideas are in the [README](README.md); module contracts (fonts, renderer, store, catalogues, image sources) are in [`docs/DESIGN.md`](docs/DESIGN.md). In short: `src/core` is framework-free (document model, pure operations, store), `src/render` is the one canvas painter shared by the editor, thumbnails and every export, `src/editor` and `src/dashboard` are the two screens, `src/data` holds the catalogues.

## Conventions

- **Coordinates** are design pixels, origin top-left, y down; rotation in degrees clockwise about the element centre. Elements inside a group use the group's local space.
- **Documents are plain JSON.** Change them only through store actions (immer inside) or the pure functions in `core/ops.ts`; never mutate store state from a component.
- **One drag is one undo step.** Wrap gestures in `beginTransaction()` ... `endTransaction()`, or pass `{ coalesce: "key" }` to the action (edits with one key less than 1.2 s apart merge).
- **Text size** comes from layout: call `measureTextElement(el)` instead of computing heights in UI code.
- **Vector paths** are ordinary shapes (`shape: "path"`, path data in a 0 to 100 box). `src/core/pen.ts` is pure and holds the maths; `src/core/penShape.ts` is how a path sits in an element, and every edit goes through `patchForPath` so that points do not move on the page when the element is turned or mirrored. An overlay that reads the pointer has to take the workspace's place on the screen off the pointer (`[data-cf-workspace]`): in jsdom the workspace sits at 0, 0, so only a real browser (`e2e/pen.cjs`) shows the mistake, and `PathEditOverlay.test.tsx` moves it on purpose.
- **Stored data and the backup.** Anything that is kept in IndexedDB (a store in `core/persistence.ts`, a key in the `meta` store) is either in the library backup (`src/export/backup.ts`) or listed in [`docs/BACKUP.md`](docs/BACKUP.md) as left out on purpose. A change to a stored shape also has to be read by `parseStoredDesign` (a design) and to bump `BACKUP_FORMAT_VERSION` when an old app could misread a new backup. `core/persistence.dom.test.ts` pins the list of stores as a reminder.
- **What is stored** (the shape of a design, a project file, a backup, a record, the stores of the database) is versioned: a change to it follows the recipe in [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md). An optional field is named in `src/core/schema/persistedShapes.test.ts`; anything else raises a version, adds a migration step and adds frozen designs of the new version to `src/test/fixtures/schema/`, which are never edited. The compiler, the shape test and the registry check fail until you do; do not edit a step or a frozen design that has shipped.
- **The service worker** (`public/sw.js`) never calls `skipWaiting()` by itself: a new build waits until a page asks (the Reload notice), so that open tabs keep the code and the files they started with, and it keeps the build before the current one. A change to it is checked by `src/sw.test.ts` (the worker run against a fake Cache Storage) and `e2e/update.cjs` (two tabs across three builds in a real browser); [`docs/UPDATES.md`](docs/UPDATES.md) says why.
- **Styling:** one CSS file per component next to it, class names prefixed per package (`.cf-popover`, `.cf-tb__text`). Class names are global and a stylesheet that was loaded stays loaded, so a class belongs to one top-level package of `src` (dashboard, editor, ui ...): `cf-dshortcut` is the dashboard's, `cf-brandtab` the editor's Brand tab. `src/styles/classNames.test.ts` fails when two packages style one selector. Use only the CSS variables from `styles/tokens.css`.
- **Accessibility:** every icon-only button has an `aria-label` and a tooltip; menus and dialogs work with the keyboard (Esc closes, arrows move, Enter activates, focus goes back to what opened them); keep the visible focus ring; respect `prefers-reduced-motion`; text needs 4.5:1 contrast (words are `--c-ink` to `--c-ink-4`; the lighter `--c-ink-5` is for icons, borders and lines, and `src/styles/tokens.test.ts` checks the tokens); a button a pointer must hit is 24 × 24 px or has room round it. Tab belongs to the browser: only the canvas may borrow it, and only while it has the focus. What the last audit found and the rules it added are in [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md); `e2e/a11y.cjs` guards the keyboard behaviour.
- **Lint and format:** `npm run lint` passes with no warning. When a rule is wrong for one place, switch it off on that line and say why after `--` (`// eslint-disable-next-line jsx-a11y/no-autofocus -- the caller decides`); what the rules are, and why some are set the way they are, is in `eslint.config.js`. A name that is there on purpose and not used starts with an underscore (`_event`). Prettier sets the layout of the code (`.prettierrc.json`: `npm run format` writes it, and CI runs `npm run format:check`); stylesheets, documents and the catalogues in `src/data` are laid out by hand and Prettier skips them (`.prettierignore`).
- **Imports** use the `@/` alias. No default exports except lazily loaded React components.
- **Copy** is sentence case with plain verbs ("Add a text box", "Move to trash"); errors say what happened and how to fix it.

## Tests

Tests sit next to the code: `Foo.test.tsx` for components (jsdom), `foo.dom.test.ts` for DOM or canvas code without JSX, `foo.test.ts` for pure logic (Node). [`src/test/README.md`](src/test/README.md) explains the harness (a recording canvas, fake IndexedDB, observers) and what to watch for. The rules:

- Assert what a person sees or what changes in the document: roles, labels and text, `useEditor.getState()`, IndexedDB, what the recording canvas painted. No snapshots, and no test without an assertion.
- Query like a user (`getByRole("button", { name: "Share" })`); the browser journeys in `e2e/` show the real flows and control names.
- A bug fix comes with a test that fails without the fix.
- Never leave the order of typing, animation frames or lazy loading to timing: wait for the state you expect (`waitFor`, `findBy`), or control the clock.
- Do not lower the coverage thresholds in `vite.config.ts`.

## Common changes

| To add | Where |
| --- | --- |
| A shape | An entry in `SHAPES` in `src/render/shapePaths.ts` (id, name, group, path function). It appears in Elements > Shapes through `SHAPE_PRESETS` in `src/data/shapes.ts`. To list the same drawing under another name or size, add a preset like `ELLIPSE_PRESET` there and place it in `ALL_SHAPE_PRESETS` (`ShapesPage.tsx`). Tests: `src/data/presets.test.ts`, `ShapesPage.test.tsx` |
| A template | Add it to the list of one theme file in `src/data/templates/` (presentations, social or print); `src/data/templates/index.ts` collects them. The catalogue tests check the structure |
| A font | A package from `@fontsource` or `@fontsource-variable` in `package.json`, an entry in `src/render/fonts.ts` (definition and file loaders), and the matching face in `src/export/fontFiles.ts` so SVG and PDF export can embed it. Mind the licence: open fonts only |
| An Elements, text or context panel | `src/editor/panels` (left rail tabs in `tabs/`, panels for a selection in `context/`); toolbars in `src/editor/toolbar` |
| An export format | `src/export` (writers) and the Download panel (`DownloadPanel.tsx`) |
| An on-device model | An entry in `MODELS` in `src/ml/registry.ts` (repository, commit, size, SHA-256, licence, credits). Read the licence rules in [`docs/ON-DEVICE-AI.md`](docs/ON-DEVICE-AI.md) first, and try the model on a real GPU with `e2e/ml-probe.cjs` before wiring it in |

## Making a release

1. Run the three commands under "Before you open a pull request", then `npm run e2e` against the dev server and once more against a production build with `OFFLINE=1` ([`e2e/README.md`](e2e/README.md)); the CI workflow does both.
2. In `CHANGELOG.md`, rename "Unreleased" to the new version and its date and start a new empty "Unreleased" above it.
3. `npm version <x.y.z> --no-git-tag-version` sets the number in `package.json` and `package-lock.json`.
4. `npm run notices` when a package changed, then `npm run build` and publish `dist/` as the README's "Deploy" section describes. Tag the commit (`vX.Y.Z`) when the repository exists.

## Licence

Craftly is released under the [MIT licence](LICENSE). By sending a change you agree that it is released under the same licence.

## Reporting problems

Use the issue templates. For a security problem, do not open a public issue: read [`SECURITY.md`](SECURITY.md).
