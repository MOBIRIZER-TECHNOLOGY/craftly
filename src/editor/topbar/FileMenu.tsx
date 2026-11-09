import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { openProblemsDialog } from "@/components/problemsDialogState";
import { listFolders } from "@/core/library";
import { useEditor, type EditorState } from "@/core/store";
import type { Folder } from "@/core/types";
import { describeSize } from "@/data/designTypes";
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
import { makeCopy, moveToTrash, printDesign, saveNow, startNewDesign } from "./designActions";
import "./fileMenu.css";

const SAVE_HINT: Record<EditorState["saveState"], string> = {
  saved: "All changes saved",
  saving: "Saving...",
  unsaved: "Unsaved changes",
  error: "Couldn't save",
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

  const rulerToggles = (): MenuEntry[] => [
    { id: "rulers", label: "Show rulers", checked: view.showRulers, onSelect: () => actions.toggle("showRulers") },
    { id: "snap", label: "Snap to guides", checked: view.snapEnabled, onSelect: () => actions.toggle("snapEnabled") },
  ];
  const guideCount = view.guides;

  const moveTo = (folderId: string | null, name: string) => {
    actions.updateMeta({ folderId });
    toast.success(folderId ? `Moved to ${name}` : "Moved to Projects");
  };

  const currentFolder = folders.find((f) => f.id === view.folderId);

  const items: MenuEntry[] = [
    { id: "new", label: "Create new design", icon: <IconFilePlus aria-hidden="true" />, onSelect: startNewDesign },
    { id: "upload", label: "Upload files", icon: <IconUpload aria-hidden="true" />, disabled: readOnly, onSelect: onUpload },
    { id: "copy", label: "Make a copy", icon: <IconCopy aria-hidden="true" />, onSelect: () => void makeCopy() },
    { type: "divider" },
    {
      id: "pageview",
      label: "Page view",
      icon: <IconPageStrip aria-hidden="true" />,
      hint: view.gridView ? "Grid view" : view.showPageStrip ? "Thumbnails" : "Hidden",
      submenu: [
        { id: "thumbs", label: "Thumbnails", checked: view.showPageStrip, onSelect: () => actions.toggle("showPageStrip") },
        { id: "grid", label: "Grid view", checked: view.gridView, onSelect: () => actions.toggle("gridView") },
      ],
    },
    {
      id: "rulers-guides",
      label: "Rulers and guides",
      icon: <IconRuler aria-hidden="true" />,
      submenu: [
        ...rulerToggles(),
        { type: "divider" },
        {
          id: "clear-guides",
          label: "Clear guides",
          hint: guideCount ? String(guideCount) : undefined,
          disabled: readOnly || guideCount === 0,
          onSelect: () => {
            actions.clearGuides();
            toast.success("Guides cleared");
          },
        },
      ],
    },
    { type: "divider" },
    { id: "save", label: "Save", icon: <IconSave aria-hidden="true" />, hint: SAVE_HINT[view.saveState], onSelect: () => void saveNow() },
    {
      id: "offline",
      label: "Make available offline",
      icon: <IconCloudOff aria-hidden="true" />,
      onSelect: () => toast.info("Craftly already works offline - your designs are stored on this device."),
    },
    {
      id: "star",
      label: "Star",
      icon: <IconStar aria-hidden="true" />,
      checked: view.starred,
      disabled: readOnly,
      onSelect: () => {
        actions.updateMeta({ starred: !view.starred });
        toast.success(view.starred ? "Removed from starred" : "Added to starred");
      },
    },
    {
      id: "move",
      label: "Move",
      icon: <IconMoveToFolder aria-hidden="true" />,
      disabled: readOnly,
      hint: currentFolder ? currentFolder.name : view.folderId ? undefined : "Projects",
      submenu: [
        { id: "folder-top", label: "Projects (top level)", checked: view.folderId === null, onSelect: () => moveTo(null, "Projects") },
        ...folders.map((f): MenuEntry => {
          const label = folderLabel(f, folders);
          return { id: `folder-${f.id}`, label, checked: view.folderId === f.id, onSelect: () => moveTo(f.id, label) };
        }),
      ],
    },
    { id: "download", label: "Download", icon: <IconDownload aria-hidden="true" />, onSelect: () => actions.openDialog("download") },
    { id: "print", label: "Print", icon: <IconPrint aria-hidden="true" />, shortcut: "Ctrl+P", onSelect: () => void printDesign() },
    { id: "versions", label: "Version history", icon: <IconHistory aria-hidden="true" />, onSelect: () => actions.openDialog("versions") },
    { id: "trash", label: "Move to trash", icon: <IconTrash aria-hidden="true" />, disabled: readOnly, onSelect: () => void moveToTrash() },
    { type: "divider" },
    { id: "settings", label: "Settings", icon: <IconSettings aria-hidden="true" />, submenu: rulerToggles() },
    { id: "find", label: "Find and replace text", icon: <IconSearch aria-hidden="true" />, shortcut: "Ctrl+F", onSelect: () => actions.openDialog("findReplace") },
    { id: "models", label: "On-device models", icon: <IconLaptop aria-hidden="true" />, onSelect: () => actions.openDialog("models") },
    {
      id: "help",
      label: "Help",
      icon: <IconHelp aria-hidden="true" />,
      submenu: [
        { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", onSelect: () => actions.openDialog("shortcuts") },
        { id: "problems", label: "Report a problem", icon: <IconBug aria-hidden="true" />, onSelect: () => openProblemsDialog() },
      ],
    },
  ];

  return (
    <>
      <Button ref={setAnchor} variant="ghost" className="cf-topbar__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        File
      </Button>
      <Popover open={open} anchor={anchor} onClose={close} placement="bottom-start" offset={6} role="presentation" trapFocus={false} className="cf-popover--menu cf-filemenu">
        <button
          type="button"
          className="cf-filemenu__head"
          tabIndex={-1}
          aria-label={`Rename design: ${view.title}`} // the visible text is the title, and a name has to contain it
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
          {view.pages} {view.pages === 1 ? "page" : "pages"} &bull; {describeSize(view.width, view.height, view.unit)}
        </p>
        <MenuList items={items} onClose={closeAfterChoice} aria-label="File" />
      </Popover>
    </>
  );
}
