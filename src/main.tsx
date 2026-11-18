import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startCloud } from "./cloud/state";
import { startCustomFonts } from "./core/customFonts";
import { installDatabaseNotices } from "./databaseNotices";
import { m } from "./i18n";
import { installProblemCatcher } from "./problemCatcher";
import { registerServiceWorker } from "./serviceWorker";
import { installUploadNotices } from "./uploadNotices";

// The title of the tab in the language of the page (index.html has the English one): the screens that set no title of their
// own (the editor while it opens, a design that is not found, a shared link) keep it, and the others go back to it.
document.title = m.dashboard.pageTitles.home;

// Another tab upgrading the library, or holding up this tab's own upgrade, is told to the person (src/databaseNotices.ts).
installDatabaseNotices();

// What nothing else catches (an error in a handler, a failure that nothing waited for) is written down on this device, where
// "Report a problem" shows it (src/problemCatcher.ts, docs/CRASH-RECOVERY.md).
installProblemCatcher();

// An uploaded SVG that was more than plain drawing was stored as a picture: the person is told (src/uploadNotices.ts).
installUploadNotices();

// The fonts the person uploaded are read from the library and made known to everything that draws text, before the first
// design is drawn where that is possible; what draws earlier is drawn again when they are in (src/core/customFonts.ts).
void startCustomFonts();

// A person who signed in to an account server on this device: the sync engine starts (src/cloud/state.ts). Without a session
// this reads one record and does nothing more: no account code is loaded and no request goes out.
void startCloud();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: the service worker is only registered in production builds (it would fight Vite's HMR in dev). A new
// build waits until the person presses Reload (src/serviceWorker.ts).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is optional */
    });
  });
}

// Dev only (or a build made with VITE_EXPOSE_STORE=1 for end-to-end runs): expose the store so scripted tests and
// the console can inspect the document.
if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_STORE) {
  void import("./core/store").then(({ useEditor }) => {
    (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
  });
}
