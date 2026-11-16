/**
 * Everything the dashboard *does*: creating designs (blank, custom size, from a photo, from a template) and the
 * per-item actions (rename, copy, star, move, trash, delete). UI code only calls these; they own the toasts,
 * the error handling and the "go to the editor" navigation.
 */
import { ACCEPTED_IMAGE_TYPES, addAssetFromFile, assetSrc, deleteAsset, isAcceptedImage, renameAsset } from "@/core/assets";
import { createImage, createPage } from "@/core/factory";
import {
  createBlankDesign,
  createDesignFromPages,
  createFolder,
  deleteFolder,
  deleteForever,
  duplicateDesign,
  emptyTrash,
  moveToFolder,
  moveToTrash,
  renameDesign,
  renameFolder,
  restoreFromTrash,
  saveDesign,
  setStarred,
} from "@/core/library";
import type { Asset, Design, DesignSummary, Folder, SizeUnit, Template } from "@/core/types";
import { getDesignType, type DesignType } from "@/data/designTypes";
import { renderPageToCanvas } from "@/render/renderPage";
import { designPath, navigate } from "@/router";
import { confirm, toast } from "@/ui";
import { closeCreateDialog } from "./createDialogState";
import { pickFiles } from "./files";
import { m } from "@/i18n";
import { promptText } from "./prompt";
import { closeTemplatePreview } from "./templatePreview";

/** Custom sizes are limited to 40-8000 px per side (the same limits the editor's Resize uses). */
export const MIN_SIZE_PX = 40;
export const MAX_SIZE_PX = 8000;

export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

const reason = (error: unknown): string => (error instanceof Error && error.message ? error.message : m.dashboard.actions.tryAgain);

/** Runs a task; shows an error toast and returns false when it throws. */
async function guard(task: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error) {
    console.error(error);
    toast.error(`${failure} ${reason(error)}`);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Creating designs                                                   */
/* ------------------------------------------------------------------ */

let creating = false;

/** Only one "create and open" runs at a time, so a double click can not make two designs. */
async function exclusive(task: () => Promise<void>, failure: string): Promise<void> {
  if (creating) return;
  creating = true;
  try {
    await task();
  } catch (error) {
    console.error(error);
    toast.error(`${failure} ${reason(error)}`);
  } finally {
    creating = false;
  }
}

function openInEditor(design: Design): void {
  closeCreateDialog();
  closeTemplatePreview();
  navigate(designPath(design.id));
}

const THUMBNAIL_WIDTH = 420;

/** A JPEG thumbnail of page 1 like the editor's autosave makes; gives up after two seconds. */
async function thumbnailOf(design: Design): Promise<string | undefined> {
  try {
    const render = renderPageToCanvas(design, design.pages[0], { width: THUMBNAIL_WIDTH }).then((canvas) => canvas.toDataURL("image/jpeg", 0.82));
    const timeout = new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 2000));
    return await Promise.race([render, timeout]);
  } catch {
    return undefined;
  }
}

/**
 * Stores the display unit and a thumbnail on a design that was just created. This happens before the editor opens,
 * so there is no autosave to race with (`createDesignFromPages` has no unit option).
 */
async function finishNewDesign(design: Design, unit: SizeUnit): Promise<void> {
  const thumbnail = await thumbnailOf(design);
  if (thumbnail || unit !== design.unit) await saveDesign({ ...design, unit }, thumbnail);
}

export interface CreateOptions {
  /** file the design in this folder (default: Projects) */
  folderId?: string | null;
}

/** A blank design of a catalogue type, opened in the editor. */
export function createBlankAndOpen(type: DesignType, options: CreateOptions = {}): Promise<void> {
  return exclusive(async () => {
    const design = await createBlankDesign({ typeId: type.id, width: type.width, height: type.height, unit: type.unit, folderId: options.folderId ?? null });
    openInEditor(design);
  }, m.dashboard.actions.couldNotCreate);
}

/** A blank design of any size (already validated: whole pixels inside the limits). */
export function createCustomAndOpen(width: number, height: number, unit: SizeUnit, options: CreateOptions = {}): Promise<void> {
  return exclusive(async () => {
    const design = await createBlankDesign({ typeId: "custom", width: Math.round(width), height: Math.round(height), unit, folderId: options.folderId ?? null });
    openInEditor(design);
  }, m.dashboard.actions.couldNotCreate);
}

/** Scales a size down / up so both sides stay inside the 40-8000 px limits, keeping the aspect ratio. */
export function fitToLimits(width: number, height: number): { width: number; height: number } {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  const longest = Math.max(w, h);
  if (longest > MAX_SIZE_PX) {
    const scale = MAX_SIZE_PX / longest;
    w *= scale;
    h *= scale;
  }
  const shortest = Math.min(w, h);
  if (shortest < MIN_SIZE_PX) {
    const scale = MIN_SIZE_PX / shortest;
    w *= scale;
    h *= scale;
  }
  const clamp = (n: number) => Math.round(Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, n)));
  return { width: clamp(w), height: clamp(h) };
}

/** A design sized to the picture with the picture placed full-bleed, opened in the editor. */
async function createDesignWithAsset(asset: Asset, options: CreateOptions): Promise<void> {
  const { width, height } = fitToLimits(asset.width, asset.height);
  const picture = createImage({
    src: assetSrc(asset.id),
    naturalWidth: asset.width,
    naturalHeight: asset.height,
    x: 0,
    y: 0,
    width,
    height,
    name: asset.name,
  });
  const design = await createDesignFromPages({
    typeId: "custom",
    width,
    height,
    title: asset.name || m.dashboard.actions.untitledDesign,
    pages: [createPage({ elements: [picture] })],
    folderId: options.folderId ?? null,
  });
  await finishNewDesign(design, "px");
  openInEditor(design);
}

/** Stores an image file in the uploads library and starts a design from it. Resolves with an error message or null. */
export async function createFromImageFile(file: File, options: CreateOptions = {}): Promise<string | null> {
  if (!isAcceptedImage(file)) return m.dashboard.actions.notAnImage;
  if (creating) return null;
  creating = true;
  try {
    let asset: Asset;
    try {
      asset = await addAssetFromFile(file);
    } catch {
      return m.dashboard.actions.unreadableImage;
    }
    await createDesignWithAsset(asset, options);
    return null;
  } catch (error) {
    console.error(error);
    return m.dashboard.actions.couldNotCreateWithReason(reason(error));
  } finally {
    creating = false;
  }
}

/** The Upload shortcut: choose a photo, then start a design from it. Call straight from a click handler. */
export async function pickImageAndCreate(options: CreateOptions = {}): Promise<void> {
  const [file] = await pickFiles({ accept: IMAGE_ACCEPT });
  if (!file) return;
  const problem = await createFromImageFile(file, options);
  if (problem) toast.error(problem);
}

/** "Use in new design" for something already in the uploads library. */
export function createFromAsset(asset: Asset, options: CreateOptions = {}): Promise<void> {
  return exclusive(() => createDesignWithAsset(asset, options), m.dashboard.actions.couldNotCreate);
}

/** "Customize this template": a new design with the template's pages, opened in the editor. */
export function createFromTemplate(template: Template, options: CreateOptions = {}): Promise<void> {
  return exclusive(async () => {
    const design = await createDesignFromPages({
      typeId: template.typeId,
      width: template.width,
      height: template.height,
      title: template.name,
      pages: template.pages,
      folderId: options.folderId ?? null,
    });
    await finishNewDesign(design, getDesignType(template.typeId)?.unit ?? "px");
    openInEditor(design);
  }, m.dashboard.actions.couldNotStartFromTemplate);
}

/* ------------------------------------------------------------------ */
/* Uploads                                                            */
/* ------------------------------------------------------------------ */

/**
 * Adds image files to the uploads library. Reports the outcome with a toast (`quiet` skips the success toast, for
 * callers that say something more specific); resolves with the stored assets.
 */
export async function uploadImageFiles(files: File[], options: { quiet?: boolean } = {}): Promise<Asset[]> {
  const stored: Asset[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (!isAcceptedImage(file)) {
      skipped.push(file.name);
      continue;
    }
    try {
      stored.push(await addAssetFromFile(file));
    } catch (error) {
      console.error(error);
      skipped.push(file.name);
    }
  }
  if (stored.length > 0 && !options.quiet) toast.success(m.dashboard.actions.uploaded(stored.length), { duration: 2800 });
  if (skipped.length > 0) {
    const names = skipped.length > 2 ? m.dashboard.actions.namesAndMore(skipped.slice(0, 2).join(", "), skipped.length - 2) : skipped.join(", ");
    toast.error(m.dashboard.actions.uploadFailed(names));
  }
  return stored;
}

export async function renameAssetAction(asset: Asset): Promise<void> {
  const name = await promptText({
    title: m.dashboard.actions.renameImage,
    label: m.dashboard.actions.imageName,
    initialValue: asset.name,
    confirmLabel: m.dashboard.shared.rename,
  });
  if (name === null || name === asset.name) return;
  await guard(() => renameAsset(asset.id, name), m.dashboard.actions.renameImageFailed);
}

export async function deleteAssetAction(asset: Asset): Promise<void> {
  const ok = await confirm({
    title: m.dashboard.actions.deleteImageTitle(asset.name),
    message: m.dashboard.actions.deleteImageMessage,
    confirmLabel: m.dashboard.actions.deleteImage,
    danger: true,
  });
  if (!ok) return;
  if (await guard(() => deleteAsset(asset.id), m.dashboard.actions.deleteImageFailed)) toast.success(m.dashboard.actions.imageDeleted, { duration: 2600 });
}

/* ------------------------------------------------------------------ */
/* Design actions                                                     */
/* ------------------------------------------------------------------ */

export const openDesign = (design: Pick<DesignSummary, "id">): void => navigate(designPath(design.id));

export async function renameDesignAction(design: DesignSummary): Promise<void> {
  const name = await promptText({
    title: m.dashboard.actions.renameDesign,
    label: m.dashboard.actions.designName,
    initialValue: design.title,
    confirmLabel: m.dashboard.shared.rename,
    placeholder: m.dashboard.actions.untitledDesign,
  });
  if (name === null || name === design.title) return;
  await guard(() => renameDesign(design.id, name), m.dashboard.actions.renameDesignFailed);
}

export async function duplicateDesignAction(design: DesignSummary): Promise<void> {
  const made: { id?: string } = {};
  const ok = await guard(async () => {
    const copy = await duplicateDesign(design.id);
    if (!copy) throw new Error(m.dashboard.actions.originalMissing);
    made.id = copy.id;
  }, m.dashboard.actions.copyFailed);
  const id = made.id;
  if (ok && id) toast.success(m.dashboard.actions.copied, { actionLabel: m.dashboard.shared.open, onAction: () => navigate(designPath(id)) });
}

export async function toggleStarAction(design: DesignSummary): Promise<void> {
  await guard(() => setStarred(design.id, !design.starred), m.dashboard.actions.starFailed);
}

/** Moves a design into a folder (or back to Projects when `folder` is null). */
export async function moveDesignAction(design: DesignSummary, folder: Folder | null): Promise<void> {
  if ((design.folderId ?? null) === (folder?.id ?? null)) return;
  const ok = await guard(() => moveToFolder(design.id, folder ? folder.id : null), m.dashboard.actions.moveFailed);
  if (ok) toast.success(folder ? m.dashboard.actions.movedTo(folder.name) : m.dashboard.actions.movedToProjects, { duration: 2800 });
}

/** "New folder..." inside a Move to folder menu: asks for a name, creates the folder and moves the design in. */
export async function moveToNewFolderAction(design: DesignSummary): Promise<void> {
  const name = await promptText({
    title: m.dashboard.actions.newFolder,
    label: m.dashboard.actions.folderName,
    confirmLabel: m.dashboard.actions.createAndMove,
    placeholder: m.dashboard.actions.untitledFolder,
  });
  if (name === null) return;
  const made: { folder?: Folder } = {};
  const ok = await guard(async () => {
    made.folder = await createFolder(name);
    await moveToFolder(design.id, made.folder.id);
  }, m.dashboard.actions.createFolderFailed);
  if (ok && made.folder) toast.success(m.dashboard.actions.movedTo(made.folder.name), { duration: 2800 });
}

/** Moves a design to the trash and offers to undo it. */
export async function trashDesignAction(design: DesignSummary): Promise<void> {
  const ok = await guard(() => moveToTrash(design.id), m.dashboard.actions.trashFailed);
  if (!ok) return;
  toast.info(m.dashboard.actions.movedToTrash, {
    actionLabel: m.common.undo,
    duration: 6000,
    onAction: () => void guard(() => restoreFromTrash(design.id), m.dashboard.actions.restoreFailed),
  });
}

export async function restoreDesignAction(design: DesignSummary): Promise<void> {
  if (await guard(() => restoreFromTrash(design.id), m.dashboard.actions.restoreFailed)) {
    toast.success(m.dashboard.actions.restored(design.title), { actionLabel: m.dashboard.shared.open, onAction: () => openDesign(design) });
  }
}

export async function deleteForeverAction(design: DesignSummary): Promise<void> {
  const ok = await confirm({
    title: m.dashboard.actions.deleteForeverTitle(design.title),
    message: m.dashboard.actions.deleteForeverMessage,
    confirmLabel: m.dashboard.shared.deleteForever,
    danger: true,
  });
  if (!ok) return;
  if (await guard(() => deleteForever(design.id), m.dashboard.actions.deleteDesignFailed)) toast.success(m.dashboard.actions.designDeleted, { duration: 2600 });
}

export async function emptyTrashAction(count: number): Promise<void> {
  const ok = await confirm({
    title: m.dashboard.actions.emptyTrashTitle,
    message: m.dashboard.actions.emptyTrashMessage(count),
    confirmLabel: m.dashboard.actions.emptyTrash,
    danger: true,
  });
  if (!ok) return;
  if (await guard(() => emptyTrash(), m.dashboard.actions.emptyTrashFailed)) toast.success(m.dashboard.actions.trashEmptied, { duration: 2600 });
}

/* ------------------------------------------------------------------ */
/* Folder actions                                                     */
/* ------------------------------------------------------------------ */

/** Asks for a name and creates a folder. Resolves with the new folder, or null when cancelled / failed. */
export async function createFolderAction(): Promise<Folder | null> {
  const name = await promptText({
    title: m.dashboard.shared.createFolder,
    label: m.dashboard.actions.folderName,
    confirmLabel: m.dashboard.shared.createFolder,
    placeholder: m.dashboard.actions.untitledFolder,
  });
  if (name === null) return null;
  const made: { folder?: Folder } = {};
  const ok = await guard(async () => {
    made.folder = await createFolder(name);
  }, m.dashboard.actions.createFolderFailed);
  if (ok && made.folder) {
    toast.success(m.dashboard.actions.folderCreated(made.folder.name), { duration: 2600 });
    return made.folder;
  }
  return null;
}

export async function renameFolderAction(folder: Folder): Promise<void> {
  const name = await promptText({
    title: m.dashboard.actions.renameFolder,
    label: m.dashboard.actions.folderName,
    initialValue: folder.name,
    confirmLabel: m.dashboard.shared.rename,
  });
  if (name === null || name === folder.name) return;
  await guard(() => renameFolder(folder.id, name), m.dashboard.actions.renameFolderFailed);
}

/** Deletes a folder after confirming; the designs inside return to Projects. Resolves true when it was deleted. */
export async function deleteFolderAction(folder: Folder, designCount: number): Promise<boolean> {
  const ok = await confirm({
    title: m.dashboard.actions.deleteFolderTitle(folder.name),
    message: designCount > 0 ? m.dashboard.actions.deleteFolderMessage(designCount) : m.dashboard.actions.deleteEmptyFolderMessage,
    confirmLabel: m.dashboard.shared.deleteFolder,
    danger: true,
  });
  if (!ok) return false;
  const deleted = await guard(() => deleteFolder(folder.id), m.dashboard.actions.deleteFolderFailed);
  if (deleted) toast.success(m.dashboard.actions.folderDeleted, { duration: 2600 });
  return deleted;
}
