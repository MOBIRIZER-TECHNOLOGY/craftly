/**
 * Builds ZIP archives the way other tools do (deflate, extra fields, comments, damaged headers), independent of the
 * writer in src/export/zip.ts, so the reader is not only ever checked against the code that made its input.
 */

export function slowCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface RawEntry {
  name: string;
  data: Uint8Array;
  /** 0 = stored (default), 8 = deflate */
  method?: number;
  flags?: number;
  localExtra?: number;
  centralExtra?: number;
  /** written instead of the real checksum */
  crc?: number;
  /** written instead of the real size */
  size?: number;
  /** written instead of the real data (for a method 8 entry: the deflate stream) */
  payload?: Uint8Array;
  /** written instead of the local header signature */
  localSignature?: number;
}

const enc = new TextEncoder();

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function record(length: number, write: (v: DataView) => void): Uint8Array {
  const out = new Uint8Array(length);
  write(new DataView(out.buffer));
  return out;
}

export async function buildZip(entries: RawEntry[], comment = ""): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 0;
    const name = enc.encode(e.name);
    const payload = e.payload ?? (method === 8 ? await deflateRaw(e.data) : e.data);
    const crc = e.crc ?? slowCrc32(e.data);
    const size = e.size ?? e.data.length;
    const flags = e.flags ?? 0;
    const local = record(30 + name.length + (e.localExtra ?? 0), (v) => {
      v.setUint32(0, e.localSignature ?? 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, flags, true);
      v.setUint16(8, method, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, 0x21, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, payload.length, true);
      v.setUint32(22, size, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, e.localExtra ?? 0, true);
    });
    local.set(name, 30);
    local.fill(0xee, 30 + name.length); // the extra field
    const header = record(46 + name.length + (e.centralExtra ?? 0), (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, flags, true);
      v.setUint16(10, method, true);
      v.setUint16(12, 0, true);
      v.setUint16(14, 0x21, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, payload.length, true);
      v.setUint32(24, size, true);
      v.setUint16(28, name.length, true);
      v.setUint16(30, e.centralExtra ?? 0, true);
      v.setUint32(42, offset, true);
    });
    header.set(name, 46);
    header.fill(0xdd, 46 + name.length);
    central.push(header);
    parts.push(local, payload);
    offset += local.length + payload.length;
  }
  const centralBytes = concat(central);
  const note = enc.encode(comment);
  const end = record(22 + note.length, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, centralBytes.length, true);
    v.setUint32(16, offset, true);
    v.setUint16(20, note.length, true);
  });
  end.set(note, 22);
  return concat([...parts, centralBytes, end]);
}
