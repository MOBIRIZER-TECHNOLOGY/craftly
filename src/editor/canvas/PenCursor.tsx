import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/core/store";
import { useGesture } from "./gestureStore";

/** How long the keyboard point has to rest before a screen reader is told about it: a held arrow key says one thing, at its end. */
const REST_MS = 300;

/** `text`, once it has stayed the same for `ms`. */
function useRested(text: string, ms: number): string {
  const [rested, setRested] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setRested(text), ms);
    return () => window.clearTimeout(timer);
  }, [text, ms]);
  return rested;
}

/**
 * The point that the arrow keys move while the Pen is in hand (src/editor/canvas/penTool.ts): a cross on the page with its
 * place in numbers beside it, and the same in words for a screen reader. The words live in a status that is always on the
 * page, because a live region that appears together with its text is not reliably read.
 */
export function PenCursor() {
  const cursor = useGesture((s) => s.penCursor);
  const zoom = useEditor((s) => s.zoom);
  const mark = useRef<HTMLDivElement>(null);
  const shown = cursor?.shown ? cursor : null;
  const said = useRested(shown?.say ?? "", REST_MS);
  const x = shown?.x;
  const y = shown?.y;

  // the page may be larger than the window: the view follows the point, as it follows a caret (jsdom has no such scrolling)
  useEffect(() => {
    const el = mark.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [x, y]);

  return (
    <>
      {shown && (
        <div ref={mark} className="cf-pencursor" aria-hidden="true" style={{ left: shown.x * zoom, top: shown.y * zoom }}>
          <span className="cf-pencursor__readout">
            {Math.round(shown.x)}, {Math.round(shown.y)}
          </span>
        </div>
      )}
      <span className="cf-sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </>
  );
}
