import { describe, expect, it, vi } from "vitest";
import { createZip, zipSync } from "./zip";
import { openZip, ZipReadError } from "./zipRead";
import { buildZip, deflateRaw, slowCrc32 } from "@/test/zipBuilder";

const enc = new TextEncoder();
const bytesOf = (text: string) => enc.encode(text);
const asBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/zip" });
const readText = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

async function failure(promise: Promise<unknown>): Promise<ZipReadError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ZipReadError);
    return error as ZipReadError;
  }
  throw new Error("expected a ZipReadError, but nothing was thrown");
}

describe("openZip: archives made by our own writer", () => {
  it("lists every file with its size and returns its contents", async () => {
    const archive = await openZip(
      await createZip([
        { name: "a.txt", data: bytesOf("alpha") },
        { name: "folder/b.json", data: new Blob(['{"b":true}']) },
        { name: "empty.bin", data: new Uint8Array(0) },
        { name: "größe ✓.txt", data: bytesOf("unicode") },
      ]),
    );
    expect(archive.entries.map((e) => [e.name, e.size])).toEqual([
      ["a.txt", 5],
      ["folder/b.json", 10],
      ["empty.bin", 0],
      ["größe ✓.txt", 7],
    ]);
    expect(await readText(await archive.read(archive.find("a.txt")!))).toBe("alpha");
    expect(await archive.text(archive.find("folder/b.json")!)).toBe('{"b":true}');
    expect((await archive.read(archive.find("empty.bin")!)).size).toBe(0);
    expect(await archive.text(archive.find("größe ✓.txt")!)).toBe("unicode");
  });

  it("finds an entry by its name, and says nothing when there is none", async () => {
    const archive = await openZip(asBlob(zipSync([{ name: "one.txt", data: bytesOf("1") }])));
    expect(archive.find("one.txt")?.name).toBe("one.txt");
    expect(archive.find("two.txt")).toBeUndefined();
  });

  it("hands a stored file out as a slice of the archive, with the type that was asked for", async () => {
    const archive = await openZip(asBlob(zipSync([{ name: "p.png", data: new Uint8Array([137, 80, 78, 71]) }])));
    const blob = await archive.read(archive.find("p.png")!, { type: "image/png" });
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it("checks a file bigger than one slice of the checksum all the way through", async () => {
    const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const archive = await openZip(asBlob(zipSync([{ name: "big.bin", data: big }])));
    const blob = await archive.read(archive.find("big.bin")!);
    expect(blob.size).toBe(big.length);

    const damaged = zipSync([{ name: "big.bin", data: big }]);
    damaged[30 + "big.bin".length + 6 * 1024 * 1024] ^= 0xff; // a byte in the second slice
    const broken = await openZip(asBlob(damaged));
    expect((await failure(broken.read(broken.find("big.bin")!))).code).toBe("damaged");
  });
});

describe("openZip: archives made by other tools", () => {
  it("reads deflate-compressed files", async () => {
    const text = "compress me ".repeat(500);
    const archive = await openZip(asBlob(await buildZip([{ name: "z.txt", data: bytesOf(text), method: 8 }])));
    const entry = archive.find("z.txt")!;
    expect(entry.size).toBe(text.length);
    expect(entry.compressedSize).toBeLessThan(text.length);
    expect(await archive.text(entry)).toBe(text);
  });

  it("copes with extra fields that differ between the local and the central header, a comment, and folder entries", async () => {
    const archive = await openZip(
      asBlob(
        await buildZip(
          [
            { name: "dir/", data: new Uint8Array(0) },
            { name: "dir/x.txt", data: bytesOf("x marks"), localExtra: 24, centralExtra: 4 },
            { name: "y.txt", data: bytesOf("why"), method: 8, localExtra: 7 },
          ],
          "made by some other tool",
        ),
      ),
    );
    expect(archive.entries.map((e) => e.name)).toEqual(["dir/x.txt", "y.txt"]);
    expect(await archive.text(archive.find("dir/x.txt")!)).toBe("x marks");
    expect(await archive.text(archive.find("y.txt")!)).toBe("why");
  });

  it("takes a backslash in a name for a slash, as some old tools write it", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "dir\\inner.txt", data: bytesOf("x") }])));
    expect(archive.find("dir/inner.txt")?.name).toBe("dir/inner.txt");
  });

  it("uses the first of two files that have the same name", async () => {
    const archive = await openZip(
      asBlob(
        await buildZip([
          { name: "same.txt", data: bytesOf("first") },
          { name: "same.txt", data: bytesOf("second") },
        ]),
      ),
    );
    expect(archive.entries).toHaveLength(2);
    expect(await archive.text(archive.find("same.txt")!)).toBe("first");
  });

  it("reads names that are not marked as UTF-8 the same way", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "café.txt", data: bytesOf("au lait"), flags: 0 }])));
    expect(archive.find("café.txt")).toBeDefined();
  });
});

describe("openZip: damage", () => {
  it("names the file whose contents no longer match their checksum", async () => {
    const bytes = zipSync([{ name: "d.json", data: bytesOf('{"fine":true}') }]);
    bytes[30 + "d.json".length + 3] ^= 0x01;
    const archive = await openZip(asBlob(bytes));
    const error = await failure(archive.read(archive.find("d.json")!));
    expect(error.code).toBe("damaged");
    expect(error.message).toContain("d.json");
  });

  it("notices a deflate stream that was cut short or altered", async () => {
    const data = bytesOf("some text that deflates ".repeat(200));
    const stream = await deflateRaw(data);
    const archive = await openZip(asBlob(await buildZip([{ name: "t.txt", data, method: 8, payload: stream.subarray(0, stream.length - 6) }])));
    expect((await failure(archive.read(archive.find("t.txt")!))).code).toBe("damaged");

    const flipped = stream.slice();
    flipped[Math.floor(flipped.length / 2)] ^= 0xff;
    const other = await openZip(asBlob(await buildZip([{ name: "t.txt", data, method: 8, payload: flipped }])));
    expect((await failure(other.read(other.find("t.txt")!))).code).toBe("damaged");
  });

  it("notices a local header that is not where the directory says", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "h.txt", data: bytesOf("head"), localSignature: 0x12345678 }])));
    expect((await failure(archive.read(archive.find("h.txt")!))).code).toBe("damaged");
  });

  it("notices a file whose data would run past the end of the archive", async () => {
    const bytes = await buildZip([{ name: "long.bin", data: bytesOf("12345678") }]);
    // central directory: compressed size 8 -> 80000
    const at = bytes.length - 22 - (46 + "long.bin".length) + 20;
    new DataView(bytes.buffer).setUint32(at, 80000, true);
    const archive = await openZip(asBlob(bytes));
    expect((await failure(archive.read(archive.find("long.bin")!))).code).toBe("damaged");
  });

  it("refuses a deflate file that unpacks to more than it says", async () => {
    const data = bytesOf("grows ".repeat(2000));
    const archive = await openZip(asBlob(await buildZip([{ name: "bomb.txt", data, method: 8, size: 100, crc: slowCrc32(data.subarray(0, 100)) }])));
    expect((await failure(archive.read(archive.find("bomb.txt")!))).code).toBe("damaged");
  });

  it("stops unpacking a compressed file as soon as it has produced more than it says, instead of unpacking it all", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "z.txt", data: bytesOf("tiny"), method: 8, size: 100 }])));
    let pulls = 0;
    // a stand-in for the browser's unpacker that never stops: what a zip bomb looks like from this side
    class Endless {
      readable = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(1024));
        },
      });
      writable = new WritableStream<Uint8Array>();
    }
    vi.stubGlobal("DecompressionStream", Endless);
    try {
      expect((await failure(archive.read(archive.find("z.txt")!))).code).toBe("damaged");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(pulls).toBeLessThan(5);
  });

  it("refuses a file that claims to be bigger than the limit before unpacking anything", async () => {
    const data = bytesOf("small");
    const archive = await openZip(asBlob(await buildZip([{ name: "claim.txt", data, method: 8, size: 600 * 1024 * 1024 }])));
    expect((await failure(archive.read(archive.find("claim.txt")!))).code).toBe("too-large");
    expect((await failure(archive.read(archive.find("claim.txt")!, { maxBytes: 100 }))).code).toBe("too-large");
  });

  it("refuses a compressed file that unpacks to another size or another checksum than it says", async () => {
    const shorter = await openZip(asBlob(await buildZip([{ name: "s.txt", data: bytesOf("short"), method: 8, size: 50 }])));
    expect((await failure(shorter.read(shorter.find("s.txt")!))).code).toBe("damaged");
    const wrongSum = await openZip(asBlob(await buildZip([{ name: "c.txt", data: bytesOf("checked"), method: 8, crc: 12345 }])));
    expect((await failure(wrongSum.read(wrongSum.find("c.txt")!))).code).toBe("damaged");
  });

  it("says a stored file whose two sizes disagree is damaged", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "odd.txt", data: bytesOf("12345"), size: 9 }])));
    expect((await failure(archive.read(archive.find("odd.txt")!))).code).toBe("damaged");
  });
});

describe("openZip: files that are not (readable) archives", () => {
  it("rejects a file that is not a ZIP at all", async () => {
    for (const bytes of [new Uint8Array(0), bytesOf("just some text"), new Uint8Array(100_000).fill(7)]) {
      expect((await failure(openZip(asBlob(bytes)))).code).toBe("not-a-zip");
    }
  });

  it("rejects an archive whose end was cut off", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    expect((await failure(openZip(asBlob(bytes.subarray(0, bytes.length - 10))))).code).toBe("not-a-zip");
  });

  it("rejects a directory that points outside the file", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 1_000_000, true);
    expect((await failure(openZip(asBlob(bytes)))).code).toBe("damaged");
  });

  it("rejects a file list whose record claims more bytes than the list has", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    const centralAt = bytes.length - 22 - (46 + "a.txt".length);
    new DataView(bytes.buffer).setUint16(centralAt + 28, 60000, true);
    expect((await failure(openZip(asBlob(bytes)))).code).toBe("damaged");
  });

  it("notices a file whose header would start beyond the end of the archive", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    const centralAt = bytes.length - 22 - (46 + "a.txt".length);
    new DataView(bytes.buffer).setUint32(centralAt + 42, bytes.length - 5, true);
    const archive = await openZip(asBlob(bytes));
    expect((await failure(archive.read(archive.find("a.txt")!))).code).toBe("damaged");
  });

  it("rejects a directory whose records are not records", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    const centralAt = bytes.length - 22 - (46 + "a.txt".length);
    bytes[centralAt] = 0;
    expect((await failure(openZip(asBlob(bytes)))).code).toBe("damaged");
  });

  it("says an archive that is split over several files is not supported", async () => {
    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    new DataView(bytes.buffer).setUint16(bytes.length - 22 + 4, 1, true);
    expect((await failure(openZip(asBlob(bytes)))).code).toBe("unsupported");
  });

  it("says a compressed file cannot be opened by a browser that has no way to unpack it", async () => {
    const archive = await openZip(asBlob(await buildZip([{ name: "z.txt", data: bytesOf("zip me"), method: 8 }])));
    vi.stubGlobal("DecompressionStream", undefined);
    try {
      expect((await failure(archive.read(archive.find("z.txt")!))).code).toBe("unsupported");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says plainly that encrypted archives and ZIP64 archives are not supported", async () => {
    const encrypted = await openZip(asBlob(await buildZip([{ name: "s.txt", data: bytesOf("secret"), flags: 1 }])));
    expect((await failure(encrypted.read(encrypted.find("s.txt")!))).code).toBe("unsupported");

    const huge = await buildZip([{ name: "h.txt", data: bytesOf("big"), size: 0xffffffff }]);
    expect((await failure(openZip(asBlob(huge)))).code).toBe("unsupported");

    const bytes = zipSync([{ name: "a.txt", data: bytesOf("alpha") }]);
    new DataView(bytes.buffer).setUint16(bytes.length - 22 + 10, 0xffff, true);
    expect((await failure(openZip(asBlob(bytes)))).code).toBe("unsupported");
  });

  it("says a compression method it does not know is not supported, only for that file", async () => {
    const archive = await openZip(
      asBlob(
        await buildZip([
          { name: "ok.txt", data: bytesOf("fine") },
          { name: "bz.txt", data: bytesOf("bzip"), method: 12 },
        ]),
      ),
    );
    expect(await archive.text(archive.find("ok.txt")!)).toBe("fine");
    expect((await failure(archive.read(archive.find("bz.txt")!))).code).toBe("unsupported");
  });
});

describe("openZip: cancelling", () => {
  it("stops in the middle of a file, stored or compressed, when the signal is aborted meanwhile", async () => {
    const archive = await openZip(
      asBlob(
        await buildZip([
          { name: "stored.txt", data: bytesOf("stored ".repeat(100)) },
          { name: "packed.txt", data: bytesOf("packed ".repeat(100)), method: 8 },
        ]),
      ),
    );
    for (const name of ["stored.txt", "packed.txt"]) {
      const controller = new AbortController();
      const reading = archive.read(archive.find(name)!, { signal: controller.signal });
      controller.abort();
      await expect(reading, name).rejects.toMatchObject({ name: "AbortError" });
    }
  });

  it("refuses to read a text file bigger than the limit it was given", async () => {
    const archive = await openZip(asBlob(zipSync([{ name: "a.txt", data: bytesOf("alpha") }])));
    expect((await failure(archive.text(archive.find("a.txt")!, { maxBytes: 2 }))).code).toBe("too-large");
  });

  it("stops reading a file when the signal is aborted", async () => {
    const archive = await openZip(asBlob(zipSync([{ name: "a.txt", data: bytesOf("alpha") }])));
    const controller = new AbortController();
    controller.abort();
    await expect(archive.read(archive.find("a.txt")!, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
