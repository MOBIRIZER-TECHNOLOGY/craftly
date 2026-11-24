/**
 * Shared "put something on the page" helpers used by panels, drag and drop,
 * paste and the controller. Panels should call these instead of building
 * elements by hand.
 */
import { addAssetFromFile, assetSrc, isAcceptedImage, isAcceptedVideo, videoInfo } from "@/core/assets";
import { createImage, createVideo } from "@/core/factory";
import { isRemoteImage } from "@/core/imageSources";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { Design, DesignElement, Fill, ID, ImageElement, Page, Point, VideoElement } from "@/core/types";
import { isVideoSource } from "@/render/videos";
import { usableElements, usableFill } from "@/export/projectFormat";

export const DRAG_MIME = "application/x-craftly";

/** What panels put in `dataTransfer` when an item is dragged onto the canvas. */
export type DragPayload =
  | { type: "elements"; elements: DesignElement[] }
  | { type: "image"; src: string; naturalWidth: number; naturalHeight: number; name?: string }
  | { type: "video"; src: string; naturalWidth: number; naturalHeight: number; duration: number; name?: string }
  | { type: "background"; fill: Fill };

export function setDragPayload(e: { dataTransfer: DataTransfer | null }, payload: DragPayload, dragImage?: HTMLElement | null): void {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.setData(DRAG_MIME, JSON.stringify(payload));
  dt.setData("text/plain", payload.type);
  dt.effectAllowed = "copy";
  if (dragImage) dt.setDragImage(dragImage, dragImage.clientWidth / 2, dragImage.clientHeight / 2);
}

const isSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * What a drop may put on the page. The panels of the editor write the payload, but any page can put data of the same type on a
 * drag, so it is checked like a file or the clipboard: elements that the renderer can draw, without pictures from the web; a
 * picture that is one of the editor's own, with a size; a background that is a fill. Anything else is no payload.
 */
function usablePayload(value: unknown): DragPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (p.type === "elements") {
    const elements = usableElements(p.elements);
    return elements.length ? { type: "elements", elements } : null;
  }
  if (p.type === "image") {
    if (typeof p.src !== "string" || !p.src || isRemoteImage(p.src) || !isSize(p.naturalWidth) || !isSize(p.naturalHeight)) return null;
    return { type: "image", src: p.src, naturalWidth: p.naturalWidth, naturalHeight: p.naturalHeight, ...(typeof p.name === "string" ? { name: p.name } : {}) };
  }
  if (p.type === "video") {
    if (!isVideoSource(p.src) || !isSize(p.naturalWidth) || !isSize(p.naturalHeight) || !isSize(p.duration)) return null;
    return {
      type: "video",
      src: p.src,
      naturalWidth: p.naturalWidth,
      naturalHeight: p.naturalHeight,
      duration: p.duration,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
    };
  }
  if (p.type === "background") {
    const fill = usableFill(p.fill);
    return fill ? { type: "background", fill } : null;
  }
  return null;
}

export function readDragPayload(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return usablePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** An image element sized to sit comfortably on the page (about half its width). */
export function imageElementFor(design: Pick<Design, "width" | "height">, src: string, naturalWidth: number, naturalHeight: number): ImageElement {
  const maxW = design.width * 0.5;
  const maxH = design.height * 0.7;
  const s = Math.min(maxW / naturalWidth, maxH / naturalHeight, design.width / naturalWidth);
  return createImage({ src, naturalWidth, naturalHeight, width: Math.round(naturalWidth * s), height: Math.round(naturalHeight * s) });
}

/** A video element sized as a picture is (`imageElementFor`), playing the whole clip. */
export function videoElementFor(design: Pick<Design, "width" | "height">, src: string, naturalWidth: number, naturalHeight: number, duration: number, name?: string): VideoElement {
  const maxW = design.width * 0.5;
  const maxH = design.height * 0.7;
  const s = Math.min(maxW / naturalWidth, maxH / naturalHeight, design.width / naturalWidth);
  return createVideo({ src, naturalWidth, naturalHeight, duration, width: Math.round(naturalWidth * s), height: Math.round(naturalHeight * s), ...(name ? { name } : {}) });
}

/** Adds a clip to the active page, centred or at the drop point `at` (design px). */
export function insertVideo(src: string, naturalWidth: number, naturalHeight: number, duration: number, at?: Point, name?: string): ID {
  const s = useEditor.getState();
  if (!s.design || !getActivePage(s)) return "";
  return getActions().addElement(videoElementFor(s.design, src, naturalWidth, naturalHeight, duration, name), at ? { at } : undefined);
}

/** The image / frame element under `pt` that should receive a dropped photo, if any (never one of `skip`). */
export function findDropTarget(page: Page, pt: Point, skip?: ReadonlySet<ID>): ImageElement | null {
  for (let i = page.elements.length - 1; i >= 0; i--) {
    const el = page.elements[i];
    if (el.hidden || el.locked || el.type !== "image" || skip?.has(el.id)) continue;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const a = (-el.rotation * Math.PI) / 180;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a) + el.width / 2;
    const ly = dx * Math.sin(a) + dy * Math.cos(a) + el.height / 2;
    if (lx >= 0 && ly >= 0 && lx <= el.width && ly <= el.height) return el;
  }
  return null;
}

/**
 * Adds an image to the active page, or fills the selected / targeted frame.
 * `at` is a drop point in design px; without it the image is centred.
 */
export function insertImage(src: string, naturalWidth: number, naturalHeight: number, at?: Point, skip?: ReadonlySet<ID>): ID {
  const s = useEditor.getState();
  const page = getActivePage(s);
  const actions = getActions();
  if (!s.design || !page) return "";
  const target = at
    ? findDropTarget(page, at, skip)
    : s.selection.length === 1
      ? ((page.elements.find((e) => e.id === s.selection[0] && e.type === "image" && e.isFrame && !e.src) as ImageElement | undefined) ?? null)
      : null;
  if (target) {
    actions.replaceImage(target.id, src, naturalWidth, naturalHeight);
    actions.select([target.id]);
    return target.id;
  }
  return actions.addElement(imageElementFor(s.design, src, naturalWidth, naturalHeight), at ? { at } : undefined);
}

/** Stores dropped / chosen files as assets and places them on the page. Returns the new element ids. */
export async function insertImageFiles(files: File[], at?: Point): Promise<ID[]> {
  const ids: ID[] = [];
  let offset = 0;
  for (const file of files.filter((f) => isAcceptedImage(f) || isAcceptedVideo(f))) {
    const asset = await addAssetFromFile(file);
    const p = at ? { x: at.x + offset, y: at.y + offset } : undefined;
    if (asset.kind === "video") {
      const info = await videoInfo(asset.blob);
      const id = insertVideo(assetSrc(asset.id), asset.width, asset.height, info?.duration || 1, p);
      if (id) ids.push(id);
      offset += 32;
      continue;
    }
    // a picture added by this very drop is never the target of the next one (it would be replaced instead of joined)
    const id = insertImage(assetSrc(asset.id), asset.width, asset.height, p, new Set(ids));
    if (id) ids.push(id);
    offset += 32;
  }
  return ids;
}

export function insertPayload(payload: DragPayload, at?: Point): void {
  const actions = getActions();
  if (payload.type === "elements") actions.addElements(payload.elements, at ? { at } : undefined);
  else if (payload.type === "image") insertImage(payload.src, payload.naturalWidth, payload.naturalHeight, at);
  else if (payload.type === "video") insertVideo(payload.src, payload.naturalWidth, payload.naturalHeight, payload.duration, at, payload.name);
  else if (payload.type === "background") actions.setPageBackground(payload.fill);
}
