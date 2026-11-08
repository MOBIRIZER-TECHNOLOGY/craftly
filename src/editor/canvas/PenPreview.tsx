import { pathToString, scalePath, type PenNode } from "@/core/pen";
import { useEditor } from "@/core/store";
import { useGesture } from "./gestureStore";
import { CLOSE_RADIUS } from "./penTool";

const MARK = 7;

/** The path that the Pen tool is placing: what is placed so far, the side that the next click would make, and the handles of the last point. */
export function PenPreview() {
  const draft = useGesture((s) => s.pen);
  const zoom = useEditor((s) => s.zoom);
  if (!draft) return null;
  const { path, hover } = draft;
  const drawn = scalePath(path, zoom);
  const nodes = drawn.nodes;
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  const hovered = hover && { x: hover.x * zoom, y: hover.y * zoom };
  // the pointer is near enough to the first point that a click would close the path
  const closing = !!hovered && nodes.length >= 3 && Math.hypot(hovered.x - first.x, hovered.y - first.y) <= CLOSE_RADIUS;
  const end = closing ? first : hovered;
  const rubber = last && end ? pathToString({ closed: false, nodes: [last, { x: end.x, y: end.y, handleIn: null, handleOut: null } as PenNode] }) : null;

  return (
    <svg className="cf-penpreview" aria-hidden="true">
      {nodes.length > 1 && <path className="cf-penpreview__path" d={pathToString(drawn)} />}
      {rubber && <path className="cf-penpreview__rubber" d={rubber} />}
      {last &&
        (["handleIn", "handleOut"] as const).map((side) => {
          const handle = last[side];
          return handle ? (
            <g key={side} className="cf-penpreview__handle">
              <line x1={last.x} y1={last.y} x2={last.x + handle.x} y2={last.y + handle.y} />
              <circle cx={last.x + handle.x} cy={last.y + handle.y} r={3.5} />
            </g>
          ) : null;
        })}
      {nodes.map((n, i) => (
        <rect
          key={i}
          className={`cf-penpreview__node${i === nodes.length - 1 ? " is-last" : ""}${i === 0 && closing ? " is-closing" : ""}`}
          x={n.x - MARK / 2}
          y={n.y - MARK / 2}
          width={MARK}
          height={MARK}
        />
      ))}
    </svg>
  );
}
