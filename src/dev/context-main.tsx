/** Entry of the dev-only context panels harness (dev-context.html): a 340px side panel next to the real canvas. */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getActions, getActivePage, useEditor, type ContextPanelState } from "@/core/store";
import type { DesignElement } from "@/core/types";
import { sampleDesign } from "@/dev/sampleDesign";
import { Workspace } from "@/editor/canvas/Workspace";
import { installHotkeys } from "@/editor/hotkeys";
import { ContextPanel } from "@/editor/panels/context";

const CSS = `
.h-bar { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:center; padding:8px 10px; background:#fff; border-bottom:1px solid var(--c-line); font:12px var(--font-ui); }
.h-group { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.h-group > b { color:var(--c-ink-3); font-weight:700; margin-right:2px; }
.h-bar button { height:26px; padding:0 8px; border:1px solid var(--c-line-strong); border-radius:6px; background:#fff; font:12px var(--font-ui); cursor:pointer; }
.h-bar button:hover { background:var(--c-hover); }
.h-bar button.on { background:var(--c-primary-soft); border-color:var(--c-primary); color:var(--c-primary); }
.h-main { display:flex; flex:1; min-height:0; }
.h-side { display:flex; flex-direction:column; flex:none; width:340px; min-height:0; background:#fff; border-right:1px solid var(--c-line); }
.h-none { margin:auto; padding:24px; color:var(--c-ink-4); font:13px var(--font-ui); text-align:center; }
`;

type Pick = (els: DesignElement[]) => DesignElement | undefined;

const byType =
  (type: DesignElement["type"], n = 0): Pick =>
  (els) =>
    els.filter((e) => e.type === type)[n];
const textWith =
  (needle: string): Pick =>
  (els) =>
    els.find((e) => e.type === "text" && JSON.stringify(e.paragraphs).includes(needle));
const shapeNamed =
  (shape: string): Pick =>
  (els) =>
    els.find((e) => e.type === "shape" && e.shape === shape);

const SELECTIONS: Array<[string, Pick]> = [
  ["Title", (els) => els.find((e) => e.id === "title")],
  ["Subtitle", textWith("standalone")],
  ["Image", byType("image")],
  ["Ellipse", shapeNamed("ellipse")],
  ["Button", shapeNamed("rect")],
  ["Star", shapeNamed("star")],
  ["Neon", textWith("Neon")],
  ["Curved", textWith("CURVED")],
  ["Chart", byType("chart")],
  ["Graphic", byType("graphic")],
  ["Line", byType("line")],
  ["Table", byType("table")],
];

function selectBy(pick: Pick) {
  const a = getActions();
  const design = useEditor.getState().design;
  if (!design) return;
  for (const page of design.pages) {
    const el = pick(page.elements);
    if (el) {
      a.setActivePage(page.id);
      a.select([el.id]);
      return;
    }
  }
}

const PANELS: Array<[string, ContextPanelState]> = [
  ["Arrange", { kind: "position", tab: "arrange" }],
  ["Layers", { kind: "position", tab: "layers" }],
  ["Effects", { kind: "effects" }],
  ["text", { kind: "color", target: "text" }],
  ["fill", { kind: "color", target: "fill" }],
  ["stroke", { kind: "color", target: "stroke" }],
  ["shadow", { kind: "color", target: "shadow" }],
  ["effect", { kind: "color", target: "effect" }],
  ["page", { kind: "color", target: "page" }],
  ["graphic", { kind: "color", target: "graphic" }],
  ["Font", { kind: "font" }],
  ["Filters", { kind: "filters", tab: "filters" }],
  ["Adjust", { kind: "filters", tab: "adjust" }],
  ["Background", { kind: "background" }],
  ["Data", { kind: "data" }],
];

const sameState = (a: ContextPanelState | null, b: ContextPanelState) => !!a && JSON.stringify(a) === JSON.stringify(b);

function Harness() {
  const context = useEditor((s) => s.context);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const selection = useEditor((s) => s.selection);

  useEffect(() => {
    getActions().openDesign(sampleDesign());
    (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
    return installHotkeys();
  }, []);

  const actions = getActions();
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{CSS}</style>
      <div className="h-bar">
        <div className="h-group">
          <b>Select</b>
          {SELECTIONS.map(([label, pick]) => (
            <button key={label} onClick={() => selectBy(pick)}>
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              const page = getActivePage(useEditor.getState());
              if (page) actions.select(page.elements.slice(0, 3).map((e) => e.id));
            }}
          >
            First 3
          </button>
          <button onClick={() => actions.clearSelection()}>None</button>
          <button onClick={() => actions.setActivePage(useEditor.getState().design?.pages[1]?.id ?? "")}>Page 2</button>
          <button onClick={() => actions.setActivePage(useEditor.getState().design?.pages[0]?.id ?? "")}>Page 1</button>
          <span style={{ color: "var(--c-ink-3)" }}>({selection.length})</span>
        </div>
        <div className="h-group">
          <b>Panel</b>
          {PANELS.map(([label, state]) => (
            <button key={label} className={sameState(context, state) ? "on" : ""} onClick={() => actions.openContext(state)}>
              {label}
            </button>
          ))}
        </div>
        <div className="h-group">
          <button onClick={() => actions.undo()} disabled={!canUndo}>
            Undo
          </button>
          <button onClick={() => actions.redo()} disabled={!canRedo}>
            Redo
          </button>
          <button onClick={() => actions.openDesign(sampleDesign())}>Reset</button>
        </div>
      </div>
      <div className="h-main">
        <aside className="h-side" data-testid="side-panel">
          {context ? <ContextPanel state={context} /> : <div className="h-none">No context panel open. Use the buttons above.</div>}
        </aside>
        <Workspace />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
