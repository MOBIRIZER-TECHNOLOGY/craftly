import { afterEach, describe, expect, it, vi } from "vitest";
import { blobToDataUrl, bytesToBase64 } from "./encoding";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("blobToDataUrl", () => {
  it("reads a blob into a data address with its type", async () => {
    expect(await blobToDataUrl(new Blob(["hi"], { type: "text/plain" }))).toBe("data:text/plain;base64,aGk=");
  });

  it("reads an empty blob", async () => {
    expect(await blobToDataUrl(new Blob([], { type: "image/png" }))).toBe("data:image/png;base64,");
  });

  it("reads binary data without damaging it", async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_v, i) => i);
    const url = await blobToDataUrl(new Blob([bytes], { type: "application/octet-stream" }));
    const back = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("passes on the reason when the file cannot be read", async () => {
    const reason = new Error("disk unplugged");
    vi.stubGlobal(
      "FileReader",
      class {
        error = reason;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toBe(reason);
  });

  it("has a message of its own when no reason is given", async () => {
    vi.stubGlobal(
      "FileReader",
      class {
        error = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toThrow("Could not read an image.");
  });
});

describe("bytesToBase64", () => {
  it("encodes small arrays like btoa does", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(bytesToBase64(Uint8Array.of(72, 105))).toBe("SGk=");
    expect(bytesToBase64(Uint8Array.of(0, 255, 128))).toBe("AP+A");
  });

  it("encodes arrays larger than one step without running out of arguments", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 3 + 17 }, (_v, i) => (i * 31 + 7) & 255);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes a view into a larger buffer", () => {
    const backing = Uint8Array.from({ length: 100 }, (_v, i) => i);
    expect(bytesToBase64(backing.subarray(10, 13))).toBe(Buffer.from([10, 11, 12]).toString("base64"));
  });
});
