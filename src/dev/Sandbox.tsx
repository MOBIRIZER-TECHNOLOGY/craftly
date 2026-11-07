import { useEffect } from "react";
import { useEditor } from "@/core/store";
import { Workspace } from "@/editor/canvas/Workspace";
import { installHotkeys } from "@/editor/hotkeys";
import { sampleDesign } from "./sampleDesign";

export function Sandbox() {
  useEffect(() => {
    useEditor.getState().actions.openDesign(sampleDesign());
    (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
    return installHotkeys();
  }, []);
  const actions = useEditor((s) => s.actions);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", gap: 8, padding: 8, background: "#fff", borderBottom: "1px solid #e3e5ea", font: "13px var(--font-ui)", alignItems: "center" }}>
        <b>Craftly sandbox</b>
        <button onClick={actions.undo} disabled={!canUndo}>
          Undo
        </button>
        <button onClick={actions.redo} disabled={!canRedo}>
          Redo
        </button>
        {(["select", "text", "shape", "line", "draw"] as const).map((t) => (
          <button key={t} onClick={() => actions.setTool(t)} style={{ fontWeight: tool === t ? 700 : 400 }}>
            {t}
          </button>
        ))}
        <button onClick={() => actions.zoomBy(1.25)}>+</button>
        <button onClick={() => actions.zoomBy(0.8)}>-</button>
        <button onClick={() => actions.setZoomMode("fit")}>Fit</button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <Workspace />
    </div>
  );
}
