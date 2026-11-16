/**
 * A small ZIP reader, the counterpart of `zip.ts`. It reads the file list from the end of the archive and hands out
 * single files as Blobs, so a backup of a gigabyte is never held in memory whole. Every file is checked against its
 * CRC-32 on the way out. Besides the "stored" files our writer makes it understands "deflate", which is what any
 * other tool (Explorer, Finder, 7-Zip) produces when someone opens a backup and zips it again.
 *
 * Not supported, and said so: encrypted files, ZIP64 (archives over 4 GB, which our writer cannot make either) and
 * archives split over several disks.
 */
import { m } from "@/i18n";
import { crc32 } from "./zip";
import { nextMacrotask } from "./yield";

export type ZipReadErrorCode = "not-a-zip" | "damaged" | "unsupported" | "too-large";

export class ZipReadError extends Error {
  readonly code: ZipReadErrorCode;
  constructor(code: ZipReadErrorCode, message: string) {
    super(message);
    this.name = "ZipReadError";
    this.code = code;
  }
}

export interface ZipReadEntry {
  /** path inside the archive, with `/` as the separator */
  name: string;
  /** size of the file once unpacked */
  size: number;
  compressedSize: number;
  /** 0 = stored, 8 = deflate */
  method: number;
  crc: number;
  flags: number;
  /** where the file's local header starts */
  offset: number;
}

export interface ZipReadOptions {
  signal?: AbortSignal;
  /** the `type` of the Blob that comes back */
  type?: string;
  /** the most a deflated file may unpack to (default 512 MB): a file claiming more is refused before anything is unpacked */
  maxBytes?: number;
}

export interface ZipArchive {
  readonly entries: readonly ZipReadEntry[];
  find(name: string): ZipReadEntry | undefined;
  /** The file's contents, checked against its checksum. */
  read(entry: ZipReadEntry, options?: ZipReadOptions): Promise<Blob>;
  /** The file's contents as UTF-8 text (at most 64 MB unless `maxBytes` says otherwise). */
  text(entry: ZipReadEntry, options?: Pick<ZipReadOptions, "signal" | "maxBytes">): Promise<string>;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const END_RECORD = 22;
const MAX_COMMENT = 0xffff;
const SLICE = 4 * 1024 * 1024;
const MAX_UNPACKED = 512 * 1024 * 1024;
const MAX_TEXT = 64 * 1024 * 1024;

const abortError = () => new DOMException("Reading was cancelled", "AbortError");

async function bytesAt(source: Blob, from: number, to: number): Promise<Uint8Array> {
  return new Uint8Array(await source.slice(from, to).arrayBuffer());
}

/** The tail of the file holds the end record; a comment of up to 64 KB may follow it. */
function findEndRecord(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - END_RECORD; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_END && i + END_RECORD + view.getUint16(i + 20, true) <= tail.length) return i;
  }
  return -1;
}

/** Opens an archive: reads only the file list. Throws `ZipReadError` when it is not one or cannot be read. */
export async function openZip(source: Blob): Promise<ZipArchive> {
  const notAZip = () => new ZipReadError("not-a-zip", m.exporting.zip.notAZip);
  if (source.size < END_RECORD) throw notAZip();

  const tailStart = Math.max(0, source.size - (END_RECORD + MAX_COMMENT));
  const tail = await bytesAt(source, tailStart, source.size);
  const endAt = findEndRecord(tail);
  if (endAt < 0) throw notAZip();

  const end = new DataView(tail.buffer, tail.byteOffset + endAt, END_RECORD);
  const count = end.getUint16(10, true);
  const directorySize = end.getUint32(12, true);
  const directoryOffset = end.getUint32(16, true);
  if (end.getUint16(4, true) !== 0 || end.getUint16(6, true) !== 0) throw new ZipReadError("unsupported", m.exporting.zip.split);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new ZipReadError("unsupported", m.exporting.zip.zip64);
  const endPosition = tailStart + endAt;
  if (directoryOffset + directorySize > endPosition) throw new ZipReadError("damaged", m.exporting.zip.listOutOfPlace);

  const directory = await bytesAt(source, directoryOffset, directoryOffset + directorySize);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipReadEntry[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > directory.length || view.getUint32(at, true) !== SIG_CENTRAL) throw new ZipReadError("damaged", m.exporting.zip.listUnreadable);
    const nameLength = view.getUint16(at + 28, true);
    const length = 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (at + length > directory.length) throw new ZipReadError("damaged", m.exporting.zip.listUnreadable);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, "/");
    const entry: ZipReadEntry = {
      name,
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    };
    at += length;
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw new ZipReadError("unsupported", m.exporting.zip.zip64);
    if (!name.endsWith("/")) entries.push(entry);
  }

  const byName = new Map<string, ZipReadEntry>();
  for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry);

  /** Where a file's bytes start: the local header repeats the name and may carry an extra field of its own. */
  async function dataRange(entry: ZipReadEntry): Promise<[number, number]> {
    const damaged = () => new ZipReadError("damaged", m.exporting.zip.fileDamaged(entry.name));
    const head = await bytesAt(source, entry.offset, entry.offset + 30);
    if (head.length < 30) throw damaged();
    const local = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (local.getUint32(0, true) !== SIG_LOCAL) throw damaged();
    const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const stop = start + entry.compressedSize;
    if (stop > directoryOffset) throw damaged();
    return [start, stop];
  }

  async function read(entry: ZipReadEntry, options: ZipReadOptions = {}): Promise<Blob> {
    const { signal, type = "" } = options;
    const damaged = () => new ZipReadError("damaged", m.exporting.zip.fileDamaged(entry.name));
    if (signal?.aborted) throw abortError();
    if (entry.flags & 1) throw new ZipReadError("unsupported", m.exporting.zip.encrypted(entry.name));
    if (entry.method !== 0 && entry.method !== 8) throw new ZipReadError("unsupported", m.exporting.zip.compression(entry.name));

    if (entry.method === 8 && entry.size > (options.maxBytes ?? MAX_UNPACKED)) {
      throw new ZipReadError("too-large", m.exporting.zip.tooLarge(entry.name));
    }
    const [start, stop] = await dataRange(entry);

    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) throw damaged();
      const blob = source.slice(start, stop, type);
      let crc = 0;
      for (let from = 0; from < blob.size; from += SLICE) {
        if (signal?.aborted) throw abortError();
        crc = crc32(await bytesAt(blob, from, from + SLICE), crc);
        if (from + SLICE < blob.size) await nextMacrotask();
      }
      if (crc !== entry.crc) throw damaged();
      return blob;
    }

    if (typeof DecompressionStream === "undefined") throw new ZipReadError("unsupported", m.exporting.zip.noDecompression);
    const chunks: Uint8Array[] = [];
    let total = 0;
    let crc = 0;
    try {
      const reader = source.slice(start, stop).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      for (;;) {
        if (signal?.aborted) {
          await reader.cancel();
          throw abortError();
        }
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > entry.size) {
          await reader.cancel();
          throw damaged();
        }
        crc = crc32(value, crc);
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof ZipReadError || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw damaged();
    }
    if (total !== entry.size || crc !== entry.crc) throw damaged();
    return new Blob(chunks as BlobPart[], { type });
  }

  return {
    entries,
    find: (name) => byName.get(name),
    read,
    async text(entry, options = {}) {
      const limit = options.maxBytes ?? MAX_TEXT;
      if (entry.size > limit) throw new ZipReadError("too-large", m.exporting.zip.tooLarge(entry.name));
      return new TextDecoder().decode(await (await read(entry, { ...options, maxBytes: limit })).arrayBuffer());
    },
  };
}
