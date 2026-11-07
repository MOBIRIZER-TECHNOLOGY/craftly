import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: the service worker is only registered in production builds (it would fight Vite's HMR in dev).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
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
