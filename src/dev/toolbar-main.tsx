/**
 * Entry of the dev-only toolbar harness (dev-toolbar.html): the real Workspace with the contextual
 * toolbar, the mini toolbar and the right-click menu on top of the sample design. `window.__editor` is the
 * editor store, for scripted checks.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useEditor } from "@/core/store";
import { Workspace } from "@/editor/canvas/Workspace";
import { useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { installHotkeys } from "@/editor/hotkeys";
import { FloatingToolbar } from "@/editor/toolbar/FloatingToolbar";
import { MiniToolbar } from "@/editor/toolbar/MiniToolbar";
import { installContextMenu } from "@/editor/toolbar/contextMenu";
import { ContextMenuHost, ToastHost } from "@/ui";
import { sampleDesign } from "./sampleDesign";

/** Tiny read-out of the store state the toolbars drive, so screenshots show what a click did. */
function Readout() {
  const context = useEditor((s) => s.context);
  const selection = useEditor((s) => s.selection);
  const editing = useEditor((s) => s.editingTextId);
  const cropping = useEditor((s) => s.croppingId);
  const styleClipboard = useEditor((s) => s.styleClipboard);
  return (
    <div
      data-testid="readout"
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 5,
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(14,19,24,.82)",
        color: "#fff",
        font: "12px/1.5 ui-monospace, Consolas, monospace",
        pointerEvents: "none",
        maxWidth: 520,
      }}
    >
      context: {context ? JSON.stringify(context) : "none"} | sel: {selection.join(",") || "-"} | edit: {editing ?? "-"} | crop: {cropping ?? "-"} | style:{" "}
      {styleClipboard ? String(styleClipboard.__type) : "-"}
    </div>
  );
}

function Harness() {
  useEffect(() => {
    useEditor.getState().actions.openDesign(sampleDesign());
    const w = window as unknown as { __editor: typeof useEditor; __textSelection: typeof useTextSelectionStyle };
    w.__editor = useEditor;
    w.__textSelection = useTextSelectionStyle;
    const offKeys = installHotkeys();
    const offMenu = installContextMenu();
    return () => {
      offKeys();
      offMenu();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex" }}>
      <Workspace>
        <FloatingToolbar />
        <MiniToolbar />
      </Workspace>
      <Readout />
      <ToastHost />
      <ContextMenuHost />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
