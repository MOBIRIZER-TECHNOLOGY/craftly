import { describe, expect, it } from "vitest";
import { encodeEbmlSize, patchWebmDuration, withWebmDuration } from "./webm";

/* A few bytes of EBML by hand: element = id + size + payload. */
const ID_EBML = [0x1a, 0x45, 0xdf, 0xa3];
const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67];
const ID_INFO = [0x15, 0x49, 0xa9, 0x66];
const ID_TIMECODE_SCALE = [0x2a, 0xd7, 0xb1];
const ID_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const bytes = (...parts: Array<number[] | Uint8Array>) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const element = (id: number[], payload: number[] = []) => [...id, ...Array.from(encodeEbmlSize(payload.length)), ...payload];
const ebmlHeader = () => element(ID_EBML, [0x42, 0x86, 0x81, 0x01]);
/** header + a Segment of known size holding `children` */
const file = (children: number[]) => bytes(ebmlHeader(), ID_SEGMENT, Array.from(encodeEbmlSize(children.length)), children);

describe("patchWebmDuration: what it will not touch", () => {
  const info = element(ID_INFO, element(ID_TIMECODE_SCALE, [0x0f, 0x42, 0x40]));

  it("patches the plain case, so the cases below fail for the reason they say", () => {
    expect(patchWebmDuration(file(info), 2)).not.toBeNull();
  });

  it("gives up on bytes that cannot start an element id", () => {
    expect(patchWebmDuration(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0), 2)).toBeNull();
    // an id of four bytes that is cut short
    expect(patchWebmDuration(Uint8Array.of(0x1a, 0x45), 2)).toBeNull();
    expect(patchWebmDuration(new Uint8Array(0), 2)).toBeNull();
  });

  it("gives up on an EBML header whose size is missing, cut short, impossible or unknown", () => {
    expect(patchWebmDuration(bytes(ID_EBML), 2)).toBeNull();
    expect(patchWebmDuration(bytes(ID_EBML, [0x00]), 2)).toBeNull();
    expect(patchWebmDuration(bytes(ID_EBML, [0x40]), 2)).toBeNull();
    expect(patchWebmDuration(bytes(ID_EBML, UNKNOWN_SIZE), 2)).toBeNull();
  });

  it("gives up when the Segment does not follow the header, or cannot be read", () => {
    expect(patchWebmDuration(bytes(ebmlHeader()), 2)).toBeNull();
    expect(patchWebmDuration(bytes(ebmlHeader(), ID_CLUSTER, [0x80]), 2)).toBeNull();
    // a Segment id with no size after it
    expect(patchWebmDuration(bytes(ebmlHeader(), ID_SEGMENT), 2)).toBeNull();
  });

  it("gives up when the head ends before the Info block", () => {
    expect(patchWebmDuration(bytes(ebmlHeader(), ID_SEGMENT, UNKNOWN_SIZE), 2)).toBeNull();
    // an element whose size is cut short, or unknown
    expect(patchWebmDuration(bytes(ebmlHeader(), ID_SEGMENT, UNKNOWN_SIZE, [0xec]), 2)).toBeNull();
    expect(patchWebmDuration(bytes(ebmlHeader(), ID_SEGMENT, UNKNOWN_SIZE, [0xec, 0xff]), 2)).toBeNull();
  });

  it("skips elements before the Info block, and stops at a cluster", () => {
    const void1 = element([0xec], [0, 0, 0]);
    expect(patchWebmDuration(file([...void1, ...info]), 2)).not.toBeNull();
    expect(patchWebmDuration(file([...void1, ...element(ID_CLUSTER), ...info]), 2)).toBeNull();
  });

  it("gives up when the Info block is not all in the head it was given", () => {
    const whole = file(info);
    expect(patchWebmDuration(whole.subarray(0, whole.length - 1), 2)).toBeNull();
  });

  it("gives up on an Info block whose own elements are cut short or unknown", () => {
    // an id with no size after it, at the very end of the head
    expect(patchWebmDuration(file(element(ID_INFO, [...ID_TIMECODE_SCALE])), 2)).toBeNull();
    // an element of unknown size
    expect(patchWebmDuration(file(element(ID_INFO, [...ID_TIMECODE_SCALE, 0xff])), 2)).toBeNull();
    // an element that claims more bytes than the Info block has
    expect(patchWebmDuration(file(element(ID_INFO, [0x44, 0x89, 0x88, 0x00])), 2)).toBeNull();
    // bytes in the Info block that are not an element at all
    expect(patchWebmDuration(file(element(ID_INFO, [0x00, 0x00])), 2)).toBeNull();
  });

  it("falls back on milliseconds when the timecode scale is not a small number", () => {
    // a scale field of nine bytes cannot be a number of ticks: it is ignored
    const odd = element(ID_INFO, [...ID_TIMECODE_SCALE.slice(0, 3), 0x89, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const patch = patchWebmDuration(file(odd), 2);
    expect(patch).not.toBeNull();
    const tail = patch!.patched.subarray(patch!.patched.length - 8);
    expect(new DataView(tail.buffer, tail.byteOffset, 8).getFloat64(0, false)).toBe(2000);
  });

  it("refuses a duration that is not a positive number of seconds", () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(patchWebmDuration(file(info), seconds)).toBeNull();
  });
});

describe("withWebmDuration: when the blob cannot be read", () => {
  it("hands the blob back as it was", async () => {
    const detached = {
      slice() {
        throw new Error("the blob was detached");
      },
    } as unknown as Blob;
    expect(await withWebmDuration(detached, 5)).toBe(detached);
  });
});
