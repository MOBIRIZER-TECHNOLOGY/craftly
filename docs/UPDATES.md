# Updates

How a new build reaches people who already use Craftly, and why an open tab is never changed under its user. The code is `public/sw.js` (the service worker), `src/serviceWorker.ts` (the page's side) and the stamping in `vite.config.ts`.

## What went wrong before

The worker called `skipWaiting()` the moment it had installed and `clients.claim()` and deleted the old build's files the moment it activated. A tab that had been open for days (or a second tab, when one of them was reloaded) was then served by a worker that no longer had the files its code asked for: the next lazily loaded screen, the editor opened for the first time in that tab, the Back up & restore dialog, failed to load (a 404): the dialog never opened, or the app's error screen appeared. Nothing told the person why, and a tab with unsaved work could not be told to wait. (`e2e/update.cjs` shows it: with the old kind of worker the second old tab fails exactly there.)

## What happens now

1. **A build is published.** The browser finds the new `sw.js` (it differs by its build id) when a page loads, and a tab that stays open asks for it when it comes back into view (see "Looking for updates").
2. **The new worker installs and waits.** It stores the app shell and every file of the build in its own cache (`craftly-<id>`), then does nothing more. The worker that runs keeps serving every open tab, from any build's cache, so a tab finds the files its own code asks for.
3. **A tab that is older than the waiting build says so.** A notice appears, "A new version of Craftly is ready. Reload to use it." with a **Reload** button. It has no time limit (and the toast stack, which keeps at most four toasts, retires toasts that leave by themselves before it, so other messages do not push it out), and it can be dismissed: it does not come back for that build, only for a newer one.
4. **Reload.** The tab writes the open design (the editor's autosave runs 0.7 s after a change, so a click just after an edit would not be saved otherwise), asks the waiting worker to take over, and reloads once the worker has. If saving fails or times out, the current tab keeps the editor open and offers Retry update. Only the tab where Reload was pressed reloads; the other tabs keep their page and their notice.
5. **The worker takes over.** It claims the open pages and deletes the caches of older builds, except the build that ran before it, so the second tab, still on the old code, still finds its files. The worker leaves unrelated caches on the same origin alone. The build before that one goes at the next update.
6. **Nobody presses Reload.** The waiting worker takes over by itself when every tab of the app has been closed, as browsers do, and the next visit runs the new build.

## A page that already runs the new build is not asked

Pages are fetched from the network first (an online reload always gives the newest page), so a tab opened or reloaded after a deployment runs the new build while the old worker still controls it and the new one waits. Asking that tab to reload would be noise. So the build writes its id into three places, `sw.js` (`BUILD_ID`), `precache.json` (`buildId`) and a meta tag of `index.html` (`craftly-build`), and a tab compares: it asks the waiting worker which build it is (a message with a reply port, `VERSION`) and reads its own id from the tag. Equal: nothing is shown. Different, or either side cannot say (the worker does not answer within 2 s, a dev server never stamped the page): the notice is shown, because a needless reload costs a click and a missed one can cost a lost tab.

The first visit is never offered anything: with no worker running the page yet, nothing that runs can have gone stale.

## Looking for updates

A browser checks for a new worker when a page loads, which a long-lived single page application seldom does. So `registerServiceWorker` also calls `registration.update()` when the tab comes back into view and when the connection comes back, at most once every 30 minutes. A failed look (no connection) is ignored; the next one tries again.

## When things go wrong

| What happens | What the page does |
| --- | --- |
| The waiting worker was replaced by an even newer one before Reload was pressed | After a successful save, it reloads and fetches the newest page |
| The worker does not take over within 5 s | After a successful save, it reloads using the active worker |
| The open design fails to save or its write is still unconfirmed after 4 s | The current editor stays open and shows **Retry update**. The waiting worker stays inactive unless another tab activates it. |
| The worker does not answer the question which build it is | The notice is shown |
| `postMessage` to the worker throws | The tab reloads |
| Another tab pressed Reload | This tab sees its controller change and does **not** reload; it keeps its page and its notice |

## Rules for changing this

- The worker never calls `skipWaiting()` on its own. It does so for the message `SKIP_WAITING`, which only a page sends, after the person pressed Reload.
- Keep the id in the three places in step: `vite.config.ts` (`offlineSupport`) stamps `sw.js` and `index.html` and writes `precache.json`, and `src/test/offlinePlugin.test.ts` pins that they agree.
- Keep one build back (the empty cache `craftly-active-<id>` is the marker of the build that ran last). Deleting the previous build's files at once brings the 404 back for a second tab.
- Serve `index.html`, `sw.js` and `precache.json` without a long cache (see `public/_headers`), or the new build is never found.
- `waitForFunction` in a journey does not wait for the promise that an async function returns: poll with `page.evaluate` (see `until` in `e2e/update.cjs`).

## Tests

- `src/sw.test.ts` runs the real `public/sw.js` against a fake Cache Storage and network (`src/test/swHarness.ts`): installing, waiting, being asked to take over, the version question, which caches survive, and every kind of request.
- `src/serviceWorker.dom.test.tsx`: when the notice is shown and when not, Reload with and without a save to wait for, the fallbacks above, the looks for a new version.
- `src/test/offlinePlugin.test.ts`: the build's ids and file lists.
- `e2e/update.cjs` plays a deployment in a real browser: two tabs on build A, build B published (and one lazily loaded file gone from the server), a third tab opened after the update, Reload in one tab with an edit that is not saved yet, the other tab and its old file, and a build C. It was checked by breaking the worker three ways (take over on install, keep no build back, ignore the request to take over): each is caught, at the step meant to catch it.

## A new build that changes how the library is stored

The waiting worker keeps old tabs on the old code, so for a while two builds can have the same library open. `docs/MIGRATIONS.md` says what each of them does: the tab that asks for a database upgrade waits for the others, a tab on this release writes its open design, says "Craftly was updated in another tab" and lets go, and an old tab that meets a library that was upgraded refuses to touch it until it is reloaded.

## Not done

- The notice has no counterpart in a menu, so a person who dismissed it must reload by hand (or wait for the next build).
- A notice that appears while a presentation is full screen is not held back.
- The notice does not say what changed.
