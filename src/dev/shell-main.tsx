/**
 * Entry of the dev-only editor shell harness (dev-shell.html, `npx vite --config vite.dev-shell.config.ts`, port 5181).
 * It stores a five-page sample design in IndexedDB, mounts the real <Editor> for it and offers a stub "home"
 * so File > Create new design, Make a copy, Move to trash and the missing-design state can be tried.
 * `window.__editor` exposes the store for scripted checks.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPage, createShape, createText, solid } from "@/core/factory";
import { getDesign, listDesigns, saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import { sampleDesign } from "@/dev/sampleDesign";
import { Editor } from "@/editor/Editor";
import { designPath, navigate, useRoute } from "@/router";
import { Button, ConfirmHost, ContextMenuHost, ToastHost } from "@/ui";

export const SHELL_DESIGN_ID = "shell-sample";

/** The sample design plus three more pages (one with a name and notes) so the strip, grid and presenter have something to show. */
async function seed(): Promise<void> {
  const design = sampleDesign();
  design.id = SHELL_DESIGN_ID;
  design.title = "Summer launch";
  design.pages[0].notes = "Welcome everyone.\nPause here and ask the room what they are designing this week.";
  design.pages[1].name = "Agenda";
  const colours: Array<[string, string, string]> = [
    ["#e0f2fe", "#0c4a6e", "Third page"],
    ["#fef3c7", "#78350f", "Fourth page - find me"],
    ["#dcfce7", "#14532d", "Fifth page"],
  ];
  colours.forEach(([bg, fg, label], i) => {
    const page = createPage({ background: solid(bg) });
    page.elements.push(
      createShape("ellipse", { x: 1300, y: 160 + i * 40, width: 420, height: 420, fill: solid(fg), opacity: 0.12 }),
      createText({ text: label, x: 140, y: 380, fontSize: 120, fontWeight: 800, color: fg, fontFamily: "Plus Jakarta Sans" }),
      createText({ text: "Design anything, beautifully.", x: 144, y: 560, fontSize: 48, color: fg }),
    );
    if (i === 1) page.notes = "Remember to mention the early-bird offer.";
    design.pages.push(page);
  });
  await saveDesign(design);
}

function Home() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void listDesigns().then((list) => setCount(list.length));
  }, []);
  let flag = "";
  try {
    flag = sessionStorage.getItem("craftly:open-create") ?? "";
  } catch {
    /* blocked */
  }
  return (
    <div style={{ padding: 32, display: "grid", gap: 12, maxWidth: 520, fontFamily: "var(--font-ui)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Home (shell stub)</h1>
      <p data-testid="home-info">
        {count ?? "?"} designs stored. open-create flag: <b data-testid="open-create">{flag || "none"}</b>
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={async () => {
            await seed();
            navigate(designPath(SHELL_DESIGN_ID));
          }}
        >
          Open sample design
        </Button>
        <Button variant="secondary" onClick={() => navigate(designPath("does-not-exist"))}>
          Open a missing design
        </Button>
      </div>
    </div>
  );
}

function Shell() {
  const route = useRoute();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;
    // keep what a previous run stored (to test persistence); ?fresh starts over
    const fresh = new URLSearchParams(window.location.search).has("fresh");
    void (fresh ? Promise.resolve(null) : getDesign(SHELL_DESIGN_ID))
      .then((existing) => (existing ? undefined : seed()))
      .then(() => {
        if (!window.location.hash) navigate(designPath(SHELL_DESIGN_ID));
        setReady(true);
      });
  }, []);
  if (!ready) return null;
  return (
    <>
      {route.name === "design" && route.id ? <Editor key={route.id} designId={route.id} /> : <Home />}
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
