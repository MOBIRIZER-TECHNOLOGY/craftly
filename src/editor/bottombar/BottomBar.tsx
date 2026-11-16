import { useState } from "react";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { Button, IconButton, IconFullscreen, IconGridView, IconHelp, IconKeyboard, IconNotes, IconPageStrip, MenuPopover, Slider, cx, type MenuEntry } from "@/ui";
import { TimerButton } from "./TimerButton";
import "./bottombar.css";

const ZOOM_PRESETS = [300, 200, 125, 100, 75, 50, 25, 10];

/** The "49%" button: preset percentages plus Fit and Fill. */
function ZoomMenu() {
  const zoom = useEditor((s) => s.zoom);
  const zoomMode = useEditor((s) => s.zoomMode);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const actions = useEditor.getState().actions;
  const percent = Math.round(zoom * 100);

  const items: MenuEntry[] = [
    ...ZOOM_PRESETS.map((p): MenuEntry => ({ id: `zoom-${p}`, label: `${p}%`, checked: zoomMode === "custom" && percent === p, onSelect: () => actions.setZoom(p / 100) })),
    { type: "divider" },
    { id: "zoom-fit", label: m.editorChrome.bottomBar.fit, checked: zoomMode === "fit", onSelect: () => actions.setZoomMode("fit") },
    { id: "zoom-fill", label: m.editorChrome.bottomBar.fill, checked: zoomMode === "fill", onSelect: () => actions.setZoomMode("fill") },
  ];

  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        size="md"
        className="cf-bottombar__btn cf-bottombar__zoombtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={m.editorChrome.bottomBar.zoomButton(percent)}
        onClick={() => setOpen((v) => !v)}
      >
        {percent}%
      </Button>
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} placement="top-end" aria-label={m.editorChrome.bottomBar.zoom} />
    </>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: MenuEntry[] = [
    {
      id: "shortcuts",
      label: m.editorChrome.bottomBar.shortcuts,
      icon: <IconKeyboard aria-hidden="true" />,
      shortcut: "?",
      onSelect: () => useEditor.getState().actions.openDialog("shortcuts"),
    },
  ];
  return (
    <>
      <IconButton
        ref={setAnchor}
        label={m.editorChrome.bottomBar.help}
        icon={<IconHelp aria-hidden="true" />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} placement="top-end" aria-label={m.editorChrome.bottomBar.help} />
    </>
  );
}

export function BottomBar() {
  const zoom = useEditor((s) => s.zoom);
  const gridView = useEditor((s) => s.gridView);
  const notesOpen = useEditor((s) => s.notesOpen);
  const showPageStrip = useEditor((s) => s.showPageStrip);
  const pageCount = useEditor((s) => s.design?.pages.length ?? 0);
  const pageIndex = useEditor((s) => s.design?.pages.findIndex((p) => p.id === s.activePageId) ?? 0);
  const actions = useEditor.getState().actions;

  return (
    <footer className={cx("cf-bottombar", gridView && "is-grid")} aria-label={m.editorChrome.bottomBar.label}>
      <div className="cf-bottombar__group">
        {!gridView ? (
          <>
            <Button
              variant="ghost"
              className={cx("cf-bottombar__btn", notesOpen && "is-active")}
              icon={<IconNotes aria-hidden="true" />}
              aria-label={m.editorChrome.bottomBar.notes}
              aria-pressed={notesOpen}
              onClick={() => actions.toggle("notesOpen")}
            >
              <span className="cf-bottombar__lbl">{m.editorChrome.bottomBar.notes}</span>
            </Button>
            <TimerButton />
          </>
        ) : null}
      </div>
      <div className="cf-bottombar__group cf-bottombar__group--end">
        {!gridView ? (
          <>
            <div className="cf-bottombar__zoom">
              <Slider
                value={zoom}
                min={0.1}
                max={3}
                scale="log"
                aria-label={m.editorChrome.bottomBar.zoom}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => actions.setZoom(v)}
              />
            </div>
            <ZoomMenu />
            <Button
              variant="ghost"
              className={cx("cf-bottombar__btn", showPageStrip && "is-active")}
              icon={<IconPageStrip aria-hidden="true" />}
              aria-label={m.editorChrome.bottomBar.pages}
              aria-pressed={showPageStrip}
              onClick={() => actions.toggle("showPageStrip")}
            >
              <span className="cf-bottombar__lbl">{m.editorChrome.bottomBar.pages}</span>
            </Button>
            {/* a plain span cannot carry a label: the short "1 / 3" is for the eyes, the words for a screen reader (which hears a page change too) */}
            <span className="cf-bottombar__pageof" role="status">
              <span aria-hidden="true">
                {pageIndex + 1} / {pageCount}
              </span>
              <span className="cf-sr-only">{m.editorChrome.pages.pageOf(pageIndex + 1, pageCount)}</span>
            </span>
          </>
        ) : null}
        <IconButton
          label={gridView ? m.editorChrome.bottomBar.exitGridView : m.editorChrome.bottomBar.gridView}
          icon={<IconGridView aria-hidden="true" />}
          active={gridView}
          onClick={() => actions.toggle("gridView")}
        />
        <IconButton label={m.editorChrome.bottomBar.presentFullScreen} icon={<IconFullscreen aria-hidden="true" />} onClick={() => actions.setPresenting(true)} />
        <HelpMenu />
      </div>
    </footer>
  );
}
