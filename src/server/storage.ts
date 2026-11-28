/**
 * Where the server keeps its rooms between runs. A room is one shared design with the revision it is at, the numbers of the last
 * batches it applied from each client it still remembers, and a hash of each of its two keys (a copy of the files cannot be used to edit or to look).
 * The images that the people of a room uploaded are kept beside its record, one by one, so that saving an edit does not write
 * them again. (They were inside the record once; such a record is still read, see `RoomRecord.assets`.)
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Design } from "@/core/types";

export interface SharedAsset {
  mime: string;
  base64: string;
}

/** A clip or a sound of a room (docs/COLLABORATION.md, "Clips and sounds"): its type, its size in bytes and the SHA-256 of its bytes. */
export interface StoredMedia {
  mime: string;
  size: number;
  sha256: string;
}

/** A clip or a sound that has been received whole and waits to be put in place (`commitMedia`) or thrown away (`dropMedia`). */
export interface StagedMedia {
  /** where the storage keeps it meanwhile */
  handle: string;
  size: number;
  sha256: string;
}

export interface RoomRecord {
  /**
   * Only in a record that an older server wrote: the images of the room, inside its record. The server moves them out, each into
   * a place of its own (`saveAsset`), the first time it saves such a room, and writes no record with this field.
   */
  assets?: Record<string, SharedAsset>;
  design: Design;
  rev: number;
  seqs: Record<string, number>;
  /**
   * When each client of `seqs` was last seen, and the highest last number of any client that was forgotten: what lets a room
   * forget clients that stayed away without ever applying a batch twice (src/collab/room.ts). A record that an older server
   * wrote has neither; its clients then count as seen when the room is opened.
   */
  seqSeen?: Record<string, number>;
  seqFloor?: number;
  /** hex SHA-256 of the key that lets a person edit */
  editHash: string;
  /** hex SHA-256 of the key that lets a person look */
  viewHash: string;
  /** Older rooms have no owner credential. A bound room has none either: nobody stops it, it is written back when it leaves memory. */
  ownerHash?: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Only in a room bound to a design of a space (a team's design opened live by its members, docs/ACCOUNTS.md): which design,
   * the revision of the space the room's design was taken from or last written back as (`rev`), the revision of the room at that
   * moment (`roomRev`: the room has something to write back when its revision is past it), and the title it had then. Such a room
   * is joined with a session and never with a key: its key hashes are of random keys that were never handed out.
   */
  bound?: BoundTo;
}

export interface BoundTo {
  space: string;
  designId: string;
  rev: number;
  roomRev: number;
  title?: string;
}

/** A room that is kept, and when it was last used: saved, or noted as used with `touch`. */
export interface StoredRoom {
  id: string;
  usedAt: number;
}

export interface LiveStorage {
  /** The room, or null when there is none. A room that is there and cannot be read is an error, not a room that is gone. */
  load(id: string): Promise<RoomRecord | null>;
  /**
   * Saves the record. `designJson` is `JSON.stringify(record.design)` when the caller has it already (it measured the design):
   * the design is then not turned into text a second time.
   */
  save(id: string, record: RoomRecord, designJson?: string): Promise<void>;
  /** Removes the room, its images, and its clips and sounds. */
  remove(id: string): Promise<void>;
  /** An image of a room, or null when the room has no such image. One that is there and cannot be read is an error. */
  loadAsset(id: string, assetId: string): Promise<SharedAsset | null>;
  saveAsset(id: string, assetId: string, asset: SharedAsset): Promise<void>;
  /** How much the images of a room take where they are kept, in bytes (the image as text, and a few bytes around it). */
  assetBytes(id: string): Promise<number>;
  /**
   * Receives the bytes of a clip or a sound of a room as they come, counting and hashing them: null when there are more than
   * `limit` (what had come is thrown away). Nothing is a clip of the room until `commitMedia`.
   */
  stageMedia(id: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number): Promise<StagedMedia | null>;
  /** Puts a received clip or sound in place under its id, with its type. */
  commitMedia(id: string, assetId: string, staged: StagedMedia, mime: string): Promise<void>;
  /** Throws away a received clip or sound that was not put in place. */
  dropMedia(id: string, staged: StagedMedia): Promise<void>;
  /** What is known of a clip or a sound of a room, or null when it has none by that id. */
  mediaInfo(id: string, assetId: string): Promise<StoredMedia | null>;
  /** The bytes of a clip or a sound of a room, from the start (asked only for one that `mediaInfo` found). */
  mediaStream(id: string, assetId: string): Readable;
  /** How many bytes the clips and sounds of a room take. */
  mediaBytes(id: string): Promise<number>;
  count(): Promise<number>;
  checkWritable(): Promise<void>;
  /** Every room with the time it was last used, without reading any of them. */
  list(): Promise<StoredRoom[]>;
  /** Notes that a room was used at this time, without reading or writing the room. A room that is not there stays not there. */
  touch(id: string, at: number): Promise<void>;
}

/** What a room is called: made by the server, long enough not to be guessed, and safe to use as a file name. */
export const ROOM_ID = /^[A-Za-z0-9_-]{16,64}$/;

const looksLikeRecord = (v: unknown): v is RoomRecord => {
  const r = v as Partial<RoomRecord> | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.rev === "number" &&
    typeof r.editHash === "string" &&
    typeof r.viewHash === "string" &&
    !!r.design &&
    Array.isArray(r.design.pages) &&
    r.design.pages.length > 0 &&
    !!r.seqs &&
    typeof r.seqs === "object"
  );
};

/** The record as the text that is kept. With the text of the design given, the design is put in as it is and not turned into text again. */
export function recordText(record: RoomRecord, designJson?: string): string {
  if (designJson === undefined) return JSON.stringify(record);
  const { design: _design, ...rest } = record;
  return `{"design":${designJson},${JSON.stringify(rest).slice(1)}`;
}

const assetText = (asset: SharedAsset) => JSON.stringify({ mime: asset.mime, base64: asset.base64 });
const looksLikeAsset = (v: unknown): v is SharedAsset => {
  const a = v as Partial<SharedAsset> | null;
  return !!a && typeof a === "object" && typeof a.mime === "string" && typeof a.base64 === "string";
};

export class MemoryStorage implements LiveStorage {
  async checkWritable() {
    return Promise.resolve();
  }
  private rooms = new Map<string, { text: string; usedAt: number }>();
  private assets = new Map<string, Map<string, string>>();
  /** The clock says when a room was saved, as the time of a file would; a test gives its own. */
  constructor(private now: () => number = Date.now) {}
  async load(id: string) {
    const room = this.rooms.get(id);
    return room ? (JSON.parse(room.text) as RoomRecord) : null;
  }
  async save(id: string, record: RoomRecord, designJson?: string) {
    this.rooms.set(id, { text: recordText(record, designJson), usedAt: this.now() }); // as it would be on disk: nothing shared with the caller
  }
  async loadAsset(id: string, assetId: string) {
    const text = this.assets.get(id)?.get(assetId);
    return text === undefined ? null : (JSON.parse(text) as SharedAsset);
  }
  async saveAsset(id: string, assetId: string, asset: SharedAsset) {
    const images = this.assets.get(id) ?? new Map<string, string>();
    this.assets.set(id, images.set(assetId, assetText(asset)));
  }
  async assetBytes(id: string) {
    let bytes = 0;
    for (const text of this.assets.get(id)?.values() ?? []) bytes += Buffer.byteLength(text);
    return bytes;
  }
  private media = new Map<string, Map<string, { info: StoredMedia; bytes: Buffer }>>();
  private staged = new Map<string, Buffer>();
  async stageMedia(_id: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number) {
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of source) {
      size += chunk.length;
      if (size > limit) return null;
      hash.update(chunk);
      chunks.push(Buffer.from(chunk));
    }
    const handle = randomBytes(8).toString("hex");
    this.staged.set(handle, Buffer.concat(chunks));
    return { handle, size, sha256: hash.digest("hex") };
  }
  async commitMedia(id: string, assetId: string, staged: StagedMedia, mime: string) {
    const bytes = this.staged.get(staged.handle);
    this.staged.delete(staged.handle);
    if (!bytes) throw new Error("no such received clip");
    const room = this.media.get(id) ?? new Map<string, { info: StoredMedia; bytes: Buffer }>();
    this.media.set(id, room.set(assetId, { info: { mime, size: staged.size, sha256: staged.sha256 }, bytes }));
  }
  async dropMedia(_id: string, staged: StagedMedia) {
    this.staged.delete(staged.handle);
  }
  async mediaInfo(id: string, assetId: string) {
    return this.media.get(id)?.get(assetId)?.info ?? null;
  }
  mediaStream(id: string, assetId: string) {
    return Readable.from([this.media.get(id)?.get(assetId)?.bytes ?? Buffer.alloc(0)]);
  }
  async mediaBytes(id: string) {
    let bytes = 0;
    for (const item of this.media.get(id)?.values() ?? []) bytes += item.info.size;
    return bytes;
  }
  async list() {
    return [...this.rooms].map(([id, room]) => ({ id, usedAt: room.usedAt }));
  }
  async touch(id: string, at: number) {
    const room = this.rooms.get(id);
    if (room) room.usedAt = at;
  }
  async remove(id: string) {
    this.rooms.delete(id);
    this.assets.delete(id);
    this.media.delete(id);
  }
  async count() {
    return this.rooms.size;
  }
}

/**
 * One JSON file per room, written whole and moved into place, so that a crash leaves the old file or the new one. The images of a
 * room are files of their own in a folder beside it, `<room>.assets`, written the same way. An image's file is named by the
 * SHA-256 of its id and not by the id: ids may differ only in capitals, or be a name that a file may not have on some systems.
 */
export class FileStorage implements LiveStorage {
  constructor(private dir: string) {}

  private path(id: string): string {
    if (!ROOM_ID.test(id)) throw new Error("not a room id");
    return join(this.dir, `${id}.json`);
  }

  async load(id: string): Promise<RoomRecord | null> {
    let text: string;
    try {
      text = await readFile(this.path(id), "utf8");
    } catch (error) {
      // Only "there is no such file" means that there is no such room. A disk that fails, or a file that may not be read, is a
      // problem of the server, and whoever asks must not be told that the design is gone.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch (error) {
      throw new Error("the file of this room is damaged: it is not JSON", { cause: error });
    }
    if (!looksLikeRecord(record)) throw new Error("the file of this room is damaged: it does not hold a room");
    return record;
  }

  private assetDir(id: string): string {
    if (!ROOM_ID.test(id)) throw new Error("not a room id");
    return join(this.dir, `${id}.assets`);
  }

  private assetPath(id: string, assetId: string): string {
    return join(this.assetDir(id), `${createHash("sha256").update(assetId).digest("hex")}.json`);
  }

  /** Writes a file whole under another name in the folder and moves it into place. */
  private async write(folder: string, target: string, text: string): Promise<void> {
    await mkdir(folder, { recursive: true });
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, text, { encoding: "utf8", flag: "wx", flush: true });
      await rename(temp, target);
      await this.syncDirectory(folder);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async save(id: string, record: RoomRecord, designJson?: string): Promise<void> {
    await this.write(this.dir, this.path(id), recordText(record, designJson));
  }

  /** The record goes first: from then on there is no such room, and what is left of its images, clips and sounds is nobody's. */
  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
    await rm(this.assetDir(id), { recursive: true, force: true });
    await rm(this.mediaDir(id), { recursive: true, force: true });
    await this.syncDirectory(this.dir);
  }

  async loadAsset(id: string, assetId: string): Promise<SharedAsset | null> {
    let text: string;
    try {
      text = await readFile(this.assetPath(id, assetId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let asset: unknown;
    try {
      asset = JSON.parse(text);
    } catch (error) {
      throw new Error("the file of this image is damaged: it is not JSON", { cause: error });
    }
    if (!looksLikeAsset(asset)) throw new Error("the file of this image is damaged: it does not hold an image");
    return { mime: asset.mime, base64: asset.base64 };
  }

  async saveAsset(id: string, assetId: string, asset: SharedAsset): Promise<void> {
    await this.write(this.assetDir(id), this.assetPath(id, assetId), assetText(asset));
  }

  async assetBytes(id: string): Promise<number> {
    const folder = this.assetDir(id);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let bytes = 0;
    for (const name of names) if (name.endsWith(".json")) bytes += (await stat(join(folder, name))).size;
    return bytes;
  }

  /*
   * The clips and sounds of a room are in a folder of their own beside it, `<room>.media`: the bytes of each in `<hash>.bin`, as
   * they came, and what is known of them in `<hash>.json`, written after the bytes are in place (one without the other is no
   * clip). A clip being received is a `.tmp` file there until it is put in place or thrown away.
   */
  private mediaDir(id: string): string {
    if (!ROOM_ID.test(id)) throw new Error("not a room id");
    return join(this.dir, `${id}.media`);
  }

  private mediaPath(id: string, assetId: string, ext: "bin" | "json"): string {
    return join(this.mediaDir(id), `${createHash("sha256").update(assetId).digest("hex")}.${ext}`);
  }

  async stageMedia(id: string, source: AsyncIterable<Buffer | Uint8Array>, limit: number): Promise<StagedMedia | null> {
    const folder = this.mediaDir(id);
    await mkdir(folder, { recursive: true });
    const handle = join(folder, `${randomBytes(8).toString("hex")}.tmp`);
    const hash = createHash("sha256");
    let size = 0;
    let over = false;
    async function* counted() {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > limit) {
          over = true;
          return;
        }
        hash.update(chunk);
        yield chunk;
      }
    }
    try {
      await pipeline(Readable.from(counted()), createWriteStream(handle, { flags: "wx", flush: true }));
    } catch (error) {
      await rm(handle, { force: true });
      throw error;
    }
    if (over) {
      await rm(handle, { force: true });
      return null;
    }
    return { handle, size, sha256: hash.digest("hex") };
  }

  async commitMedia(id: string, assetId: string, staged: StagedMedia, mime: string): Promise<void> {
    await rename(staged.handle, this.mediaPath(id, assetId, "bin"));
    await this.write(this.mediaDir(id), this.mediaPath(id, assetId, "json"), JSON.stringify({ mime, size: staged.size, sha256: staged.sha256 }));
  }

  async dropMedia(_id: string, staged: StagedMedia): Promise<void> {
    await rm(staged.handle, { force: true });
  }

  async mediaInfo(id: string, assetId: string): Promise<StoredMedia | null> {
    let text: string;
    try {
      text = await readFile(this.mediaPath(id, assetId, "json"), "utf8");
      // the bytes are there too
      await stat(this.mediaPath(id, assetId, "bin"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let info: Partial<StoredMedia>;
    try {
      info = JSON.parse(text) as Partial<StoredMedia>;
    } catch (error) {
      throw new Error("the file of this clip is damaged: it is not JSON", { cause: error });
    }
    if (typeof info.mime !== "string" || typeof info.size !== "number" || typeof info.sha256 !== "string") throw new Error("the file of this clip is damaged");
    return { mime: info.mime, size: info.size, sha256: info.sha256 };
  }

  mediaStream(id: string, assetId: string): Readable {
    return createReadStream(this.mediaPath(id, assetId, "bin"));
  }

  async mediaBytes(id: string): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.mediaDir(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let bytes = 0;
    for (const name of names) if (name.endsWith(".bin")) bytes += (await stat(join(this.mediaDir(id), name))).size;
    return bytes;
  }

  private async syncDirectory(folder: string): Promise<void> {
    // Windows exposes file flush but does not let Node open a directory for fsync.
    if (process.platform === "win32") return;
    const dir = await open(folder, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }

  async checkWritable(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const probe = join(this.dir, `.health-${randomBytes(8).toString("hex")}`);
    try {
      await writeFile(probe, "", { flag: "wx", flush: true });
    } finally {
      await rm(probe, { force: true });
    }
  }

  /** When a room was last used is the time of its file: a save sets it, and so does `touch`. */
  async list(): Promise<StoredRoom[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rooms: StoredRoom[] = [];
    for (const name of names) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!ROOM_ID.test(id)) continue;
      try {
        rooms.push({ id, usedAt: (await stat(join(this.dir, name))).mtimeMs });
      } catch (error) {
        // removed since the folder was read: it is not a room any more
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return rooms;
  }

  async touch(id: string, at: number): Promise<void> {
    try {
      await utimes(this.path(id), at / 1000, at / 1000);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async count(): Promise<number> {
    try {
      return (await readdir(this.dir)).filter((name) => name.endsWith(".json")).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }
}
