/**
 * A 2D canvas context for tests. jsdom has no canvas, so `getContext("2d")` would return null and nothing could be
 * painted. This one records every call (for assertions) and keeps just enough state for the painter: text is measured
 * with the same estimate the node tests use, gradients remember their stops and `getImageData` returns blank pixels.
 */

export interface RecordedCall {
  name: string;
  args: unknown[];
}

export interface MockGradient {
  kind: "linear" | "radial" | "conic";
  args: number[];
  stops: Array<{ offset: number; color: string }>;
  addColorStop(offset: number, color: string): void;
}

const fontSize = (font: string) => {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : 10;
};

/** Properties the painter reads back, with the canvas defaults. */
const DEFAULTS: Record<string, unknown> = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "ltr",
  letterSpacing: "0px",
  wordSpacing: "0px",
  fontKerning: "auto",
  fontStretch: "normal",
  fontVariantCaps: "normal",
  textRendering: "auto",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: "none",
};

export interface MockContext2D extends CanvasRenderingContext2D {
  /** Every method call since creation (property assignments are not recorded). */
  readonly calls: RecordedCall[];
  /** The calls to one method, in order. */
  callsTo(name: string): unknown[][];
  /** Forget what was recorded so far. */
  reset(): void;
}

/** Build a recording context for `canvas`. Unknown methods are recorded no-ops, so new painter calls never crash a test. */
export function createMockContext(canvas?: HTMLCanvasElement): MockContext2D {
  const calls: RecordedCall[] = [];
  const state: Record<string, unknown> = { ...DEFAULTS };
  const stack: Array<Record<string, unknown>> = [];
  let lineDash: number[] = [];

  const record = (name: string, args: unknown[]) => {
    calls.push({ name, args });
  };

  const own: Record<string, unknown> = {
    canvas,
    calls,
    callsTo: (name: string) => calls.filter((c) => c.name === name).map((c) => c.args),
    reset: () => {
      calls.length = 0;
    },
    save: () => {
      record("save", []);
      stack.push({ ...state });
    },
    restore: () => {
      record("restore", []);
      const top = stack.pop();
      if (top) Object.assign(state, top);
    },
    measureText: (text: string) => {
      const size = fontSize(String(state.font));
      const width = String(text).length * size * 0.55;
      return {
        width,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
        fontBoundingBoxAscent: size * 0.95,
        fontBoundingBoxDescent: size * 0.25,
        emHeightAscent: size * 0.8,
        emHeightDescent: size * 0.2,
        hangingBaseline: size * 0.8,
        alphabeticBaseline: 0,
        ideographicBaseline: -size * 0.2,
      } satisfies Partial<TextMetrics>;
    },
    setLineDash: (segments: number[]) => {
      record("setLineDash", [segments]);
      lineDash = [...segments];
    },
    getLineDash: () => [...lineDash],
    createLinearGradient: (...args: number[]) => makeGradient("linear", args, record),
    createRadialGradient: (...args: number[]) => makeGradient("radial", args, record),
    createConicGradient: (...args: number[]) => makeGradient("conic", args, record),
    createPattern: (...args: unknown[]) => {
      record("createPattern", args);
      return { setTransform: () => undefined };
    },
    createImageData: (w: number | { width: number; height: number }, h?: number) => {
      const width = typeof w === "number" ? w : w.width;
      const height = typeof w === "number" ? (h ?? 1) : w.height;
      return blankImage(width, height);
    },
    getImageData: (x: number, y: number, w: number, h: number) => {
      record("getImageData", [x, y, w, h]);
      return blankImage(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
    },
    getTransform: () => new MockMatrix(),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getContextAttributes: () => ({ alpha: true, desynchronized: false, colorSpace: "srgb", willReadFrequently: false }),
  };

  return new Proxy(own, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop in state) return state[prop];
      // any other method of the 2D API: record it and do nothing
      return (...args: unknown[]) => {
        record(prop, args);
      };
    },
    set(target, prop: string, value) {
      if (prop in target) target[prop] = value;
      else state[prop] = value;
      return true;
    },
    has: (target, prop: string) => prop in target || prop in state,
  }) as unknown as MockContext2D;
}

function makeGradient(kind: MockGradient["kind"], args: number[], record: (name: string, args: unknown[]) => void): MockGradient {
  record(`create${kind[0].toUpperCase()}${kind.slice(1)}Gradient`, args);
  const g: MockGradient = {
    kind,
    args,
    stops: [],
    addColorStop(offset, color) {
      g.stops.push({ offset, color });
    },
  };
  return g;
}

function blankImage(width: number, height: number) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: "srgb" };
}

/** The identity transform, enough for code that reads `ctx.getTransform()`. */
class MockMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;
  isIdentity = true;
  inverse() {
    return this;
  }
  multiply() {
    return this;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
}

/** The context created for each canvas, so a test can inspect what a component painted. */
const contexts = new WeakMap<HTMLCanvasElement, MockContext2D>();

export function contextOf(canvas: HTMLCanvasElement): MockContext2D | undefined {
  return contexts.get(canvas);
}

/** `Path2D` for environments that have none: it only remembers the SVG path data (or the path it was copied from). */
export class MockPath2D {
  readonly data: string;
  constructor(init?: string | MockPath2D) {
    this.data = typeof init === "string" ? init : (init?.data ?? "");
  }
  addPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  arcTo(): void {}
  ellipse(): void {}
  rect(): void {}
  roundRect(): void {}
}

/**
 * Make `canvas.getContext("2d")`, `toDataURL`, `toBlob` and `Path2D` work in jsdom. Returns a function that undoes the patch.
 */
export function installCanvasMock(): () => void {
  if (typeof Path2D === "undefined") (globalThis as unknown as { Path2D: unknown }).Path2D = MockPath2D;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const saved = { getContext: proto.getContext, toDataURL: proto.toDataURL, toBlob: proto.toBlob };

  proto.getContext = function getContext(this: HTMLCanvasElement, type: string) {
    if (type !== "2d") return null;
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = createMockContext(this);
      contexts.set(this, ctx);
    }
    return ctx;
  };
  proto.toDataURL = function toDataURL(this: HTMLCanvasElement, type = "image/png") {
    return `data:${type};base64,AAAA`;
  };
  proto.toBlob = function toBlob(this: HTMLCanvasElement, callback: BlobCallback, type = "image/png") {
    queueMicrotask(() => callback(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type })));
  };

  return () => {
    Object.assign(proto, saved);
  };
}
