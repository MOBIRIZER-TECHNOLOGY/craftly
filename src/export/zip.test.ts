import { describe, expect, it } from "vitest";
import { crc32, crc32Async, createZip, dosDateTime, normalizeEntryName, uniqueEntryNames, zipSync } from "./zip";

/* ---- an independent, deliberately naive implementation to check the writer against ---- */

function slowCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  method: number;
  flags: number;
  time: number;
  date: number;
}

/** Minimal ZIP reader: finds the end record, walks the central directory, follows each local header. */
function readZip(bytes: Uint8Array): ReadEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  expect(end, "end of central directory record").toBeGreaterThanOrEqual(0);
  const count = v.getUint16(end + 10, true);
  expect(v.getUint16(end + 8, true)).toBe(count);
  const centralSize = v.getUint32(end + 12, true);
  const centralOffset = v.getUint32(end + 16, true);
  expect(centralOffset + centralSize).toBe(end);
  const out: ReadEntry[] = [];
  let at = centralOffset;
  for (let n = 0; n < count; n++) {
    expect(v.getUint32(at, true), "central header signature").toBe(0x02014b50);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const time = v.getUint16(at + 12, true);
    const date = v.getUint16(at + 14, true);
    const crc = v.getUint32(at + 16, true);
    const csize = v.getUint32(at + 20, true);
    const usize = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // local header must agree with the central one
    expect(v.getUint32(local, true), "local header signature").toBe(0x04034b50);
    expect(v.getUint16(local + 6, true)).toBe(flags);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 18, true)).toBe(csize);
    expect(v.getUint32(local + 22, true)).toBe(usize);
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    expect(new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + lNameLen))).toBe(name);
    const dataStart = local + 30 + lNameLen + lExtraLen;
    out.push({ name, data: bytes.subarray(dataStart, dataStart + csize), crc, method, flags, time, date });
    expect(csize).toBe(usize);
    at += 46 + nameLen + extraLen + commentLen;
  }
  expect(at, "central directory ends where the end record starts").toBe(end);
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the well known check value", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("is incremental", () => {
    const a = text("hello, ");
    const b = text("world");
    expect(crc32(b, crc32(a))).toBe(crc32(text("hello, world")));
  });

  it("agrees with a bitwise implementation on random data (all lengths mod 4)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    for (const len of [1, 2, 3, 4, 5, 6, 7, 8, 63, 64, 65, 1000, 4099]) {
      const data = Uint8Array.from({ length: len }, rnd);
      expect(crc32(data), `length ${len}`).toBe(slowCrc32(data));
    }
  });

  it("crc32Async gives the same answer for data larger than one slice", async () => {
    const big = new Uint8Array(9 * 1024 * 1024 + 13);
    for (let i = 0; i < big.length; i += 97) big[i] = i & 0xff;
    expect(await crc32Async(big)).toBe(crc32(big));
  });
});

describe("dosDateTime", () => {
  it("packs local date and time", () => {
    const { time, date } = dosDateTime(new Date(2026, 10, 4, 13, 45, 30)); // 4 Nov 2026 13:45:30
    expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 4);
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
  });

  it("clamps years before 1980", () => {
    const { date } = dosDateTime(new Date(1970, 0, 1));
    expect(date).toBe((1 << 5) | 1);
  });
});

describe("entry names", () => {
  it("normalises separators and leading slashes", () => {
    expect(normalizeEntryName("\\a\\b.png")).toBe("a/b.png");
    expect(normalizeEntryName("/x//y.png")).toBe("x/y.png");
    expect(normalizeEntryName("")).toBe("file");
  });

  it("makes names unique, keeping the extension", () => {
    expect(uniqueEntryNames(["a.png", "a.png", "A.PNG", "b"])).toEqual(["a.png", "a (2).png", "A (3).PNG", "b"]);
    expect(uniqueEntryNames(["x", "x"])).toEqual(["x", "x (2)"]);
  });
});

describe("zipSync", () => {
  it("round-trips several files with correct checksums", () => {
    const files = [
      { name: "Design - 1.png", data: Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 0xff) },
      { name: "Design - 2.png", data: text("second file") },
      { name: "empty.txt", data: new Uint8Array(0) },
    ];
    const zip = zipSync(files);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((e, i) => {
      expect(e.method).toBe(0);
      expect(e.data).toEqual(files[i].data);
      expect(e.crc).toBe(slowCrc32(files[i].data));
    });
  });

  it("starts with the local header signature and ends with the end record", () => {
    const zip = zipSync([{ name: "a.txt", data: text("a") }]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it("stores non-ASCII names as UTF-8 and flags them", () => {
    const zip = zipSync([
      { name: "plain.txt", data: text("x") },
      { name: "Café – 日本語 - 1.png", data: text("y") },
    ]);
    const [plain, unicode] = readZip(zip);
    expect(plain.flags & 0x0800).toBe(0);
    expect(unicode.flags & 0x0800).toBe(0x0800);
    expect(unicode.name).toBe("Café – 日本語 - 1.png");
  });

  it("stores the modification time as DOS words", () => {
    const when = new Date(2025, 5, 17, 8, 9, 10);
    const [entry] = readZip(zipSync([{ name: "t.txt", data: text("t"), modified: when }]));
    const expected = dosDateTime(when);
    expect(entry.time).toBe(expected.time);
    expect(entry.date).toBe(expected.date);
  });

  it("de-duplicates repeated names so the archive stays valid", () => {
    const entries = readZip(
      zipSync([
        { name: "p.png", data: text("1") },
        { name: "p.png", data: text("2") },
      ]),
    );
    expect(entries.map((e) => e.name)).toEqual(["p.png", "p (2).png"]);
  });

  it("handles an empty archive", () => {
    const zip = zipSync([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});

describe("createZip (Blob based)", () => {
  it("keeps Blob entries intact and reports progress", async () => {
    const png = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7) & 0xff);
    const progress: Array<[number, number]> = [];
    const blob = await createZip(
      [
        { name: "A - 1.png", data: new Blob([png], { type: "image/png" }) },
        { name: "A - 2.png", data: text("raw bytes") },
      ],
      { onProgress: (d, t) => progress.push([d, t]) },
    );
    expect(blob.type).toBe("application/zip");
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    const entries = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(entries).toHaveLength(2);
    expect(entries[0].data).toEqual(png);
    expect(entries[0].crc).toBe(slowCrc32(png));
    expect(new TextDecoder().decode(entries[1].data)).toBe("raw bytes");
  });

  it("produces the same bytes as the synchronous writer", async () => {
    const when = new Date(2026, 0, 2, 3, 4, 6);
    const data = text("same payload");
    const sync = zipSync([{ name: "x.txt", data, modified: when }]);
    const blob = await createZip([{ name: "x.txt", data: new Blob([data]), modified: when }]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(sync);
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createZip([{ name: "x", data: text("x") }], { signal: controller.signal })).rejects.toThrow();
  });
});
