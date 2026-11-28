/**
 * A file that is written piece by piece into a Blob instead of one buffer in the page's memory: the video download (encode.ts) of
 * ten minutes can be most of a gigabyte. A Blob's bytes are kept by the browser outside the page's heap (Chrome moves large ones to
 * disk), and putting a piece at the end or over an earlier part makes a new Blob out of slices of the old one, without copying the
 * rest. The writer of the MP4 writes in order except for its index, which it puts into the room it kept at the start when it
 * finishes; the WebM writer goes back for its sizes and cues the same way.
 */
export class BlobFile {
  private file: Blob;

  constructor(private readonly type: string) {
    this.file = new Blob([], { type });
  }

  get size(): number {
    return this.file.size;
  }

  /** Puts `data` at byte `position`: at the end, past it (the gap is zeros), or over what is there. */
  write(data: Uint8Array, position: number): void {
    if (!Number.isSafeInteger(position) || position < 0) throw new RangeError(`cannot write at ${position}`);
    // the Blob constructor copies `data`, so a writer that reuses its buffer afterwards changes nothing here
    const piece = data as BlobPart;
    const size = this.file.size;
    if (position === size) this.file = new Blob([this.file, piece], { type: this.type });
    else if (position > size) this.file = new Blob([this.file, new Uint8Array(position - size), piece], { type: this.type });
    else {
      const end = position + data.byteLength;
      this.file = new Blob([this.file.slice(0, position), piece, ...(end < size ? [this.file.slice(end)] : [])], { type: this.type });
    }
  }

  /** The file as written so far. */
  blob(): Blob {
    return this.file;
  }
}

/** A stream that writes what Mediabunny's StreamTarget hands it into `file`. */
export function blobFileStream(file: BlobFile): WritableStream<{ type: "write"; data: Uint8Array; position: number }> {
  return new WritableStream({
    write(chunk) {
      file.write(chunk.data, chunk.position);
    },
  });
}
