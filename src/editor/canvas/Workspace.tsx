import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { attachController } from "./controller";
import { CropOverlay } from "./CropOverlay";
import { PathEditOverlay } from "./PathEditOverlay";
import { GestureHud, GesturePreview, SelectionOverlay, SnapGuides } from "./SelectionOverlay";
import { PageView } from "./PageView";
import { stopPreview, usePreview } from "./preview";
import { Grid, Guides, Margins, Rulers } from "./Rulers";
import { TextEditorOverlay } from "./TextEditorOverlay";
import { TableCellEditor } from "./TableCellEditor";
import { PresenceOverlay } from "../live/PresenceOverlay";
import { CommentsOverlay } from "../comments/CommentsOverlay";
import { layoutFor, screenToDesign, takeZoomAnchor, useView } from "./viewStore";
import "./canvas.css";

/**
 * The scrollable editing surface: sticky page canvas, selection / text / crop
 * overlays in page coordinates, and the pointer controller. `children` render
 * above everything (floating toolbars) in workspace coordinates.
 */
export function Workspace({ children }: { children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const design = useEditor((s) => s.design);
  const zoom = useEditor((s) => s.zoom);
  const viewport = useEditor((s) => s.viewport);
  const tool = useEditor((s) => s.tool);
  const previewing = usePreview((s) => s.preview !== null);
  const pageLeft = useView((s) => s.pageLeft);
  const pageTop = useView((s) => s.pageTop);
  const pageW = useView((s) => s.pageW);
  const pageH = useView((s) => s.pageH);

  /* measure the workspace */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      useEditor.getState().actions.setViewport(Math.round(r.width), Math.round(r.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* layout whenever the zoom, design size or viewport changes */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || !design) return;
    const prev = useView.getState();
    const centre = screenToDesign({ ...prev, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop }, viewport.w / 2, viewport.h / 2);
    const lay = layoutFor(design.width, design.height, zoom, viewport.w, viewport.h);
    content.style.width = `${lay.contentW}px`;
    content.style.height = `${lay.contentH}px`;
    const anchor = takeZoomAnchor();
    let left = scroller.scrollLeft;
    let top = scroller.scrollTop;
    if (anchor) {
      left = lay.pageLeft + anchor.dx * zoom - anchor.sx;
      top = lay.pageTop + anchor.dy * zoom - anchor.sy;
    } else if (prev.zoom !== zoom || prev.pageW === 0) {
      left = lay.pageLeft + centre.x * zoom - viewport.w / 2;
      top = lay.pageTop + centre.y * zoom - viewport.h / 2;
    }
    scroller.scrollLeft = left;
    scroller.scrollTop = top;
    useView.setState({ ...lay, zoom, width: viewport.w, height: viewport.h, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop });
  }, [design?.width, design?.height, zoom, viewport.w, viewport.h, design === null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* keep the view store in sync with native scrolling */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => useView.setState({ scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  /* pointer controller */
  useEffect(() => {
    const host = hostRef.current;
    const scroller = scrollRef.current;
    if (!host || !scroller) return;
    const api = attachController(host, scroller);
    return () => api.destroy();
  }, []);

  return (
    // one stop in the tab order: Tab then walks through the elements of the page (see hotkeys.ts) and moves on after the last
    <div
      ref={hostRef}
      className={`cf-workspace${tool !== "select" ? ` cf-workspace--tool-${tool}` : ""}${previewing ? " is-previewing" : ""}`}
      tabIndex={0}
      role="group"
      aria-label={m.editor.canvas.label}
      aria-describedby="cf-workspace-hint"
      data-cf-workspace
      // the page held at the timeline's playhead gives way to editing at the first press on it
      onPointerDownCapture={() => {
        if (usePreview.getState().preview?.paused) stopPreview();
      }}
    >
      <span id="cf-workspace-hint" className="cf-sr-only">
        {m.editor.canvas.hint}
      </span>
      <div ref={scrollRef} className="cf-workspace__scroll">
        <div ref={contentRef} className="cf-workspace__content">
          <div className="cf-paper" style={{ left: pageLeft, top: pageTop, width: pageW, height: pageH }} />
          <div className="cf-sticky">
            <PageView />
          </div>
          <div className="cf-pageframe" style={{ left: pageLeft, top: pageTop, width: pageW, height: pageH }}>
            <Margins />
            <Grid />
            <Guides />
            <SnapGuides />
            <SelectionOverlay />
            <GesturePreview />
            <CropOverlay />
            <PathEditOverlay />
            <TextEditorOverlay />
            <TableCellEditor />
            <PresenceOverlay />
            <CommentsOverlay />
          </div>
        </div>
      </div>
      <Rulers />
      <GestureHud />
      {children}
    </div>
  );
}
