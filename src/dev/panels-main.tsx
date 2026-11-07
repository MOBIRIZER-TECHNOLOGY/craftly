/**
 * Harness for the left rail + side panel: lays out <LeftRail/> <SidePanel/> <Workspace/> side by side like the real
 * editor, on the sample design. Open /dev-panels.html on the panels dev server (see vite.dev-panels.config.ts).
 * `window.__editor` exposes the store for scripted checks.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useEditor } from "@/core/store";
import { Workspace } from "@/editor/canvas/Workspace";
import { installHotkeys } from "@/editor/hotkeys";
import { LeftRail } from "@/editor/panels/LeftRail";
import { SidePanel } from "@/editor/panels/SidePanel";
import { ConfirmHost, ContextMenuHost, ToastHost } from "@/ui";
import { sampleDesign } from "./sampleDesign";

declare global {
  interface Window {
    __editor: typeof useEditor;
  }
}

function Harness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const design = sampleDesign();
    if (params.get("empty")) design.pages.forEach((p) => (p.elements = []));
    useEditor.getState().actions.openDesign(design);
    window.__editor = useEditor;
    const tab = params.get("tab");
    if (tab) useEditor.getState().actions.setLeftTab(tab as never);
    setReady(true);
    return installHotkeys();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          height: "var(--topbar-h)",
          flex: "none",
          background: "var(--grad-brand)",
          color: "var(--c-ink-inverse)",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          fontWeight: 700,
        }}
      >
        Craftly - panels harness
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <LeftRail />
        <SidePanel />
        {ready ? <Workspace /> : null}
      </div>
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
