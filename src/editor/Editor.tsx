import { useEffect, useState, type ReactNode } from "react";
import { RecoveryPanel } from "@/components/RecoveryPanel";
import { getDesign, saveDesign } from "@/core/library";
import { isCrashing, keepBeforeProblem } from "@/core/recovery";
import { MigrationError } from "@/core/schema/migrator";
import { useEditor } from "@/core/store";
import { renderPageToCanvas } from "@/render/renderPage";
import { navigate } from "@/router";
import { Button, EmptyState, IconHome, IconSearch, IconWarning, Spinner, cx } from "@/ui";
import { installAutosave } from "./autosave";
import { BottomBar } from "./bottombar/BottomBar";
import { NotesPanel } from "./bottombar/NotesPanel";
import { Workspace } from "./canvas/Workspace";
import { DialogHost } from "./dialogs/DialogHost";
import { installHotkeys } from "./hotkeys";
import { connectLive } from "./live/connection";
import { GridView } from "./pages/GridView";
import { PageStrip } from "./pages/PageStrip";
import { LeftRail } from "./panels/LeftRail";
import { SidePanel } from "./panels/SidePanel";
import { PresentMode } from "./present/PresentMode";
import { FloatingToolbar } from "./toolbar/FloatingToolbar";
import { MiniToolbar } from "./toolbar/MiniToolbar";
import { installContextMenu } from "./toolbar/contextMenu";
import { TopBar } from "./topbar/TopBar";
import { printDesign } from "./topbar/designActions";
import "./editor.css";

/** `newer`: saved by a newer Craftly than this tab runs. `failed`: it could not be brought up to the format this one uses. Neither touches what is stored. */
type Status = "loading" | "ready" | "missing" | "broken" | "newer" | "failed";

/**
 * The autosave service only reacts to changes and timers; when the editor is left (Home, another design, closing
 * the route) with edits that were not written yet, store them here so nothing typed in the last second is lost.
 * When the editor goes away because its screen stopped, the state on the screen may be what stopped it: the stored one
 * (the last autosave) is kept as a version first, so that a design that stops Craftly again can be taken back to it
 * (src/core/recovery.ts, docs/CRASH-RECOVERY.md).
 */
function persistOnLeave(): void {
  const s = useEditor.getState();
  const design = s.design;
  if (!design || s.saveState === "saved" || s.saveState === "saving") return;
  const stopped = isCrashing();
  void (async () => {
    if (stopped) await keepBeforeProblem(design.id).catch(() => undefined);
    let thumb: string | undefined;
    try {
      thumb = (await renderPageToCanvas(design, design.pages[0], { width: 420 })).toDataURL("image/jpeg", 0.82);
    } catch {
      /* thumbnails are optional */
    }
    try {
      await saveDesign(design, thumb);
    } catch {
      /* nothing more can be done once the editor is gone */
    }
  })();
}

function EditorState({ children }: { children: ReactNode }) {
  return <div className="cf-editor-state">{children}</div>;
}

/** The whole editor for one design: loads it from the library, installs the global services and lays out the chrome. */
export function Editor({ designId }: { designId: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState("");

  /* the keyboard and the right-click menu of the whole editor */
  useEffect(() => {
    const uninstallHotkeys = installHotkeys();
    const uninstallMenu = installContextMenu();
    return () => {
      uninstallHotkeys();
      uninstallMenu();
    };
  }, []);

  /*
   * The canvas hotkeys listen on window and only skip text fields, so Tab / Enter / Space / arrows / letters pressed on a
   * button, tab or list of the editor chrome would select, nudge or add elements instead of acting on that control
   * (and Enter / Space would never press it). Plain keys pressed outside the canvas stop at the document.
   * Escape, "?" and anything with Ctrl / Cmd / Alt (undo, find, save ...) still pass.
   */
  useEffect(() => {
    const isolate = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Ctrl+F in the title, notes or replace field would open the browser's own find box: open ours instead
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "f" &&
        target.closest(".cf-editor") &&
        !target.closest("[data-cf-text-editor]") &&
        /^(INPUT|TEXTAREA)$/.test(target.tagName)
      ) {
        e.preventDefault();
        useEditor.getState().actions.openDialog("findReplace");
        return;
      }
      // Ctrl+P prints the pages of the design, not the editor around them
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void printDesign();
        return;
      }
      if (e.key === "Escape" || e.key === "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (target.closest("[data-cf-workspace]") && !target.closest("[data-cf-ui]")) return;
      if (target.closest(".cf-editor, [data-cf-layer]")) e.stopPropagation();
    };
    document.addEventListener("keydown", isolate);
    return () => document.removeEventListener("keydown", isolate);
  }, []);

  /* load, open, autosave; flush and close on the way out */
  useEffect(() => {
    let cancelled = false;
    let uninstallAutosave: (() => void) | null = null;
    setStatus("loading");
    getDesign(designId)
      .then((design) => {
        if (cancelled) return;
        if (!design) {
          setStatus("missing");
          return;
        }
        try {
          const actions = useEditor.getState().actions;
          actions.openDesign(design);
          // on a phone the side panel is a sheet over the page: start with it folded away
          if (window.matchMedia("(max-width: 899px)").matches && useEditor.getState().panelOpen) actions.toggle("panelOpen");
          uninstallAutosave = installAutosave();
          setStatus("ready");
        } catch {
          setStatus("broken");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof MigrationError) {
          setDetail(error.message);
          setStatus(error.code === "newer" ? "newer" : "failed");
        } else setStatus("missing");
      });
    return () => {
      cancelled = true;
      uninstallAutosave?.();
      persistOnLeave();
      useEditor.getState().actions.closeDesign();
    };
  }, [designId]);

  /* a design that is shared stays in step with the server for as long as it is open */
  const link = useEditor((s) => s.design?.live ?? null);
  useEffect(() => {
    if (status !== "ready" || !link) return;
    return connectLive(link);
  }, [status, link]);

  /* the browser tab shows the design's name */
  const title = useEditor((s) => s.design?.title);
  useEffect(() => {
    if (status !== "ready" || !title) return;
    const previous = document.title;
    document.title = `${title} - Craftly`;
    return () => {
      document.title = previous;
    };
  }, [status, title]);

  const gridView = useEditor((s) => s.gridView);
  const notesOpen = useEditor((s) => s.notesOpen);
  const showPageStrip = useEditor((s) => s.showPageStrip);
  const presenting = useEditor((s) => s.presenting);
  const viewing = useEditor((s) => s.mode === "view");

  if (status === "loading") {
    return (
      <EditorState>
        <Spinner size={32} label="Opening your design" />
      </EditorState>
    );
  }

  if (status === "newer" || status === "failed") {
    const newer = status === "newer";
    return (
      <EditorState>
        <EmptyState
          icon={<IconWarning />}
          title={newer ? "Update Craftly to open this design" : "We couldn't bring this design up to date"}
          text={
            newer
              ? "It was saved by a newer version of Craftly than the one running in this tab. Reload to get the newest version, then open it again. The design has not been changed."
              : `${detail} Nothing has been changed, and your other designs are not affected.`
          }
          action={
            <div className="cf-editor-state__actions">
              {newer ? (
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              ) : null}
              <Button variant={newer ? "secondary" : "primary"} icon={<IconHome aria-hidden="true" />} onClick={() => navigate("/")}>
                Back to home
              </Button>
            </div>
          }
        />
      </EditorState>
    );
  }

  if (status === "missing" || status === "broken") {
    return (
      <EditorState>
        <EmptyState
          icon={<IconSearch />}
          title={status === "missing" ? "We couldn't find this design" : "We couldn't open this design"}
          text={
            status === "missing"
              ? "It may have been deleted, or it was saved in another browser. Head home to open one of your designs or start a new one."
              : "Its file looks damaged. Go back to an earlier version below, or head home to open another design - your other designs are not affected."
          }
          action={
            <>
              <Button variant="primary" icon={<IconHome aria-hidden="true" />} onClick={() => navigate("/")}>
                Back to home
              </Button>
              {status === "broken" ? (
                <div className="cf-editor-state__recovery">
                  <RecoveryPanel designId={designId} open />
                </div>
              ) : null}
            </>
          }
        />
      </EditorState>
    );
  }

  return (
    <div className={cx("cf-editor", gridView && "is-grid", viewing && "is-view", presenting && "is-presenting")}>
      {/* everything behind the presenter is inert: no focus, no typing into the page underneath */}
      <div className="cf-editor__chrome" inert={presenting}>
        <TopBar />
        <div className="cf-editor__body">
          <LeftRail />
          <SidePanel />
          <main className="cf-editor__center" aria-label="Design">
            {gridView ? (
              <GridView />
            ) : (
              <Workspace>
                <FloatingToolbar />
                <MiniToolbar />
              </Workspace>
            )}
            {notesOpen && !gridView ? <NotesPanel /> : null}
            {showPageStrip && !gridView ? <PageStrip /> : null}
            <BottomBar />
          </main>
        </div>
      </div>
      {presenting ? <PresentMode /> : null}
      <DialogHost />
    </div>
  );
}
