/**
 * The copies, on this device, of designs that are shared. A design that somebody shares is kept in this person's own library as an
 * ordinary design that carries the link (`design.live`): it is there offline, autosave keeps it, and opening it connects again. This
 * remembers which design of the library belongs to which room, so that opening the same link twice opens the same design.
 */
import { uid } from "@/core/ids";
import { getDesign, saveDesign } from "@/core/library";
import type { Design, LiveLink } from "@/core/types";

const STORAGE_KEY = "craftly.live.joined";

const read = (): Record<string, string> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
};
const keyOf = (link: Pick<LiveLink, "server" | "room">) => `${link.server}|${link.room}`;

/** Remembers that the design `designId` of this library is the copy of the room of `link`. */
export function rememberShared(link: Pick<LiveLink, "server" | "room">, designId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), [keyOf(link)]: designId }));
  } catch {
    /* the copy is found again by opening it from the library */
  }
}

/** The id of the design of this library that is the copy of the room of `link`, if there still is one that is not in the trash. */
export async function findShared(link: Pick<LiveLink, "server" | "room">): Promise<string | null> {
  const id = read()[keyOf(link)];
  if (!id) return null;
  try {
    const design = await getDesign(id);
    return design && design.trashedAt === null ? id : null;
  } catch {
    return null;
  }
}

/** Makes a design of this library from the shared design that a link led to: it keeps the link, and is saved. Gives its id. */
export async function saveJoined(shared: Design, link: LiveLink): Promise<string> {
  const now = Date.now();
  const copy: Design = { ...shared, id: uid("d"), createdAt: now, updatedAt: now, folderId: null, starred: false, trashedAt: null, live: link };
  await saveDesign(copy);
  rememberShared(link, copy.id);
  return copy.id;
}
