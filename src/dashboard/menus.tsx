/** Menu contents shared by the "..." buttons and the right-click menus of the dashboard cards. */
import {
  IconDuplicate,
  IconEye,
  IconFolder,
  IconFolderPlus,
  IconHome,
  IconImagePlus,
  IconMoveToFolder,
  IconPen,
  IconExternalLink,
  IconStar,
  IconTrash,
  IconUndo,
  type MenuEntry,
} from "@/ui";
import type { Asset, DesignSummary, Folder, Template } from "@/core/types";
import { m } from "@/i18n";
import { navigate } from "@/router";
import {
  createFromAsset,
  createFromTemplate,
  deleteAssetAction,
  deleteFolderAction,
  deleteForeverAction,
  duplicateDesignAction,
  moveDesignAction,
  moveToNewFolderAction,
  openDesign,
  renameAssetAction,
  renameDesignAction,
  renameFolderAction,
  restoreDesignAction,
  toggleStarAction,
  trashDesignAction,
} from "./actions";
import { toggleFavouriteTemplate } from "./data";
import { openTemplatePreview } from "./templatePreview";

/** Move to folder > Projects, each folder, New folder... The current location is checked and disabled. */
function moveEntries(design: DesignSummary, folders: Folder[]): MenuEntry[] {
  const current = design.folderId ?? null;
  const entries: MenuEntry[] = [
    {
      id: "move-root",
      label: m.dashboard.shell.nav.projects,
      icon: <IconHome aria-hidden="true" />,
      checked: current === null,
      disabled: current === null,
      onSelect: () => void moveDesignAction(design, null),
    },
  ];
  if (folders.length > 0) {
    entries.push({ type: "divider" });
    for (const folder of folders) {
      entries.push({
        id: `move-${folder.id}`,
        label: folder.name,
        icon: <IconFolder aria-hidden="true" />,
        checked: current === folder.id,
        disabled: current === folder.id,
        onSelect: () => void moveDesignAction(design, folder),
      });
    }
  }
  entries.push(
    { type: "divider" },
    { id: "move-new", label: m.dashboard.menus.newFolder, icon: <IconFolderPlus aria-hidden="true" />, onSelect: () => void moveToNewFolderAction(design) },
  );
  return entries;
}

/** Open, Rename, Make a copy, Star, Move to folder, Move to trash. */
export function designMenuItems(design: DesignSummary, folders: Folder[]): MenuEntry[] {
  return [
    { id: "open", label: m.dashboard.shared.open, icon: <IconExternalLink aria-hidden="true" />, onSelect: () => openDesign(design) },
    { id: "rename", label: m.dashboard.shared.rename, icon: <IconPen aria-hidden="true" />, onSelect: () => void renameDesignAction(design) },
    { id: "copy", label: m.dashboard.menus.makeCopy, icon: <IconDuplicate aria-hidden="true" />, onSelect: () => void duplicateDesignAction(design) },
    { id: "star", label: design.starred ? m.dashboard.menus.unstar : m.dashboard.menus.star, icon: <IconStar aria-hidden="true" />, onSelect: () => void toggleStarAction(design) },
    { id: "move", label: m.dashboard.menus.moveToFolder, icon: <IconMoveToFolder aria-hidden="true" />, submenu: moveEntries(design, folders) },
    { type: "divider" },
    { id: "trash", label: m.dashboard.menus.moveToTrash, icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void trashDesignAction(design) },
  ];
}

/** Restore and Delete forever, for the Trash page. */
export function trashMenuItems(design: DesignSummary): MenuEntry[] {
  return [
    { id: "restore", label: m.dashboard.shared.restore, icon: <IconUndo aria-hidden="true" />, onSelect: () => void restoreDesignAction(design) },
    { type: "divider" },
    { id: "delete", label: m.dashboard.shared.deleteForever, icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteForeverAction(design) },
  ];
}

export function folderMenuItems(folder: Folder, designCount: number): MenuEntry[] {
  return [
    { id: "open", label: m.dashboard.shared.open, icon: <IconFolder aria-hidden="true" />, onSelect: () => navigate(`/projects/${encodeURIComponent(folder.id)}`) },
    { id: "rename", label: m.dashboard.shared.rename, icon: <IconPen aria-hidden="true" />, onSelect: () => void renameFolderAction(folder) },
    { type: "divider" },
    { id: "delete", label: m.dashboard.shared.deleteFolder, icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteFolderAction(folder, designCount) },
  ];
}

export function assetMenuItems(asset: Asset): MenuEntry[] {
  return [
    // a sound is no picture to start a design from: it is added to a design's timeline in the editor
    ...(asset.kind === "audio"
      ? []
      : [{ id: "use", label: m.dashboard.shared.useInNewDesign, icon: <IconImagePlus aria-hidden="true" />, onSelect: () => void createFromAsset(asset) }]),
    { id: "rename", label: m.dashboard.shared.rename, icon: <IconPen aria-hidden="true" />, onSelect: () => void renameAssetAction(asset) },
    { type: "divider" },
    { id: "delete", label: m.common.delete, icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteAssetAction(asset) },
  ];
}

export function templateMenuItems(template: Template, isFavourite: boolean): MenuEntry[] {
  return [
    { id: "preview", label: m.dashboard.shared.preview, icon: <IconEye aria-hidden="true" />, onSelect: () => openTemplatePreview(template) },
    { id: "customize", label: m.dashboard.shared.customize, icon: <IconPen aria-hidden="true" />, onSelect: () => void createFromTemplate(template) },
    {
      id: "favourite",
      label: isFavourite ? m.dashboard.shared.removeFavourite : m.dashboard.shared.addFavourite,
      icon: <IconStar aria-hidden="true" />,
      onSelect: () => void toggleFavouriteTemplate(template.id, template.name),
    },
  ];
}
