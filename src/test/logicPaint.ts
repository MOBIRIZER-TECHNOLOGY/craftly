/**
 * Helpers for the painter tests of the non-UI code (src/render, src/export).
 *
 * `spyContext()` wraps the harness's recording canvas context (src/test/canvasMock.ts) and remembers, for every
 * call, the paint state at that moment (fill, stroke, alpha, shadow, font ...) and the current transform. A test can
 * then say "this text was filled in this colour, at this place on the canvas" instead of only "fillText was called".
 */
import { vi } from "vitest";
import type { MockContext2D } from "./canvasMock";

/** `[a, b, c, d, e, f]` of the 2D transform: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

export interface PaintState {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  filter: string;
  lineDash: number[];
  matrix: Matrix;
}

export interface PaintCall {
  name: string;
  args: unknown[];
  /** the context state when the call was made */
  state: PaintState;
}

export interface SpyContext {
  /** hand this to the painter */
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  /** the plain recording context underneath */
  base: MockContext2D;
  calls: PaintCall[];
  /** the calls to one method, in order */
  to(name: string): PaintCall[];
  /** the names of all calls, in order */
  names(): string[];
  /** forget the calls so far (the context state stays) */
  clear(): void;
  /** the current transform */
  matrix(): Matrix;
}

export interface SpyOptions {
  width?: number;
  height?: number;
  /** methods that do not exist on this context (`roundRect` on an old browser) */
  omit?: string[];
  /** methods that throw when called, to test a painter's error handling */
  failOn?: Record<string, Error>;
  /** values returned instead of what the recording context returns (`createPattern: null`) */
  returns?: Record<string, unknown>;
  /** watch an existing canvas and its plain recording context instead of making a new canvas (used by `captureContexts`) */
  canvas?: HTMLCanvasElement;
  base?: MockContext2D;
  /** called after every recorded call, before it runs: lets a test react to the painter (abort an export half way) */
  onCall?: (name: string, args: unknown[]) => void;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Methods that only read state: not worth recording. */
const QUIET = new Set(["measureText", "getTransform", "getLineDash", "isPointInPath", "isPointInStroke", "getContextAttributes", "callsTo", "reset", "createImageData"]);

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Where a point of the current coordinate system lands on the canvas (device pixels). */
export function toDevice(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function spyContext(opts: SpyOptions = {}): SpyContext {
  const canvas = opts.canvas ?? document.createElement("canvas");
  if (!opts.canvas) {
    canvas.width = opts.width ?? 400;
    canvas.height = opts.height ?? 300;
  }
  const base = opts.base ?? (canvas.getContext("2d") as unknown as MockContext2D);
  const calls: PaintCall[] = [];
  const omit = new Set(opts.omit ?? []);
  const failOn = opts.failOn ?? {};
  const returns = opts.returns ?? {};
  let matrix: Matrix = [...IDENTITY];
  const stack: Matrix[] = [];
  const baseAny = base as unknown as Record<string, unknown>;

  const snapshot = (): PaintState => ({
    fillStyle: baseAny.fillStyle,
    strokeStyle: baseAny.strokeStyle,
    lineWidth: baseAny.lineWidth as number,
    lineCap: baseAny.lineCap as string,
    lineJoin: baseAny.lineJoin as string,
    globalAlpha: baseAny.globalAlpha as number,
    globalCompositeOperation: baseAny.globalCompositeOperation as string,
    font: baseAny.font as string,
    textAlign: baseAny.textAlign as string,
    textBaseline: baseAny.textBaseline as string,
    letterSpacing: baseAny.letterSpacing as string,
    shadowColor: baseAny.shadowColor as string,
    shadowBlur: baseAny.shadowBlur as number,
    shadowOffsetX: baseAny.shadowOffsetX as number,
    shadowOffsetY: baseAny.shadowOffsetY as number,
    filter: baseAny.filter as string,
    lineDash: base.getLineDash(),
    matrix: [...matrix] as Matrix,
  });

  /** Methods that change the transform keep `matrix` current. */
  const track = (name: string, args: number[]): void => {
    switch (name) {
      case "save":
        stack.push([...matrix] as Matrix);
        break;
      case "restore":
        matrix = stack.pop() ?? [...IDENTITY];
        break;
      case "translate":
        matrix = multiply(matrix, [1, 0, 0, 1, args[0], args[1]]);
        break;
      case "scale":
        matrix = multiply(matrix, [args[0], 0, 0, args[1], 0, 0]);
        break;
      case "rotate": {
        const c = Math.cos(args[0]);
        const s = Math.sin(args[0]);
        matrix = multiply(matrix, [c, s, -s, c, 0, 0]);
        break;
      }
      case "transform":
        matrix = multiply(matrix, args as Matrix);
        break;
      case "setTransform":
        matrix = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case "resetTransform":
        matrix = [...IDENTITY];
        break;
    }
  };

  const ctx = new Proxy(baseAny, {
    get(target, prop) {
      if (typeof prop === "string" && omit.has(prop)) return undefined;
      if (prop === "getTransform") {
        return () => ({ a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5], is2D: true, isIdentity: false });
      }
      const value = Reflect.get(target, prop);
      // quiet methods are only watched (and only then recorded) when a test asked to change what they do
      if (typeof prop !== "string" || typeof value !== "function" || (QUIET.has(prop) && !(prop in returns) && !(prop in failOn))) return value;
      return (...args: unknown[]) => {
        calls.push({ name: prop, args, state: snapshot() });
        track(prop, args as number[]);
        opts.onCall?.(prop, args);
        const failure = failOn[prop];
        if (failure) throw failure;
        if (prop in returns) return returns[prop];
        const result = (value as (...a: unknown[]) => unknown)(...args);
        if (prop === "createPattern" && result && typeof result === "object") {
          // a pattern remembers the tile and the transforms it was given, so a test can look at them
          const pattern = result as { image?: unknown; repetition?: unknown; transforms?: unknown[]; setTransform?: (m: unknown) => void };
          pattern.image = args[0];
          pattern.repetition = args[1];
          pattern.transforms = [];
          pattern.setTransform = (m: unknown) => {
            pattern.transforms?.push(m);
          };
        }
        return result;
      };
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
    has(target, prop) {
      return prop in target;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    canvas,
    base,
    calls,
    to: (name) => calls.filter((c) => c.name === name),
    names: () => calls.map((c) => c.name),
    clear: () => {
      calls.length = 0;
    },
    matrix: () => [...matrix] as Matrix,
  };
}

/**
 * Make every canvas that asks for a 2D context from now on get a fresh spy, so a painter that makes its own canvases
 * (pattern tiles, filtered copies) can be watched. Returns the spies in creation order; undone by `vi.restoreAllMocks()`.
 */
export function captureContexts(opts: SpyOptions = {}): SpyContext[] {
  const made: SpyContext[] = [];
  const owners = new Map<HTMLCanvasElement, SpyContext>();
  // capturing twice in one test: start again from the harness's own getContext
  const current = HTMLCanvasElement.prototype.getContext as unknown;
  if (vi.isMockFunction(current)) current.mockRestore();
  const original = HTMLCanvasElement.prototype.getContext as unknown as (this: HTMLCanvasElement, type: string) => unknown;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
    let spy = owners.get(this);
    if (!spy) {
      const base = original.call(this, type) as MockContext2D | null;
      if (!base) return null as never;
      spy = spyContext({ ...opts, canvas: this, base });
      owners.set(this, spy);
      made.push(spy);
    }
    return spy.ctx as never;
  } as never);
  return made;
}

/** A pattern as `spyContext` hands it out. */
export interface SpyPattern {
  image: HTMLCanvasElement;
  repetition: string;
  transforms: Array<{ scaleBy: number }>;
}

/**
 * jsdom has no `DOMMatrix`; the pattern painter needs one. This one only remembers the factor it was scaled by.
 * Returns the function that puts the previous state back.
 */
export function stubDomMatrix(): () => void {
  class FakeMatrix {
    scaleBy = 1;
    scale(k: number): this {
      this.scaleBy = k;
      return this;
    }
  }
  vi.stubGlobal("DOMMatrix", FakeMatrix);
  return () => {
    vi.unstubAllGlobals();
  };
}
