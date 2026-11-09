/**
 * Where the server keeps its rooms between runs. A room is one shared design with the revision it is at, the numbers of the last
 * batches it applied from each client, and a hash of each of its two keys (a copy of the files cannot be used to edit or to look).
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Design } from "@/core/types";

export interface RoomRecord {
  design: Design;
  rev: number;
  seqs: Record<string, number>;
  /** hex SHA-256 of the key that lets a person edit */
  editHash: string;
  /** hex SHA-256 of the key that lets a person look */
  viewHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveStorage {
  load(id: string): Promise<RoomRecord | null>;
  save(id: string, record: RoomRecord): Promise<void>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
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
  private rooms = new Map<string, string>();
  async load(id: string) {
    const text = this.rooms.get(id);
    return text ? (JSON.parse(text) as RoomRecord) : null;
  }
  async save(id: string, record: RoomRecord) {
    this.rooms.set(id, JSON.stringify(record)); // as it would be on disk: nothing shared with the caller
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
    } catch {
      return null;
    }
    try {
      const record: unknown = JSON.parse(text);
      return looksLikeRecord(record) ? record : null;
    } catch {
      return null;
    }
  }

  async save(id: string, record: RoomRecord): Promise<void> {
    const target = this.path(id);
    await mkdir(this.dir, { recursive: true });
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, JSON.stringify(record), "utf8");
    await rename(temp, target);
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  async count(): Promise<number> {
    try {
      return (await readdir(this.dir)).filter((name) => name.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }
}
