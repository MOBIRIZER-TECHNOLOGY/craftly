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
      label: "Projects",
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
  entries.push({ type: "divider" }, { id: "move-new", label: "New folder…", icon: <IconFolderPlus aria-hidden="true" />, onSelect: () => void moveToNewFolderAction(design) });
  return entries;
}

/** Open, Rename, Make a copy, Star, Move to folder, Move to trash. */
export function designMenuItems(design: DesignSummary, folders: Folder[]): MenuEntry[] {
  return [
    { id: "open", label: "Open", icon: <IconExternalLink aria-hidden="true" />, onSelect: () => openDesign(design) },
    { id: "rename", label: "Rename", icon: <IconPen aria-hidden="true" />, onSelect: () => void renameDesignAction(design) },
    { id: "copy", label: "Make a copy", icon: <IconDuplicate aria-hidden="true" />, onSelect: () => void duplicateDesignAction(design) },
    { id: "star", label: design.starred ? "Unstar" : "Star", icon: <IconStar aria-hidden="true" />, onSelect: () => void toggleStarAction(design) },
    { id: "move", label: "Move to folder", icon: <IconMoveToFolder aria-hidden="true" />, submenu: moveEntries(design, folders) },
    { type: "divider" },
    { id: "trash", label: "Move to trash", icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void trashDesignAction(design) },
  ];
}

/** Restore and Delete forever, for the Trash page. */
export function trashMenuItems(design: DesignSummary): MenuEntry[] {
  return [
    { id: "restore", label: "Restore", icon: <IconUndo aria-hidden="true" />, onSelect: () => void restoreDesignAction(design) },
    { type: "divider" },
    { id: "delete", label: "Delete forever", icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteForeverAction(design) },
  ];
}

export function folderMenuItems(folder: Folder, designCount: number): MenuEntry[] {
  return [
    { id: "open", label: "Open", icon: <IconFolder aria-hidden="true" />, onSelect: () => navigate(`/projects/${encodeURIComponent(folder.id)}`) },
    { id: "rename", label: "Rename", icon: <IconPen aria-hidden="true" />, onSelect: () => void renameFolderAction(folder) },
    { type: "divider" },
    { id: "delete", label: "Delete folder", icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteFolderAction(folder, designCount) },
  ];
}

export function assetMenuItems(asset: Asset): MenuEntry[] {
  return [
    { id: "use", label: "Use in new design", icon: <IconImagePlus aria-hidden="true" />, onSelect: () => void createFromAsset(asset) },
    { id: "rename", label: "Rename", icon: <IconPen aria-hidden="true" />, onSelect: () => void renameAssetAction(asset) },
    { type: "divider" },
    { id: "delete", label: "Delete", icon: <IconTrash aria-hidden="true" />, danger: true, onSelect: () => void deleteAssetAction(asset) },
  ];
}

export function templateMenuItems(template: Template, isFavourite: boolean): MenuEntry[] {
  return [
    { id: "preview", label: "Preview", icon: <IconEye aria-hidden="true" />, onSelect: () => openTemplatePreview(template) },
    { id: "customize", label: "Customize this template", icon: <IconPen aria-hidden="true" />, onSelect: () => void createFromTemplate(template) },
    {
      id: "favourite",
      label: isFavourite ? "Remove from favourites" : "Add to favourites",
      icon: <IconStar aria-hidden="true" />,
      onSelect: () => void toggleFavouriteTemplate(template.id, template.name),
    },
  ];
}
