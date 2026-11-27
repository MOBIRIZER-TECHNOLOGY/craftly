import { describe, expect, it } from "vitest";
import { BlobFile, blobFileStream } from "./blobFile";

const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];

describe("a file written piece by piece into a Blob", () => {
  it("adds pieces at the end, in order, with its type", async () => {
    const file = new BlobFile("video/mp4");
    file.write(Uint8Array.of(1, 2, 3), 0);
    file.write(Uint8Array.of(4, 5), 3);
    expect(file.size).toBe(5);
    expect(file.blob().type).toBe("video/mp4");
    expect(await bytes(file.blob())).toEqual([1, 2, 3, 4, 5]);
  });

  it("writes over an earlier part, as an MP4's index goes into the room kept for it, and keeps what is after it", async () => {
    const file = new BlobFile("video/mp4");
    file.write(new Uint8Array(10), 0);
    file.write(Uint8Array.of(9, 9, 9), 10);
    file.write(Uint8Array.of(7, 7), 2);
    expect(await bytes(file.blob())).toEqual([0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 9, 9, 9]);
    // over the end: what is past the old end is added
    file.write(Uint8Array.of(5, 5, 5), 11);
    expect(await bytes(file.blob())).toEqual([0, 0, 7, 7, 0, 0, 0, 0, 0, 0, 9, 5, 5, 5]);
  });

  it("fills a gap with zeros, and refuses a place that is no place", async () => {
    const file = new BlobFile("video/webm");
    file.write(Uint8Array.of(1), 3);
    expect(await bytes(file.blob())).toEqual([0, 0, 0, 1]);
    expect(() => file.write(Uint8Array.of(1), -1)).toThrow(RangeError);
    expect(() => file.write(Uint8Array.of(1), 0.5)).toThrow(RangeError);
  });

  it("keeps a copy of each piece: a writer that reuses its buffer afterwards changes nothing", async () => {
    const file = new BlobFile("video/mp4");
    const buffer = Uint8Array.of(1, 2);
    file.write(buffer, 0);
    buffer.fill(0);
    expect(await bytes(file.blob())).toEqual([1, 2]);
  });

  it("takes what a stream is given", async () => {
    const file = new BlobFile("video/mp4");
    const writer = blobFileStream(file).getWriter();
    await writer.write({ type: "write", data: Uint8Array.of(1, 2), position: 0 });
    await writer.write({ type: "write", data: Uint8Array.of(3), position: 2 });
    await writer.close();
    expect(await bytes(file.blob())).toEqual([1, 2, 3]);
  });
});
