import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { languageMenuEntry } from "@/components/languageMenu";
import { openProblemsDialog } from "@/components/problemsDialogState";
import { listFolders } from "@/core/library";
import { useEditor, type EditorState } from "@/core/store";
import type { Folder } from "@/core/types";
import { describeSize } from "@/data/designTypes";
import { m, num } from "@/i18n";
import {
  Button,
  IconFolder,
  IconCloudOff,
  IconCopy,
  IconDownload,
  IconFilePlus,
  IconHelp,
  IconHistory,
  IconBug,
  IconLaptop,
  IconMoveToFolder,
  IconPageStrip,
  IconPen,
  IconPrint,
  IconRuler,
  IconSave,
  IconSearch,
  IconSettings,
  IconStar,
  IconTrash,
  IconUpload,
  MenuList,
  Popover,
  toast,
  type MenuEntry,
} from "@/ui";
import { keepView } from "../keptView";
import { IconAccessibility } from "../toolbar/icons";
import { makeCopy, moveToTrash, printDesign, saveNow, startNewDesign } from "./designActions";
import "./fileMenu.css";

const SAVE_HINT: Record<EditorState["saveState"], string> = {
  saved: m.editorChrome.save.saved,
  saving: m.editorChrome.save.saving,
  unsaved: m.editorChrome.save.unsaved,
  error: m.editorChrome.save.errorShort,
};

/** "Parent / Child" labels so folders with the same name stay distinguishable. */
function folderLabel(folder: Folder, all: Folder[]): string {
  const parts = [folder.name];
  let parent = folder.parentId ? all.find((f) => f.id === folder.parentId) : undefined;
  let guard = 0;
  while (parent && guard++ < 8) {
    parts.unshift(parent.name);
    parent = parent.parentId ? all.find((f) => f.id === parent!.parentId) : undefined;
  }
  return parts.join(" / ");
}

export interface FileMenuProps {
  /** focuses the title field in the top bar */
  onRename: () => void;
  /** opens the file chooser (the hidden input lives in the top bar so it outlives this menu) */
  onUpload: () => void;
}

export function FileMenu({ onRename, onUpload }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const view = useEditor(
    useShallow((s) => ({
      title: s.design?.title ?? "",
      pages: s.design?.pages.length ?? 0,
      width: s.design?.width ?? 0,
      height: s.design?.height ?? 0,
      unit: s.design?.unit ?? "px",
      starred: s.design?.starred ?? false,
      folderId: s.design?.folderId ?? null,
      mode: s.mode,
      saveState: s.saveState,
      showPageStrip: s.showPageStrip,
      gridView: s.gridView,
      showRulers: s.showRulers,
      snapEnabled: s.snapEnabled,
      snapToGrid: s.snapToGrid,
      showMargins: s.showMargins,
      spellCheck: s.spellCheck,
      guides: (s.design?.guides?.vertical.length ?? 0) + (s.design?.guides?.horizontal.length ?? 0),
    })),
  );

  useEffect(() => {
    if (!open) return;
    let live = true;
    listFolders()
      .then((list) => live && setFolders(list))
      .catch(() => live && setFolders([]));
    return () => {
      live = false;
    };
  }, [open]);

  const close = () => setOpen(false);
  /**
   * After a choice the focus goes back to the File button. The Popover only restores focus when it sits inside its own
   * panel, which a submenu item (a separate portalled panel) does not, so the keyboard user would be dropped on the page.
   */
  const closeAfterChoice = () => {
    setOpen(false);
    anchor?.focus({ preventScroll: true });
  };
  const actions = useEditor.getState().actions;
  const readOnly = view.mode === "view";

  const guideCount = view.guides;

  const moveTo = (folderId: string | null, name: string) => {
    actions.updateMeta({ folderId });
    toast.success(folderId ? m.editorChrome.fileMenu.movedTo(name) : m.editorChrome.fileMenu.movedToProjects);
  };

  const currentFolder = folders.find((f) => f.id === view.folderId);

  const items: MenuEntry[] = [
    { id: "new", label: m.editorChrome.fileMenu.createNew, icon: <IconFilePlus aria-hidden="true" />, onSelect: startNewDesign },
    { id: "upload", label: m.editorChrome.fileMenu.upload, icon: <IconUpload aria-hidden="true" />, disabled: readOnly, onSelect: onUpload },
    { id: "copy", label: m.editorChrome.fileMenu.makeCopy, icon: <IconCopy aria-hidden="true" />, onSelect: () => void makeCopy() },
    { type: "divider" },
    {
      id: "pageview",
      label: m.editorChrome.fileMenu.pageView,
      icon: <IconPageStrip aria-hidden="true" />,
      hint: view.gridView ? m.editorChrome.fileMenu.gridView : view.showPageStrip ? m.editorChrome.fileMenu.thumbnails : m.editorChrome.fileMenu.hidden,
      submenu: [
        { id: "thumbs", label: m.editorChrome.fileMenu.thumbnails, checked: view.showPageStrip, onSelect: () => actions.toggle("showPageStrip") },
        { id: "grid", label: m.editorChrome.fileMenu.gridView, checked: view.gridView, onSelect: () => actions.toggle("gridView") },
      ],
    },
    {
      id: "rulers-guides",
      label: m.editorChrome.fileMenu.rulersAndGuides,
      icon: <IconRuler aria-hidden="true" />,
      submenu: [
        { id: "rulers", label: m.editorChrome.settings.showRulers, checked: view.showRulers, onSelect: () => actions.toggle("showRulers") },
        { id: "snap", label: m.editorChrome.settings.snapToGuides, checked: view.snapEnabled, onSelect: () => actions.toggle("snapEnabled") },
        { id: "snap-grid", label: m.editorChrome.settings.snapToGrid, checked: view.snapToGrid, onSelect: () => actions.toggle("snapToGrid") },
        { id: "margins", label: m.editorChrome.settings.showMargins, checked: view.showMargins, onSelect: () => actions.toggle("showMargins") },
        { type: "divider" },
        {
          id: "clear-guides",
          label: m.editorChrome.fileMenu.clearGuides,
          hint: guideCount ? num(guideCount) : undefined,
          disabled: readOnly || guideCount === 0,
          onSelect: () => {
            actions.clearGuides();
            toast.success(m.editorChrome.fileMenu.guidesCleared);
          },
        },
      ],
    },
    {
      id: "spellcheck",
      label: m.editorChrome.settings.checkSpelling,
      checked: view.spellCheck,
      onSelect: () => {
        actions.toggle("spellCheck");
        // said once, when it is switched on: who does the checking
        if (!view.spellCheck) toast.info(m.editorChrome.settings.checkSpellingOn);
      },
    },
    { type: "divider" },
    { id: "save", label: m.editorChrome.fileMenu.save, icon: <IconSave aria-hidden="true" />, hint: SAVE_HINT[view.saveState], onSelect: () => void saveNow() },
    {
      id: "offline",
      label: m.editorChrome.fileMenu.offline,
      icon: <IconCloudOff aria-hidden="true" />,
      onSelect: () => toast.info(m.editorChrome.fileMenu.offlineToast),
    },
    {
      id: "star",
      label: m.editorChrome.fileMenu.star,
      icon: <IconStar aria-hidden="true" />,
      checked: view.starred,
      disabled: readOnly,
      onSelect: () => {
        actions.updateMeta({ starred: !view.starred });
        toast.success(view.starred ? m.editorChrome.fileMenu.unstarred : m.editorChrome.fileMenu.starred);
      },
    },
    {
      id: "move",
      label: m.editorChrome.fileMenu.move,
      icon: <IconMoveToFolder aria-hidden="true" />,
      disabled: readOnly,
      hint: currentFolder ? currentFolder.name : view.folderId ? undefined : m.editorChrome.fileMenu.projects,
      submenu: [
        { id: "folder-top", label: m.editorChrome.fileMenu.projectsTop, checked: view.folderId === null, onSelect: () => moveTo(null, m.editorChrome.fileMenu.projects) },
        ...folders.map((f): MenuEntry => {
          const label = folderLabel(f, folders);
          return { id: `folder-${f.id}`, label, checked: view.folderId === f.id, onSelect: () => moveTo(f.id, label) };
        }),
      ],
    },
    { id: "download", label: m.editorChrome.fileMenu.download, icon: <IconDownload aria-hidden="true" />, onSelect: () => actions.openDialog("download") },
    { id: "print", label: m.editorChrome.fileMenu.print, icon: <IconPrint aria-hidden="true" />, shortcut: "Ctrl+P", onSelect: () => void printDesign() },
    { id: "versions", label: m.editorChrome.fileMenu.versions, icon: <IconHistory aria-hidden="true" />, onSelect: () => actions.openDialog("versions") },
    { id: "trash", label: m.editorChrome.fileMenu.trash, icon: <IconTrash aria-hidden="true" />, disabled: readOnly, onSelect: () => void moveToTrash() },
    { type: "divider" },
    // the Settings dialog (rulers, snapping and page thumbnails in one place), not a second copy of the Rulers and guides toggles
    { id: "settings", label: m.editorChrome.settings.title, icon: <IconSettings aria-hidden="true" />, onSelect: () => actions.openDialog("settings") },
    { id: "find", label: m.editorChrome.fileMenu.find, icon: <IconSearch aria-hidden="true" />, shortcut: "Ctrl+F", onSelect: () => actions.openDialog("findReplace") },
    { id: "accessibility", label: m.editorChrome.access.title, icon: <IconAccessibility aria-hidden="true" />, onSelect: () => actions.openDialog("accessibility") },
    { id: "models", label: m.editorChrome.fileMenu.models, icon: <IconLaptop aria-hidden="true" />, onSelect: () => actions.openDialog("models") },
    // the page, the selection and the zoom come back after the reload into the other language (B12)
    languageMenuEntry({ beforeSwitch: keepView }),
    {
      id: "help",
      label: m.editorChrome.fileMenu.help,
      icon: <IconHelp aria-hidden="true" />,
      submenu: [
        { id: "shortcuts", label: m.editorChrome.fileMenu.shortcuts, shortcut: "?", onSelect: () => actions.openDialog("shortcuts") },
        { id: "problems", label: m.editorChrome.fileMenu.reportProblem, icon: <IconBug aria-hidden="true" />, onSelect: () => openProblemsDialog() },
      ],
    },
  ];

  return (
    <>
      <Button ref={setAnchor} variant="ghost" className="cf-topbar__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {m.editorChrome.fileMenu.file}
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-start" offset={6} role="presentation" trapFocus={false} className="cf-popover--menu cf-filemenu">
        <button
          type="button"
          className="cf-filemenu__head"
          tabIndex={-1}
          aria-label={m.editorChrome.fileMenu.renameDesign(view.title)} // the visible text is the title, and a name has to contain it
          disabled={readOnly}
          onClick={() => {
            close();
            onRename();
          }}
        >
          <span className="cf-filemenu__title">{view.title}</span>
          <IconPen className="cf-filemenu__pen" aria-hidden="true" />
        </button>
        <p className="cf-filemenu__meta">
          <IconFolder className="cf-filemenu__meta-icon" aria-hidden="true" />
          {m.editorChrome.fileMenu.meta(view.pages, describeSize(view.width, view.height, view.unit))}
        </p>
        <MenuList items={items} onClose={closeAfterChoice} aria-label={m.editorChrome.fileMenu.file} />
      </Popover>
    </>
  );
}
