/**
 * A tiny store-only ZIP writer (no compression, no ZIP64): local file headers, a central directory and an
 * end-of-central-directory record with correct CRC-32 checksums, UTF-8 file names and DOS timestamps.
 * PNG / JPEG / SVG / PDF payloads are already compressed (or small), so "stored" entries keep the writer
 * simple, fast and dependency free, and every unzip tool opens the result.
 *
 * Big entries are never copied: `createZip` keeps each `Blob` as a Blob part and only reads it once to
 * compute the checksum, so memory use stays at one file at a time.
 */

import { nextMacrotask } from "./yield";

/* ------------------------------------------------------------------ */
/* CRC-32 (IEEE 802.3, the one ZIP uses)                              */
/* ------------------------------------------------------------------ */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Incremental CRC-32: `crc32(b, crc32(a))` equals `crc32(concat(a, b))`. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  const n = bytes.length;
  let i = 0;
  // 4x unrolled: the table lookup dominates, the loop overhead is what we trim
  for (; i + 4 <= n; i += 4) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ bytes[i + 1]) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ bytes[i + 2]) & 0xff] ^ (c >>> 8);
    c = CRC_TABLE[(c ^ bytes[i + 3]) & 0xff] ^ (c >>> 8);
  }
  for (; i < n; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const macrotask = nextMacrotask;
const CRC_SLICE = 4 * 1024 * 1024;

/** Same as `crc32`, but hands the thread back between 4 MB slices so a 50 MB file never freezes the tab. */
export async function crc32Async(bytes: Uint8Array): Promise<number> {
  if (bytes.length <= CRC_SLICE) return crc32(bytes);
  let crc = 0;
  for (let at = 0; at < bytes.length; at += CRC_SLICE) {
    crc = crc32(bytes.subarray(at, Math.min(bytes.length, at + CRC_SLICE)), crc);
    if (at + CRC_SLICE < bytes.length) await macrotask();
  }
  return crc;
}

/* ------------------------------------------------------------------ */
/* DOS date / time                                                    */
/* ------------------------------------------------------------------ */

/** MS-DOS time and date words (local time, 2 second resolution, 1980..2107). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (!Number.isFinite(year) || year < 1980) return { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  const y = Math.min(year, 2107) - 1980;
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: (y << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/* ------------------------------------------------------------------ */
/* Records                                                            */
/* ------------------------------------------------------------------ */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

export interface ZipInput {
  /** path inside the archive; `/` separates folders */
  name: string;
  data: Uint8Array | Blob;
  /** timestamp stored for the entry (default: now) */
  modified?: Date;
}

export interface ZipEntryInfo {
  name: string;
  size: number;
  crc: number;
  offset: number;
}

interface Prepared {
  nameBytes: Uint8Array;
  flags: number;
  time: number;
  date: number;
  crc: number;
  size: number;
  data: Uint8Array | Blob;
}

const encoder = new TextEncoder();

/** Archive-safe entry name: forward slashes, no leading slash, no control characters, never empty. */
export function normalizeEntryName(name: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    // eslint-disable-next-line no-control-regex -- a path in an archive has no control characters
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  return cleaned || "file";
}

/** Makes names unique by appending " (2)", " (3)" ... before the extension. */
export function uniqueEntryNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = normalizeEntryName(raw);
    let candidate = name;
    if (used.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const stem = dot > name.lastIndexOf("/") + 1 ? name.slice(0, dot) : name;
      const ext = stem === name ? "" : name.slice(dot);
      for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function u16(view: DataView, at: number, v: number): void {
  view.setUint16(at, v, true);
}
function u32(view: DataView, at: number, v: number): void {
  view.setUint32(at, v >>> 0, true);
}

function localHeader(p: Prepared): Uint8Array {
  const out = new Uint8Array(30 + p.nameBytes.length);
  const v = new DataView(out.buffer);
  u32(v, 0, SIG_LOCAL);
  u16(v, 4, VERSION);
  u16(v, 6, p.flags);
  u16(v, 8, 0); // method 0 = stored
  u16(v, 10, p.time);
  u16(v, 12, p.date);
  u32(v, 14, p.crc);
  u32(v, 18, p.size);
  u32(v, 22, p.size);
  u16(v, 26, p.nameBytes.length);
  u16(v, 28, 0);
  out.set(p.nameBytes, 30);
  return out;
}

function centralHeader(p: Prepared, offset: number): Uint8Array {
  const out = new Uint8Array(46 + p.nameBytes.length);
  const v = new DataView(out.buffer);
  u32(v, 0, SIG_CENTRAL);
  u16(v, 4, VERSION); // version made by
  u16(v, 6, VERSION); // version needed
  u16(v, 8, p.flags);
  u16(v, 10, 0);
  u16(v, 12, p.time);
  u16(v, 14, p.date);
  u32(v, 16, p.crc);
  u32(v, 20, p.size);
  u32(v, 24, p.size);
  u16(v, 28, p.nameBytes.length);
  u16(v, 30, 0); // extra
  u16(v, 32, 0); // comment
  u16(v, 34, 0); // disk
  u16(v, 36, 0); // internal attributes
  u32(v, 38, 0); // external attributes
  u32(v, 42, offset);
  out.set(p.nameBytes, 46);
  return out;
}

function endRecord(count: number, centralSize: number, centralOffset: number): Uint8Array {
  const out = new Uint8Array(22);
  const v = new DataView(out.buffer);
  u32(v, 0, SIG_END);
  u16(v, 4, 0);
  u16(v, 6, 0);
  u16(v, 8, count);
  u16(v, 10, count);
  u32(v, 12, centralSize);
  u32(v, 16, centralOffset);
  u16(v, 20, 0);
  return out;
}

function prepare(name: string, data: Uint8Array | Blob, size: number, crc: number, modified: Date | undefined): Prepared {
  const nameBytes = encoder.encode(name);
  if (nameBytes.length > MAX_U16) throw new Error(`The file name "${name.slice(0, 40)}..." is too long for a ZIP archive.`);
  const ascii = nameBytes.every((b) => b < 0x80);
  const stamp = dosDateTime(modified ?? new Date());
  return { nameBytes, flags: ascii ? 0 : FLAG_UTF8, time: stamp.time, date: stamp.date, crc, size, data };
}

function assemble(items: Prepared[]): { parts: Array<Uint8Array | Blob>; size: number; entries: ZipEntryInfo[] } {
  if (items.length > MAX_U16) throw new Error("Too many files for one ZIP archive.");
  const parts: Array<Uint8Array | Blob> = [];
  const entries: ZipEntryInfo[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const p of items) {
    offsets.push(offset);
    entries.push({ name: new TextDecoder().decode(p.nameBytes), size: p.size, crc: p.crc, offset });
    const header = localHeader(p);
    parts.push(header, p.data);
    offset += header.length + p.size;
    if (offset > MAX_U32) throw new Error("The archive is larger than 4 GB, which this ZIP writer does not support.");
  }
  const centralStart = offset;
  let centralSize = 0;
  items.forEach((p, i) => {
    const record = centralHeader(p, offsets[i]);
    parts.push(record);
    centralSize += record.length;
  });
  parts.push(endRecord(items.length, centralSize, centralStart));
  return { parts, size: offset + centralSize + 22, entries };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/** Synchronous writer for in-memory data (small archives, tests). */
export function zipSync(files: Array<{ name: string; data: Uint8Array; modified?: Date }>): Uint8Array {
  const names = uniqueEntryNames(files.map((f) => f.name));
  const items = files.map((f, i) => prepare(names[i], f.data, f.data.length, crc32(f.data), f.modified));
  const { parts, size } = assemble(items);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    const bytes = part as Uint8Array;
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

export interface CreateZipOptions {
  /** called after each entry has been checksummed */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Builds the archive as a Blob. Blob entries are referenced, not copied; each one is read a single time
 * (in 4 MB slices when it is huge) to compute its CRC-32, with a macrotask break between entries.
 */
export async function createZip(files: ZipInput[], options: CreateZipOptions = {}): Promise<Blob> {
  const names = uniqueEntryNames(files.map((f) => f.name));
  const items: Prepared[] = [];
  for (let i = 0; i < files.length; i++) {
    if (options.signal?.aborted) throw new DOMException("Zip cancelled", "AbortError");
    const f = files[i];
    let crc: number;
    let size: number;
    if (f.data instanceof Blob) {
      size = f.data.size;
      crc = await crc32Async(new Uint8Array(await f.data.arrayBuffer()));
    } else {
      size = f.data.length;
      crc = await crc32Async(f.data);
    }
    items.push(prepare(names[i], f.data, size, crc, f.modified));
    options.onProgress?.(i + 1, files.length);
    await macrotask();
  }
  const { parts } = assemble(items);
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}
