/**
 * Puts the missing length into a recorded WebM.
 *
 * `MediaRecorder` streams its file: it cannot go back and write the duration once the recording is over, so the
 * Segment Info of a Chrome recording has no `Duration` element and a `<video>` reports `Infinity` for it (players
 * then cannot show a length or a seek bar). Everything needed is known here - the recording lasted as long as the
 * timeline - so the element is added to the Info block, which sits in the first few hundred bytes of the file. The
 * rest of the file is not read, parsed or copied.
 *
 * The patch is deliberately conservative: it only touches a file whose Info block has no Duration and which has no
 * SeekHead (whose byte offsets would be thrown off by the extra bytes); anything else is returned unchanged.
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;

const DEFAULT_TIMECODE_SCALE = 1_000_000; // nanoseconds per timecode tick: milliseconds

/** How many bytes from the start of the file are enough to find the Info block. */
export const WEBM_HEAD_BYTES = 8192;

interface Vint {
  /** the id (marker bit kept) or the size (marker removed) */
  value: number;
  length: number;
  /** a size whose data bits are all ones: "until the end of the parent" (live streams) */
  unknown: boolean;
}

function readId(bytes: Uint8Array, at: number): Vint | null {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  let length = 1;
  while (length <= 4 && !(first & (0x100 >> length))) length++;
  if (length > 4 || at + length > bytes.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length, unknown: false };
}

function readSize(bytes: Uint8Array, at: number): Vint | null {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  let length = 1;
  while (length <= 8 && !(first & (0x100 >> length))) length++;
  if (length > 8 || at + length > bytes.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

/** An EBML size: the value in the fewest bytes, but at least `minLength` of them. */
export function encodeEbmlSize(value: number, minLength = 1): Uint8Array {
  let length = Math.max(1, minLength);
  // the largest value a `length` byte size can hold is one less than all ones (all ones means "unknown")
  while (length < 8 && value >= 2 ** (7 * length) - 1) length++;
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function readUnsigned(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i];
  return value;
}

/** `Duration` element: id 0x4489, an 8 byte size, a big endian 64 bit float. */
function durationElement(ticks: number): Uint8Array {
  const out = new Uint8Array(11);
  out[0] = 0x44;
  out[1] = 0x89;
  out[2] = 0x88;
  new DataView(out.buffer).setFloat64(3, ticks, false);
  return out;
}

export interface WebmPatch {
  /** replaces the first `consumed` bytes of the file */
  patched: Uint8Array;
  consumed: number;
}

/**
 * The start of a WebM file with a `Duration` of `seconds` added to its Segment Info, or null when the file is
 * not one this can safely change (no Info block in `head`, it already has a duration, a SeekHead is present).
 * `head` needs to hold the file's first elements up to and including the Info block.
 */
export function patchWebmDuration(head: Uint8Array, seconds: number): WebmPatch | null {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return null;

  // EBML header
  const ebmlId = readId(head, 0);
  if (!ebmlId || ebmlId.value !== ID_EBML) return null;
  const ebmlSize = readSize(head, ebmlId.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  const segmentAt = ebmlId.length + ebmlSize.length + ebmlSize.value;

  // Segment header
  const segmentId = readId(head, segmentAt);
  if (!segmentId || segmentId.value !== ID_SEGMENT) return null;
  const segmentSize = readSize(head, segmentAt + segmentId.length);
  if (!segmentSize) return null;
  const segmentDataAt = segmentAt + segmentId.length + segmentSize.length;

  // children of the Segment, up to the Info block
  let at = segmentDataAt;
  for (;;) {
    const id = readId(head, at);
    if (!id) return null;
    const size = readSize(head, at + id.length);
    if (!size || size.unknown) return null;
    const dataAt = at + id.length + size.length;
    if (id.value === ID_SEEK_HEAD || id.value === ID_CLUSTER) return null;
    if (id.value !== ID_INFO) {
      at = dataAt + size.value;
      continue;
    }

    const infoEnd = dataAt + size.value;
    if (infoEnd > head.length) return null;
    let scale = DEFAULT_TIMECODE_SCALE;
    for (let c = dataAt; c < infoEnd;) {
      const childId = readId(head, c);
      const childSize = childId ? readSize(head, c + childId.length) : null;
      if (!childId || !childSize || childSize.unknown) return null;
      const childData = c + childId.length + childSize.length;
      if (childData + childSize.value > infoEnd) return null;
      if (childId.value === ID_DURATION) return null; // already has one
      if (childId.value === ID_TIMECODE_SCALE && childSize.length >= 1 && childSize.value <= 8) scale = readUnsigned(head, childData, childSize.value) || DEFAULT_TIMECODE_SCALE;
      c = childData + childSize.value;
    }

    const duration = durationElement((seconds * 1e9) / scale);
    const newInfoSize = encodeEbmlSize(size.value + duration.length, size.length);
    const infoHeader = new Uint8Array(id.length + newInfoSize.length);
    infoHeader.set(head.subarray(at, at + id.length));
    infoHeader.set(newInfoSize, id.length);
    const grew = infoHeader.length - (id.length + size.length) + duration.length;

    // the Segment grows by the same amount (unless it is a live stream of unknown length)
    let segmentHeader = head.subarray(segmentAt, segmentDataAt);
    if (!segmentSize.unknown) {
      const newSegmentSize = encodeEbmlSize(segmentSize.value + grew, segmentSize.length);
      segmentHeader = new Uint8Array(segmentId.length + newSegmentSize.length);
      segmentHeader.set(head.subarray(segmentAt, segmentAt + segmentId.length));
      segmentHeader.set(newSegmentSize, segmentId.length);
    }

    const parts = [head.subarray(0, segmentAt), segmentHeader, head.subarray(segmentDataAt, at), infoHeader, head.subarray(dataAt, infoEnd), duration];
    const patched = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      patched.set(p, o);
      o += p.length;
    }
    return { patched, consumed: infoEnd };
  }
}

/** The recording with its duration filled in; the same blob when it cannot be (or does not need to be) changed. */
export async function withWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
  try {
    const head = new Uint8Array(await blob.slice(0, WEBM_HEAD_BYTES).arrayBuffer());
    const patch = patchWebmDuration(head, seconds);
    if (!patch) return blob;
    return new Blob([patch.patched as BlobPart, blob.slice(patch.consumed)], { type: blob.type });
  } catch {
    return blob;
  }
}
