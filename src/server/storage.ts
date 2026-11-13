/**
 * Where the server keeps its rooms between runs. A room is one shared design with the revision it is at, the numbers of the last
 * batches it applied from each client, and a hash of each of its two keys (a copy of the files cannot be used to edit or to look).
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Design } from "@/core/types";

export interface SharedAsset {
  mime: string;
  base64: string;
}

export interface RoomRecord {
  assets?: Record<string, SharedAsset>;
  design: Design;
  rev: number;
  seqs: Record<string, number>;
  /** hex SHA-256 of the key that lets a person edit */
  editHash: string;
  /** hex SHA-256 of the key that lets a person look */
  viewHash: string;
  /** Older rooms have no owner credential. */
  ownerHash?: string;
  createdAt: number;
  updatedAt: number;
}

/** A room that is kept, and when it was last used: saved, or noted as used with `touch`. */
export interface StoredRoom {
  id: string;
  usedAt: number;
}

export interface LiveStorage {
  /** The room, or null when there is none. A room that is there and cannot be read is an error, not a room that is gone. */
  load(id: string): Promise<RoomRecord | null>;
  save(id: string, record: RoomRecord): Promise<void>;
  remove(id: string): Promise<void>;
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

export class MemoryStorage implements LiveStorage {
  async checkWritable() {
    return Promise.resolve();
  }
  private rooms = new Map<string, { text: string; usedAt: number }>();
  /** The clock says when a room was saved, as the time of a file would; a test gives its own. */
  constructor(private now: () => number = Date.now) {}
  async load(id: string) {
    const room = this.rooms.get(id);
    return room ? (JSON.parse(room.text) as RoomRecord) : null;
  }
  async save(id: string, record: RoomRecord) {
    this.rooms.set(id, { text: JSON.stringify(record), usedAt: this.now() }); // as it would be on disk: nothing shared with the caller
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
  }
  async count() {
    return this.rooms.size;
  }
}

/** One JSON file per room, written whole and moved into place, so that a crash leaves the old file or the new one. */
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

  async save(id: string, record: RoomRecord): Promise<void> {
    const target = this.path(id);
    await mkdir(this.dir, { recursive: true });
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(record), { encoding: "utf8", flag: "wx", flush: true });
      await rename(temp, target);
      await this.syncDirectory();
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
    await this.syncDirectory();
  }

  private async syncDirectory(): Promise<void> {
    // Windows exposes file flush but does not let Node open a directory for fsync.
    if (process.platform === "win32") return;
    const dir = await open(this.dir, "r");
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
