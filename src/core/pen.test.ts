import { describe, expect, it } from "vitest";
import {
  bezierBounds,
  bezierPoint,
  closePath,
  deleteNodes,
  denormalizePath,
  fitPaths,
  inBoxSpace,
  insertNode,
  moveHandle,
  moveNodes,
  nearestOnPath,
  nodeKindOf,
  normalizePath,
  parsePath,
  pathBounds,
  pathToString,
  segmentsOf,
  setNodeKind,
  splitBezier,
  type PenNode,
  type PenPath,
} from "./pen";
import type { Point } from "./types";

const node = (x: number, y: number, handleIn: Point | null = null, handleOut: Point | null = null): PenNode => ({ x, y, handleIn, handleOut });
const open = (...nodes: PenNode[]): PenPath => ({ nodes, closed: false });
const closed = (...nodes: PenNode[]): PenPath => ({ nodes, closed: true });
const near = (a: Point, b: Point, digits = 3) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe("pathToString", () => {
  it("writes straight sides as L and curved sides as C, in absolute numbers", () => {
    expect(pathToString(open(node(0, 0), node(100, 0), node(100, 100)))).toBe("M0 0 L100 0 L100 100");
    expect(pathToString(open(node(0, 0, null, { x: 10, y: 0 }), node(100, 100, { x: -10, y: 0 }, null)))).toBe("M0 0 C10 0 90 100 100 100");
  });

  it("uses the anchor itself for the handle a curved side lacks", () => {
    expect(pathToString(open(node(0, 0, null, { x: 10, y: 0 }), node(100, 100)))).toBe("M0 0 C10 0 100 100 100 100");
    expect(pathToString(open(node(0, 0), node(100, 100, { x: -10, y: 0 }, null)))).toBe("M0 0 C0 0 90 100 100 100");
  });

  it("closes a path with the side back to the first node, then Z", () => {
    expect(pathToString(closed(node(0, 0), node(100, 0), node(100, 100)))).toBe("M0 0 L100 0 L100 100 L0 0 Z");
    expect(pathToString(closed(node(0, 0, { x: -5, y: 0 }, null), node(100, 0), node(100, 100)))).toBe("M0 0 L100 0 L100 100 C100 100 -5 0 0 0 Z");
  });

  it("writes at most three decimals, never an exponent or a minus zero", () => {
    expect(pathToString(open(node(0.12345, -0.0004), node(1e-9, 12.5)))).toBe("M0.123 0 L0 12.5");
    expect(pathToString(open(node(0, 0), node(123456.7891, -3.0004)))).toBe("M0 0 L123456.789 -3");
  });

  it("writes a single node as a move", () => {
    expect(pathToString(open(node(5, 6)))).toBe("M5 6");
  });

  it("writes nothing for a path without nodes", () => {
    expect(pathToString(open())).toBe("");
  });
});

describe("parsePath", () => {
  it("reads lines", () => {
    expect(parsePath("M0 0 L100 0 L100 100")).toEqual(open(node(0, 0), node(100, 0), node(100, 100)));
    expect(parsePath("M0 0 H100 V50")).toEqual(open(node(0, 0), node(100, 0), node(100, 50)));
  });

  it("reads cubic curves into handles on both anchors", () => {
    expect(parsePath("M0 0 C10 0 90 100 100 100")).toEqual(open(node(0, 0, null, { x: 10, y: 0 }), node(100, 100, { x: -10, y: 0 }, null)));
  });

  it("turns a quadratic curve into the cubic that draws the same line", () => {
    const path = parsePath("M0 0 Q50 100 100 0")!;
    near(path.nodes[0].handleOut!, { x: 100 / 3, y: 200 / 3 });
    near(path.nodes[1].handleIn!, { x: -100 / 3, y: 200 / 3 });
    const [segment] = segmentsOf(path);
    near(bezierPoint(segment, 0.5), { x: 50, y: 50 }); // the quadratic's middle: (0 + 2 * 50 + 100) / 4, (0 + 2 * 100 + 0) / 4
  });

  it("reads a path that comes back to its start as closed, with that node once", () => {
    expect(parsePath("M0 0 L100 0 L100 100 L0 0 Z")).toEqual(closed(node(0, 0), node(100, 0), node(100, 100)));
    expect(parsePath("M0 0 L100 0 L100 100 Z")).toEqual(closed(node(0, 0), node(100, 0), node(100, 100)));
  });

  it("gives the first node the handle that the closing curve arrives with", () => {
    const path = parsePath("M0 0 C10 0 90 0 100 0 C100 50 50 100 0 0 Z")!;
    expect(path.closed).toBe(true);
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0]).toEqual(node(0, 0, { x: 50, y: 100 }, { x: 10, y: 0 }));
    expect(path.nodes[1]).toEqual(node(100, 0, { x: -10, y: 0 }, { x: 0, y: 50 }));
  });

  it("repeats a command for the numbers that follow, and takes a move's extra pairs as lines", () => {
    expect(parsePath("M0 0 L10 10 20 20")!.nodes).toHaveLength(3);
    expect(parsePath("M0 0 10 10")!.nodes).toEqual([node(0, 0), node(10, 10)]);
  });

  it("reads numbers the way the scaler does: commas, signs that start a number, a bare point", () => {
    expect(parsePath("M0,0L10-5")).toEqual(open(node(0, 0), node(10, -5)));
    expect(parsePath("M.5 .5 L1e1 5")).toEqual(open(node(0.5, 0.5), node(10, 5)));
  });

  it("reads what the freehand tool writes", () => {
    const path = parsePath("M0.00 0.00Q10.00 5.00 20.00 10.00Q30.00 15.00 40.00 10.00L50.00 0.00")!;
    expect(path.closed).toBe(false);
    expect(path.nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [20, 10],
      [40, 10],
      [50, 0],
    ]);
  });

  it.each([
    ["nothing", ""],
    ["not a path", "hello"],
    ["a single point", "M0 0"],
    ["an arc", "M0 0 A5 5 0 0 1 10 10"],
    ["relative commands", "m0 0 l10 10"],
    ["a second subpath", "M0 0 L10 10 M20 20 L30 30"],
    ["a command with no numbers", "M0 0 L"],
    ["a side before the move", "L10 10 L20 20"],
  ])("does not read %s", (_name, d) => {
    expect(parsePath(d)).toBeNull();
  });

  it("reads back what pathToString wrote", () => {
    const paths = [
      open(node(0, 0), node(10.5, 20.25), node(-3, 7)),
      closed(node(0, 0, { x: -4, y: 2 }, { x: 4, y: -2 }), node(100, 20, null, { x: 0, y: 15 }), node(60, 90, { x: 12, y: 0 }, null)),
      open(node(1, 1, null, { x: 2, y: 3 }), node(5, 5, { x: -2, y: -3 }, { x: 2.5, y: 0.5 }), node(9, 9, { x: -1, y: 1 }, null)),
    ];
    for (const path of paths) expect(parsePath(pathToString(path))).toEqual(path);
  });
});

describe("bezier curves", () => {
  const arch = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
  ] as const;

  it("start and end where the anchors are, and bend towards the handles", () => {
    near(bezierPoint(arch, 0), { x: 0, y: 0 });
    near(bezierPoint(arch, 1), { x: 100, y: 0 });
    near(bezierPoint(arch, 0.5), { x: 50, y: 75 });
  });

  it("split into two curves that meet at the point, and draw the same line", () => {
    const [left, right] = splitBezier(arch, 0.5);
    expect(left).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 25, y: 75 },
      { x: 50, y: 75 },
    ]);
    expect(right).toEqual([
      { x: 50, y: 75 },
      { x: 75, y: 75 },
      { x: 100, y: 50 },
      { x: 100, y: 0 },
    ]);
    near(bezierPoint(left, 0.5), bezierPoint(arch, 0.25));
    near(bezierPoint(right, 0.5), bezierPoint(arch, 0.75));
  });

  it("are bounded by the curve, not by its handles", () => {
    expect(bezierBounds(arch)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
    const loop = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ] as const;
    expect(bezierBounds(loop)).toEqual({ x: 0, y: 0, w: 75, h: 100 });
  });

  it("have bounds that hold every point of the curve, and touch it", () => {
    const curves = [
      [
        { x: 10, y: 80 },
        { x: -40, y: 10 },
        { x: 140, y: 30 },
        { x: 60, y: -20 },
      ],
      [
        { x: 0, y: 0 },
        { x: 300, y: 50 },
        { x: -200, y: 60 },
        { x: 50, y: 5 },
      ],
    ] as const;
    for (const curve of curves) {
      const b = bezierBounds(curve);
      const points = Array.from({ length: 2001 }, (_unused, i) => bezierPoint(curve, i / 2000));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      expect(b.x).toBeLessThanOrEqual(Math.min(...xs) + 1e-6);
      expect(b.y).toBeLessThanOrEqual(Math.min(...ys) + 1e-6);
      expect(b.x + b.w).toBeGreaterThanOrEqual(Math.max(...xs) - 1e-6);
      expect(b.y + b.h).toBeGreaterThanOrEqual(Math.max(...ys) - 1e-6);
      // tight: within a hair of the sampled extremes
      expect(Math.min(...xs) - b.x).toBeLessThan(0.05);
      expect(Math.min(...ys) - b.y).toBeLessThan(0.05);
      expect(b.x + b.w - Math.max(...xs)).toBeLessThan(0.05);
      expect(b.y + b.h - Math.max(...ys)).toBeLessThan(0.05);
    }
  });

  it("have a point for a curve that does not move", () => {
    const dot = [
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 4 },
    ] as const;
    expect(bezierBounds(dot)).toEqual({ x: 3, y: 4, w: 0, h: 0 });
  });
});

describe("pathBounds and segmentsOf", () => {
  it("bound straight sides by their anchors", () => {
    expect(pathBounds(open(node(10, 20), node(30, 5), node(0, 40)))).toEqual({ x: 0, y: 5, w: 30, h: 35 });
  });

  it("bound curved sides by the curve", () => {
    expect(pathBounds(open(node(0, 0, null, { x: 0, y: 100 }), node(100, 0, { x: 0, y: 100 }, null)))).toEqual({ x: 0, y: 0, w: 100, h: 75 });
  });

  it("bound a single node by that point, and no nodes by the origin", () => {
    expect(pathBounds(open(node(7, 9)))).toEqual({ x: 7, y: 9, w: 0, h: 0 });
    expect(pathBounds(open())).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("list one side for each pair of anchors, and the closing side of a closed path", () => {
    expect(segmentsOf(open(node(0, 0), node(1, 1), node(2, 2)))).toHaveLength(2);
    expect(segmentsOf(closed(node(0, 0), node(1, 1), node(2, 2)))).toHaveLength(3);
    expect(segmentsOf(open(node(0, 0)))).toHaveLength(0);
  });

  it("give the control points as absolute positions", () => {
    const [segment] = segmentsOf(open(node(10, 10, null, { x: 5, y: 0 }), node(50, 10, { x: -5, y: 5 }, null)));
    expect(segment).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 10 },
      { x: 45, y: 15 },
      { x: 50, y: 10 },
    ]);
  });
});

describe("nearestOnPath", () => {
  it("finds the closest point of a straight side", () => {
    const hit = nearestOnPath(open(node(0, 0), node(100, 0)), { x: 30, y: 5 }, 10)!;
    expect(hit.segment).toBe(0);
    expect(hit.t).toBeCloseTo(0.3, 3);
    near(hit.point, { x: 30, y: 0 });
    expect(hit.distance).toBeCloseTo(5, 3);
  });

  it("finds nothing farther than the distance it was given", () => {
    expect(nearestOnPath(open(node(0, 0), node(100, 0)), { x: 30, y: 50 }, 10)).toBeNull();
  });

  it("finds the start of a side that has no length", () => {
    const hit = nearestOnPath(open(node(10, 10), node(10, 10)), { x: 13, y: 14 }, 10)!;
    expect(hit.t).toBe(0);
    near(hit.point, { x: 10, y: 10 });
    expect(hit.distance).toBeCloseTo(5, 6);
  });

  it("picks the closer of two sides that are both in reach, and the first when they are as close", () => {
    const corner = open(node(0, 0), node(100, 0), node(100, 100));
    // 6.7 from the first side, 3 from the second
    expect(nearestOnPath(corner, { x: 103, y: 6 }, 10)!.segment).toBe(1);
    // 3 from the first side, 5 from the second
    expect(nearestOnPath(corner, { x: 95, y: 3 }, 10)!.segment).toBe(0);
    // 3 from each
    expect(nearestOnPath(corner, { x: 97, y: 3 }, 10)!.segment).toBe(0);
  });

  it("finds the closest point of a curve", () => {
    const path = open(node(0, 0, null, { x: 0, y: 100 }), node(100, 0, { x: 0, y: 100 }, null));
    const hit = nearestOnPath(path, { x: 50, y: 80 }, 20)!;
    near(hit.point, { x: 50, y: 75 }, 1);
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.distance).toBeCloseTo(5, 0);
  });

  it("looks at every side, the closing one included, and picks the closest", () => {
    const triangle = closed(node(0, 0), node(100, 0), node(100, 100));
    expect(nearestOnPath(triangle, { x: 50, y: 52 }, 10)!.segment).toBe(2);
    expect(nearestOnPath(triangle, { x: 98, y: 50 }, 10)!.segment).toBe(1);
    expect(nearestOnPath(triangle, { x: 50, y: -3 }, 10)!.segment).toBe(0);
  });
});

describe("moveNodes", () => {
  it("moves the anchors and keeps the handles where they are relative to them", () => {
    const path = open(node(0, 0, null, { x: 10, y: 0 }), node(100, 0, { x: -10, y: 0 }, null), node(100, 100));
    const moved = moveNodes(path, [1, 2], 5, -5);
    expect(moved.nodes[0]).toEqual(path.nodes[0]);
    expect(moved.nodes[1]).toEqual(node(105, -5, { x: -10, y: 0 }, null));
    expect(moved.nodes[2]).toEqual(node(105, 95));
    expect(path.nodes[1].x).toBe(100); // the original is not touched
  });
});

describe("moveHandle", () => {
  it("moves one handle of a corner node and leaves the other", () => {
    const corner = open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 0, y: 10 }), node(100, 0));
    const moved = moveHandle(corner, 1, "out", { x: 70, y: 50 });
    expect(moved.nodes[1].handleOut).toEqual({ x: 20, y: 0 });
    expect(moved.nodes[1].handleIn).toEqual({ x: -10, y: 0 });
  });

  it("turns the opposite handle of a smooth node with it, keeping its length", () => {
    const smooth = open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 10, y: 0 }), node(100, 0));
    const moved = moveHandle(smooth, 1, "out", { x: 50, y: 70 });
    expect(moved.nodes[1].handleOut).toEqual({ x: 0, y: 20 });
    near(moved.nodes[1].handleIn!, { x: 0, y: -10 });
  });

  it("makes the opposite handle as long when the nodes are mirrored", () => {
    const smooth = open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 10, y: 0 }), node(100, 0));
    const moved = moveHandle(smooth, 1, "in", { x: 50, y: 30 }, { mirror: true });
    expect(moved.nodes[1].handleIn).toEqual({ x: 0, y: -20 });
    near(moved.nodes[1].handleOut!, { x: 0, y: 20 });
  });

  it("leaves the opposite handle alone when asked to break the symmetry", () => {
    const smooth = open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 10, y: 0 }), node(100, 0));
    const moved = moveHandle(smooth, 1, "out", { x: 50, y: 70 }, { breakSymmetry: true });
    expect(moved.nodes[1].handleIn).toEqual({ x: -10, y: 0 });
    expect(nodeKindOf(moved, 1)).toBe("corner");
  });

  it("takes a handle away when it is pulled back onto its anchor", () => {
    const corner = open(node(0, 0), node(50, 50, null, { x: 10, y: 0 }), node(100, 0));
    expect(moveHandle(corner, 1, "out", { x: 50.2, y: 50.1 }).nodes[1].handleOut).toBeNull();
  });

  it("makes a handle where there was none", () => {
    const plain = open(node(0, 0), node(50, 50), node(100, 0));
    expect(moveHandle(plain, 1, "out", { x: 60, y: 50 }).nodes[1].handleOut).toEqual({ x: 10, y: 0 });
  });

  it("changes nothing for a node that is not there", () => {
    const path = open(node(0, 0), node(50, 50));
    expect(moveHandle(path, 5, "out", { x: 60, y: 50 })).toBe(path);
  });
});

describe("insertNode", () => {
  it("splits a curved side without changing its shape", () => {
    const path = open(node(0, 0, null, { x: 0, y: 100 }), node(100, 0, { x: 0, y: 100 }, null));
    const split = insertNode(path, 0, 0.5);
    expect(split.nodes).toHaveLength(3);
    expect(split.nodes[1]).toEqual(node(50, 75, { x: -25, y: 0 }, { x: 25, y: 0 }));
    expect(split.nodes[0].handleOut).toEqual({ x: 0, y: 50 });
    expect(split.nodes[2].handleIn).toEqual({ x: 0, y: 50 });
    expect(nodeKindOf(split, 1)).toBe("smooth");
    const [original] = segmentsOf(path);
    const [first, second] = segmentsOf(split);
    near(bezierPoint(first, 0.4), bezierPoint(original, 0.2));
    near(bezierPoint(second, 0.6), bezierPoint(original, 0.8));
  });

  it("splits a straight side into two straight sides", () => {
    const split = insertNode(open(node(0, 0), node(100, 0)), 0, 0.25);
    expect(split.nodes).toEqual([node(0, 0), node(25, 0), node(100, 0)]);
  });

  it("puts the node after the last one when it is the closing side that is split", () => {
    const split = insertNode(closed(node(0, 0), node(100, 0), node(100, 100)), 2, 0.5);
    expect(split.nodes).toHaveLength(4);
    expect(split.nodes[3]).toEqual(node(50, 50));
    expect(split.closed).toBe(true);
  });

  it("changes nothing for a side that is not there", () => {
    const path = open(node(0, 0), node(100, 0));
    expect(insertNode(path, 3, 0.5)).toBe(path);
    expect(insertNode(path, 1, 0.5)).toBe(path); // an open path has no closing side
  });
});

describe("deleteNodes", () => {
  const line = open(node(0, 0), node(10, 0), node(20, 0, null, { x: 5, y: 5 }), node(40, 10, { x: -5, y: 0 }, null));

  it("joins the neighbours of a node that is removed and keeps their own handles", () => {
    const result = deleteNodes(line, [1])!;
    expect(result.nodes).toEqual([node(0, 0), node(20, 0, null, { x: 5, y: 5 }), node(40, 10, { x: -5, y: 0 })]);
  });

  it("removes several nodes, an end node included", () => {
    expect(deleteNodes(line, [0, 3])!.nodes).toEqual([node(10, 0), node(20, 0, null, { x: 5, y: 5 })]);
  });

  it("leaves nothing when fewer than two nodes would remain", () => {
    expect(deleteNodes(line, [0, 1, 2])).toBeNull();
    expect(deleteNodes(line, [0, 1, 2, 3])).toBeNull();
  });

  it("keeps a closed path closed", () => {
    const result = deleteNodes(closed(node(0, 0), node(10, 0), node(10, 10), node(0, 10)), [2])!;
    expect(result.closed).toBe(true);
    expect(result.nodes).toHaveLength(3);
  });

  it("ignores an index that is not a node", () => {
    expect(deleteNodes(line, [9, -1])!.nodes).toHaveLength(4);
  });
});

describe("node kinds", () => {
  const corner = open(node(0, 0), node(100, 0), node(100, 100));

  it("tells a corner from a smooth point", () => {
    expect(nodeKindOf(corner, 1)).toBe("corner");
    expect(nodeKindOf(open(node(0, 0), node(50, 50, { x: -10, y: 5 }, { x: 10, y: -5 }), node(100, 0)), 1)).toBe("smooth");
    expect(nodeKindOf(open(node(0, 0), node(50, 50, { x: -10, y: 5 }, { x: 10, y: 5 }), node(100, 0)), 1)).toBe("corner");
    expect(nodeKindOf(open(node(0, 0), node(50, 50, null, { x: 10, y: 0 }), node(100, 0)), 1)).toBe("corner");
  });

  it("takes handles that are within half a degree of one line for a smooth point, and handles that are further off for a corner", () => {
    // the in handle is (-10, 0); the out handle is turned `off` degrees from straight opposite it
    const handlesOff = (off: number) => {
      const turned = (off * Math.PI) / 180;
      return open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 10 * Math.cos(turned), y: 10 * Math.sin(turned) }), node(100, 0));
    };
    expect(nodeKindOf(handlesOff(0), 1)).toBe("smooth");
    expect(nodeKindOf(handlesOff(0.3), 1)).toBe("smooth");
    expect(nodeKindOf(handlesOff(2), 1)).toBe("corner");
    expect(nodeKindOf(handlesOff(45), 1)).toBe("corner");
  });

  it("makes a point smooth with handles along the line between its neighbours, a third of the way to each", () => {
    const smooth = setNodeKind(corner, 1, "smooth");
    const handleOut = smooth.nodes[1].handleOut!;
    const handleIn = smooth.nodes[1].handleIn!;
    // the line from the previous node (0, 0) to the next one (100, 100) runs diagonally; each neighbour is 100 away
    const unit = { x: 1 / Math.SQRT2, y: 1 / Math.SQRT2 };
    near(handleOut, { x: (unit.x * 100) / 3, y: (unit.y * 100) / 3 });
    near(handleIn, { x: (-unit.x * 100) / 3, y: (-unit.y * 100) / 3 });
    expect(nodeKindOf(smooth, 1)).toBe("smooth");
  });

  it("gives an end point the one handle it can have", () => {
    const smooth = setNodeKind(corner, 0, "smooth");
    expect(smooth.nodes[0].handleIn).toBeNull();
    near(smooth.nodes[0].handleOut!, { x: 100 / 3, y: 0 });
    const last = setNodeKind(corner, 2, "smooth");
    near(last.nodes[2].handleIn!, { x: 0, y: -100 / 3 });
    expect(last.nodes[2].handleOut).toBeNull();
  });

  it("looks round the corner of a closed path", () => {
    const triangle = closed(node(0, 0), node(100, 0), node(100, 100));
    expect(nodeKindOf(setNodeKind(triangle, 0, "smooth"), 0)).toBe("smooth");
    // the last point's next neighbour is the first
    const last = setNodeKind(triangle, 2, "smooth");
    expect(nodeKindOf(last, 2)).toBe("smooth");
    near(last.nodes[2].handleIn!, { x: 100 / 3, y: 0 });
    near(last.nodes[2].handleOut!, { x: -Math.hypot(100, 100) / 3, y: 0 });
  });

  it("points the handles along the x axis when the neighbours are in one place", () => {
    const there = setNodeKind(open(node(0, 0), node(30, 40), node(0, 0)), 1, "smooth");
    near(there.nodes[1].handleOut!, { x: 50 / 3, y: 0 });
    near(there.nodes[1].handleIn!, { x: -50 / 3, y: 0 });
  });

  it("cannot make the only point of a path smooth", () => {
    const single = open(node(5, 5));
    expect(setNodeKind(single, 0, "smooth")).toBe(single);
  });

  it("takes a handle that has no length for no handle", () => {
    expect(nodeKindOf(open(node(0, 0), node(50, 50, { x: 0, y: 0 }, { x: 10, y: 0 }), node(100, 0)), 1)).toBe("corner");
    expect(nodeKindOf(open(node(0, 0), node(50, 50, { x: -10, y: 0 }, { x: 0, y: 0 }), node(100, 0)), 1)).toBe("corner");
  });

  it("takes the handles away to make a corner", () => {
    const smooth = setNodeKind(corner, 1, "smooth");
    expect(setNodeKind(smooth, 1, "corner").nodes[1]).toEqual(node(100, 0));
  });

  it("changes nothing for a node that is not there", () => {
    expect(setNodeKind(corner, 7, "smooth")).toEqual(corner);
  });
});

describe("closePath", () => {
  it("closes a path of three or more nodes, and leaves a shorter one", () => {
    expect(closePath(open(node(0, 0), node(1, 1), node(2, 0))).closed).toBe(true);
    expect(closePath(open(node(0, 0), node(1, 1))).closed).toBe(false);
  });
});

describe("normalizePath and denormalizePath", () => {
  it("fit the path into the 0..100 box of the element, as the path of a shape is stored", () => {
    const { d, box } = normalizePath(open(node(50, 20), node(150, 20), node(150, 80)));
    expect(box).toEqual({ x: 50, y: 20, w: 100, h: 60 });
    expect(d).toBe("M0 0 L100 0 L100 100");
  });

  it("scale the handles with the box", () => {
    const { d } = normalizePath(open(node(50, 20, null, { x: 10, y: 6 }), node(150, 80, { x: -10, y: -6 }, null)));
    expect(d).toBe("M0 0 C10 10 90 90 100 100");
  });

  it("let a curve reach outside the box: the box is the curve's, the handles are not", () => {
    const { d, box } = normalizePath(open(node(0, 0, null, { x: 0, y: 100 }), node(100, 0, { x: 0, y: 100 }, null)));
    expect(box).toEqual({ x: 0, y: 0, w: 100, h: 75 });
    expect(d).toBe("M0 0 C0 133.333 100 133.333 100 0");
  });

  it("give a path that is flat a box of at least a pixel", () => {
    const { d, box } = normalizePath(open(node(0, 10), node(100, 10)));
    expect(box).toEqual({ x: 0, y: 10, w: 100, h: 1 });
    expect(d).toBe("M0 0 L100 0");
    expect(normalizePath(open(node(5, 5), node(5, 5))).box).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });

  it("come back to the pixels they started from", () => {
    const path = open(node(50, 20, null, { x: 10, y: 6 }), node(150, 80, { x: -10, y: -6 }, { x: 4, y: 4 }), node(120, 90));
    const { d, box } = normalizePath(path);
    const back = denormalizePath(parsePath(d)!, box.w, box.h);
    for (const [i, n] of back.nodes.entries()) {
      expect(n.x + box.x).toBeCloseTo(path.nodes[i].x, 1);
      expect(n.y + box.y).toBeCloseTo(path.nodes[i].y, 1);
      if (path.nodes[i].handleOut) near(n.handleOut!, path.nodes[i].handleOut!, 1);
      if (path.nodes[i].handleIn) near(n.handleIn!, path.nodes[i].handleIn!, 1);
    }
  });
});

describe("inBoxSpace", () => {
  it("puts the pixels of a box into its 0..100 space, and denormalizePath takes them back", () => {
    const path = open(node(20, 10, null, { x: 5, y: 2 }), node(60, 40, { x: -5, y: -2 }, null));
    const inside = inBoxSpace(path, 80, 40);
    expect(inside.nodes[1]).toEqual(node(75, 100, { x: -6.25, y: -5 }, null));
    const back = denormalizePath(inside, 80, 40);
    near(back.nodes[0], path.nodes[0]);
    near(back.nodes[1].handleIn!, path.nodes[1].handleIn!);
  });
});

describe("fitPaths", () => {
  const square = (x: number, y: number, size: number) => closed(node(x, y), node(x + size, y), node(x + size, y + size), node(x, y + size));

  it("fits several pieces into one box, each where it was", () => {
    const { d, box } = fitPaths([square(0, 0, 10), square(20, 20, 10)]);
    expect(box).toEqual({ x: 0, y: 0, w: 30, h: 30 });
    expect(d).toBe("M0 0 L33.333 0 L33.333 33.333 L0 33.333 L0 0 Z M66.667 66.667 L100 66.667 L100 100 L66.667 100 L66.667 66.667 Z");
  });

  it("is what normalizePath does for one piece", () => {
    const path = open(node(50, 20, null, { x: 10, y: 6 }), node(150, 80, { x: -10, y: -6 }, null));
    expect(fitPaths([path])).toEqual(normalizePath(path));
  });

  it("takes the box of the curves of all the pieces, at least a pixel each way", () => {
    expect(fitPaths([open(node(5, 5), node(5, 5))]).box).toEqual({ x: 5, y: 5, w: 1, h: 1 });
    expect(fitPaths([open(node(0, 0), node(10, 0)), open(node(0, 40), node(10, 40))]).box).toEqual({ x: 0, y: 0, w: 10, h: 40 });
  });

  it("has a box of a pixel and no data when there are no pieces", () => {
    expect(fitPaths([])).toEqual({ d: "", box: { x: 0, y: 0, w: 1, h: 1 } });
  });
});
