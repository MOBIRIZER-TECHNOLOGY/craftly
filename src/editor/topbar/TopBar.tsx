import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useEditor, type EditorState } from "@/core/store";
import { useGesture } from "@/editor/canvas/gestureStore";
import { penHistory } from "@/editor/canvas/penTool";
import { insertImageFiles } from "@/editor/insert";
import { m } from "@/i18n";
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
import { SyncStatus } from "@/dashboard/account/SyncStatus";
import { FileMenu } from "./FileMenu";
import { LivePeople } from "../live/LivePeople";
import { CommentsButton } from "../comments/CommentsButton";
import { LiveBadge } from "../live/LiveSection";
import { SharePopover } from "./SharePopover";
import { requestSave } from "./designActions";
import "./topbar.css";

const SAVE_LABEL: Record<EditorState["saveState"], string> = {
  saved: m.editorChrome.save.saved,
  saving: m.editorChrome.save.saving,
  unsaved: m.editorChrome.save.unsaved,
  error: m.editorChrome.save.error,
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
    const next = draft.trim() || m.core.untitledDesign;
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
        aria-label={m.editorChrome.topBar.titleLabel}
        placeholder={m.editorChrome.topBar.untitled}
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
    {
      id: "edit",
      label: m.editorChrome.topBar.editing,
      icon: <IconPen aria-hidden="true" />,
      hint: m.editorChrome.topBar.makeChanges,
      checked: mode === "edit",
      onSelect: () => setMode("edit"),
    },
    {
      id: "view",
      label: m.editorChrome.topBar.viewing,
      icon: <IconEye aria-hidden="true" />,
      hint: m.editorChrome.topBar.readOnly,
      checked: mode === "view",
      onSelect: () => setMode("view"),
    },
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
        aria-label={mode === "edit" ? m.editorChrome.topBar.editingMode : m.editorChrome.topBar.viewingMode}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl">{mode === "edit" ? m.editorChrome.topBar.editing : m.editorChrome.topBar.viewing}</span>
      </Button>
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} aria-label={m.editorChrome.topBar.mode} />
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
        aria-label={m.editorChrome.topBar.resize}
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cf-topbar__lbl cf-topbar__lbl--keep">{m.editorChrome.topBar.resize}</span>
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-start" offset={6} className="cf-resizepop" aria-label={m.editorChrome.topBar.resizeOptions}>
        <button
          type="button"
          className="cf-resizepop__item"
          // the popover has just been opened: its first (only) item takes the focus, so that Enter opens the dialog
          data-autofocus=""
          onClick={() => {
            close();
            useEditor.getState().actions.openDialog("resize");
          }}
        >
          <span className="cf-resizepop__icon">
            <IconCustomSize aria-hidden="true" />
          </span>
          <span className="cf-resizepop__text">
            <span className="cf-resizepop__title">{m.editorChrome.topBar.resize}</span>
            <span className="cf-resizepop__desc">{m.editorChrome.topBar.resizeDesc}</span>
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
    {
      id: "present",
      label: m.editorChrome.topBar.present,
      icon: <IconPlay aria-hidden="true" />,
      hint: pageCount > 1 ? m.editorChrome.pages.page(activeIndex + 1) : undefined,
      onSelect: () => present(),
    },
  ];
  if (pageCount > 1 && activeIndex > 0)
    items.push({ id: "present-first", label: m.editorChrome.topBar.presentFromFirst, icon: <IconPlay aria-hidden="true" />, onSelect: () => present(true) });

  return (
    <div ref={setAnchor} className="cf-topbar__split">
      <Button variant="ghost" className="cf-topbar__split-main" icon={<IconPlay aria-hidden="true" />} aria-label={m.editorChrome.topBar.present} onClick={() => present()}>
        <span className="cf-topbar__lbl cf-topbar__lbl--share">{m.editorChrome.topBar.present}</span>
      </Button>
      <Button
        variant="ghost"
        className="cf-topbar__split-caret"
        icon={<IconChevronDown aria-hidden="true" />}
        aria-label={m.editorChrome.topBar.presentOptions}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      <MenuPopover open={open} anchor={anchor} onClose={() => setOpen(false)} items={items} placement="bottom-end" aria-label={m.editorChrome.topBar.present} />
    </div>
  );
}

export function TopBar() {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  // while a path is being placed with the Pen, undo takes its last point back and redo has nothing to bring back
  const placing = useGesture((s) => s.pen !== null);
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
        if (!ids.length) toast.error(m.editorChrome.topBar.cantAdd);
      })
      .catch(() => toast.error(m.editorChrome.topBar.addFailed));
  };

  const actions = useEditor.getState().actions;

  return (
    <header className="cf-topbar" aria-label={m.editorChrome.topBar.toolbar}>
      {/* the page's one top-level heading, for people who move by headings: it names the design. First in the page, and inside a landmark */}
      <h1 className="cf-sr-only">{designTitle || m.editorChrome.topBar.untitled}</h1>
      <div className="cf-topbar__group">
        <IconButton label={m.editorChrome.topBar.home} className="cf-topbar__home" icon={<IconHome aria-hidden="true" />} onClick={() => navigate("/")} />
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
        <IconButton
          label={m.common.undo}
          shortcut="Ctrl+Z"
          icon={<IconUndo aria-hidden="true" />}
          disabled={(!canUndo && !placing) || readOnly}
          onClick={() => {
            if (!penHistory(false)) actions.undo();
          }}
        />
        <IconButton
          label={m.common.redo}
          shortcut="Ctrl+Shift+Z"
          className="cf-topbar__redo"
          icon={<IconRedo aria-hidden="true" />}
          disabled={!canRedo || placing || readOnly}
          onClick={() => actions.redo()}
        />
        <span className="cf-topbar__sep cf-topbar__sep--hide-sm" aria-hidden="true" />
        <SaveIndicator />
        {/* the sync status of the account, while somebody is signed in (docs/ACCOUNTS.md); nothing otherwise */}
        <SyncStatus compact className="cf-topbar__sync" />
      </div>
      <div className="cf-topbar__title-wrap">
        <TitleField ref={titleRef} />
      </div>
      <div className="cf-topbar__group cf-topbar__group--end">
        <LiveBadge />
        <LivePeople />
        <CommentsButton />
        <PresentButton />
        <SharePopover />
      </div>
      <input ref={fileInput} type="file" accept="image/*,.svg" multiple hidden onChange={onFiles} />
    </header>
  );
}
