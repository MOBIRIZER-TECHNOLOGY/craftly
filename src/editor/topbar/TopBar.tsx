import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useEditor, type EditorState } from "@/core/store";
import { insertImageFiles } from "@/editor/insert";
import { navigate } from "@/router";
import {
  Button,
  IconButton,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconCloudOff,
  IconCloudSaved,
  IconCustomSize,
  IconEye,
  IconHome,
  IconPen,
  IconPlay,
  IconRedo,
  IconUndo,
  MenuPopover,
  Popover,
  Spinner,
  cx,
  toast,
  type MenuEntry,
} from "@/ui";
import { FileMenu } from "./FileMenu";
import { SharePopover } from "./SharePopover";
import { requestSave } from "./designActions";
import "./topbar.css";

const SAVE_LABEL: Record<EditorState["saveState"], string> = {
  saved: "All changes saved",
  saving: "Saving...",
  unsaved: "Unsaved changes",
  error: "Couldn't save - storage is full or blocked",
};

/** Cloud icon with the autosave state. Clicking it saves right away. */
function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  const label = SAVE_LABEL[state];
  const icon =
    state === "saving" ? (
      <Spinner size={18} />
    ) : state === "saved" ? (
      <IconCloudSaved aria-hidden="true" />
    ) : state === "error" ? (
      <IconCloudOff aria-hidden="true" />
    ) : (
      <IconCloud aria-hidden="true" />
    );
  return (
    <>
      <IconButton className={cx("cf-topbar__save", `is-${state}`)} label={label} icon={icon} onClick={requestSave} />
      <span className="cf-sr-only" role="status" aria-live="polite">
        {state === "error" ? label : ""}
      </span>
    </>
  );
}

/** The design title: an input that reads like text until it is hovered or focused. */
const TitleField = forwardRef<HTMLInputElement>(function TitleField(_props, ref) {
  const title = useEditor((s) => s.design?.title ?? "");
  const readOnly = useEditor((s) => s.mode === "view");
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  // undo, restoring a version or another tab renaming the design all arrive through the store
  useEffect(() => setDraft(title), [title]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(title);
      return;
    }
    const next = draft.trim() || "Untitled design";
    setDraft(next);
    if (next !== title) useEditor.getState().actions.setTitle(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <label className="cf-topbar__title">
      <span className="cf-topbar__title-sizer" aria-hidden="true">
        {draft || " "}
      </span>
      <input
        ref={inputRef}
        className="cf-topbar__title-input"
        value={draft}
        readOnly={readOnly}
        maxLength={120}
        spellCheck={false}
        autoComplete="off"
        aria-label="Design title"
        placeholder="Untitled design"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    </label>
  );
});

/** Editing | Viewing */
function ModeMenu() {
  const mode = useEditor((s) => s.mode);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const setMode = useEditor.getState().actions.setMode;
  const items: MenuEntry[] = [
    { id: "edit", label: "Editing", icon: <IconPen aria-hidden="true" />, hint: "Make changes", checked: mode === "edit", onSelect: () => setMode("edit") },
    { id: "view", label: "Viewing", icon: <IconEye aria-hidden="true" />, hint: "Read only", checked: mode === "view", onSelect: () => setMode("view") },
  ];
  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        className="cf-topbar__btn cf-topbar__mode"
        icon={mode === "edit" ? <IconPen aria-hidden="true" /> : <IconEye aria-hidden="true" />}
        iconRight={<IconChevronDown aria-hidden="true" />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={mode === "edit" ? "Editing mode" : "Viewing mode"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl">{mode === "edit" ? "Editing" : "Viewing"}</span>
      </Button>
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} aria-label="Mode" />
    </>
  );
}

/** Resize button with its small popover. */
function ResizeMenu() {
  const readOnly = useEditor((s) => s.mode === "view");
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setOpen(false);
  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        className="cf-topbar__btn cf-topbar__resize"
        icon={<IconCustomSize aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Resize"
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl cf-topbar__lbl--keep">Resize</span>
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-start" offset={6} className="cf-resizepop" aria-label="Resize options">
        <button
          type="button"
          className="cf-resizepop__item"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just been opened: its first item takes the focus
          autoFocus
          onClick={() => {
            close();
            useEditor.getState().actions.openDialog("resize");
          }}
        >
          <span className="cf-resizepop__icon">
            <IconCustomSize aria-hidden="true" />
          </span>
          <span className="cf-resizepop__text">
            <span className="cf-resizepop__title">Resize</span>
            <span className="cf-resizepop__desc">Change the size of your design or pick a preset format</span>
          </span>
          <IconChevronRight className="cf-resizepop__chev" aria-hidden="true" />
        </button>
      </Popover>
    </>
  );
}

/** Present split button: the main part starts the show, the caret offers where to start. */
function PresentButton() {
  const pageCount = useEditor((s) => s.design?.pages.length ?? 0);
  const activeIndex = useEditor((s) => s.design?.pages.findIndex((p) => p.id === s.activePageId) ?? 0);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const present = (fromFirst = false) => {
    const s = useEditor.getState();
    if (!s.design) return;
    if (fromFirst) s.actions.setActivePage(s.design.pages[0].id);
    s.actions.setPresenting(true);
  };

  const items: MenuEntry[] = [
    { id: "present", label: "Present", icon: <IconPlay aria-hidden="true" />, hint: pageCount > 1 ? `Page ${activeIndex + 1}` : undefined, onSelect: () => present() },
  ];
  if (pageCount > 1 && activeIndex > 0) items.push({ id: "present-first", label: "Present from first page", icon: <IconPlay aria-hidden="true" />, onSelect: () => present(true) });

  return (
    <div ref={setAnchor} className="cf-topbar__split">
      <Button variant="ghost" className="cf-topbar__split-main" icon={<IconPlay aria-hidden="true" />} aria-label="Present" onClick={() => present()}>
        <span className="cf-topbar__lbl cf-topbar__lbl--share">Present</span>
      </Button>
      <Button
        variant="ghost"
        className="cf-topbar__split-caret"
        icon={<IconChevronDown aria-hidden="true" />}
        aria-label="Present options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} placement="bottom-end" aria-label="Present" />
    </div>
  );
}

export function TopBar() {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const readOnly = useEditor((s) => s.mode === "view");
  const designTitle = useEditor((s) => s.design?.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    insertImageFiles(files)
      .then((ids) => {
        if (!ids.length) toast.error("Craftly can't add those files. Try a PNG, JPG, GIF, WebP or SVG image.");
      })
      .catch(() => toast.error("Couldn't add the files. Check that your browser has free storage and try again."));
  };

  const actions = useEditor.getState().actions;

  return (
    <header className="cf-topbar" aria-label="Design toolbar">
      {/* the page's one top-level heading, for people who move by headings: it names the design. First in the page, and inside a landmark */}
      <h1 className="cf-sr-only">{designTitle || "Untitled design"}</h1>
      <div className="cf-topbar__group">
        <IconButton label="Home" className="cf-topbar__home" icon={<IconHome aria-hidden="true" />} onClick={() => navigate("/")} />
        <FileMenu
          onRename={() => {
            const input = titleRef.current;
            // on a phone the title field is folded away: rename in a dialog instead
            if (input && input.offsetWidth > 24) {
              input.focus();
              input.select();
            } else actions.openDialog("rename");
          }}
          onUpload={() => fileInput.current?.click()}
        />
        <ResizeMenu />
        <ModeMenu />
        <span className="cf-topbar__sep cf-topbar__sep--hide-sm" aria-hidden="true" />
        <IconButton label="Undo" shortcut="Ctrl+Z" icon={<IconUndo aria-hidden="true" />} disabled={!canUndo || readOnly} onClick={() => actions.undo()} />
        <IconButton
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          className="cf-topbar__redo"
          icon={<IconRedo aria-hidden="true" />}
          disabled={!canRedo || readOnly}
          onClick={() => actions.redo()}
        />
        <span className="cf-topbar__sep cf-topbar__sep--hide-sm" aria-hidden="true" />
        <SaveIndicator />
      </div>
      <div className="cf-topbar__title-wrap">
        <TitleField ref={titleRef} />
      </div>
      <div className="cf-topbar__group cf-topbar__group--end">
        <PresentButton />
        <SharePopover />
      </div>
      <input ref={fileInput} type="file" accept="image/*,.svg" multiple hidden onChange={onFiles} />
    </header>
  );
}
