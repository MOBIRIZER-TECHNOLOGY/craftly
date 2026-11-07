import { describe, expect, it } from "vitest";
import { createZip, zipSync } from "./zip";

describe("what a ZIP archive cannot hold", () => {
  it("refuses a file name of more than 65535 bytes, naming the start of it", () => {
    const name = `${"é".repeat(40_000)}.txt`;
    expect(() => zipSync([{ name, data: Uint8Array.of(1) }])).toThrow(/The file name "é{40}\.\.\." is too long for a ZIP archive\./);
    // 65535 bytes is still fine
    expect(() => zipSync([{ name: "a".repeat(65_535), data: Uint8Array.of(1) }])).not.toThrow();
  });

  it("refuses more than 65535 files, but takes 65535", () => {
    const files = (count: number) => Array.from({ length: count }, (_v, i) => ({ name: `f${i}.txt`, data: new Uint8Array(0) }));
    expect(() => zipSync(files(65_536))).toThrow("Too many files for one ZIP archive.");
    expect(zipSync(files(65_535)).length).toBeGreaterThan(65_535 * 46);
  });

  it("refuses an archive of more than 4 GB, without reading that much", async () => {
    class HugeBlob extends Blob {
      get size() {
        return 5 * 1024 ** 3;
      }
      async arrayBuffer() {
        return new ArrayBuffer(4);
      }
    }
    await expect(createZip([{ name: "huge.bin", data: new HugeBlob([]) }])).rejects.toThrow("The archive is larger than 4 GB, which this ZIP writer does not support.");
  });
});
