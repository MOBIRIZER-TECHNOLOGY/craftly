/**
 * The other people of a shared design, on the page: each one's pointer, and an outline around what they have selected, in their
 * colour and with their name. It is a layer of its own above the page, inside the frame that is laid over the page (so it scrolls
 * and zooms with it), and it is only to be looked at: it takes no pointer events (canvas.css gives the frame none, and nothing in
 * here asks for any), has nothing that can be focused, and is hidden from a screen reader, for which the list in the top bar says
 * who is here (LivePeople.tsx). A name is put into the page as text.
 *
 * It also follows this person's own pointer over the canvas, for the others to see (presence.ts says it, sparingly). It listens
 * beside the controller of the canvas and takes nothing from it.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { getActivePage, useEditor } from "@/core/store";
import type { Page } from "@/core/types";
import { worldBox } from "../canvas/frame";
import { setPointer, usePresence, type Person } from "./presence";
import "./live.css";

/** The pointer of another person: an arrow whose tip is the place. */
const ARROW = "M1 1 L1 15 L5.2 11.4 L8 17.5 L10.6 16.3 L7.9 10.4 L13.5 10.4 Z";

export function PresenceOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const me = usePresence((s) => s.me);
  const people = usePresence((s) => s.people);
  const zoom = useEditor((s) => s.zoom);
  const page = useEditor((s) => getActivePage(s));
  const inRoom = me !== null;

  // this person's own pointer, in the pixels of the design: the layer covers the page exactly, so its corner is the page's corner
  useEffect(() => {
    const layer = ref.current;
    const workspace = layer?.closest<HTMLElement>("[data-cf-workspace]");
    if (!layer || !workspace || !inRoom) return;
    const move = (event: PointerEvent) => {
      const corner = layer.getBoundingClientRect();
      const scale = useEditor.getState().zoom;
      setPointer({ x: (event.clientX - corner.left) / scale, y: (event.clientY - corner.top) / scale });
    };
    const leave = () => setPointer(null);
    workspace.addEventListener("pointermove", move, { passive: true });
    workspace.addEventListener("pointerleave", leave, { passive: true });
    return () => {
      workspace.removeEventListener("pointermove", move);
      workspace.removeEventListener("pointerleave", leave);
      setPointer(null);
    };
  }, [inRoom]);

  return (
    <div ref={ref} className="cf-presence" aria-hidden="true">
      {page ? people.filter((p) => p.page === page.id).map((person) => <PersonLayer key={person.peer} person={person} page={page} zoom={zoom} />) : null}
    </div>
  );
}

/** One other person on the open page: an outline around each element they selected, their name on the first, and their pointer. */
function PersonLayer({ person, page, zoom }: { person: Person; page: Page; zoom: number }) {
  let named = false;
  return (
    <div className="cf-presence__person" style={{ "--cf-presence": person.color } as CSSProperties}>
      {person.selection.map((id) => {
        const box = worldBox(page, id);
        if (!box) return null;
        const first = !named;
        named = true;
        return (
          <div
            key={id}
            className="cf-presence__outline"
            style={{
              left: box.x * zoom,
              top: box.y * zoom,
              width: box.width * zoom,
              height: box.height * zoom,
              transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
              borderColor: person.color,
            }}
          >
            {first ? <span className="cf-presence__tag cf-presence__tag--outline">{person.name}</span> : null}
          </div>
        );
      })}
      {person.pointer ? (
        <div className="cf-presence__pointer" style={{ transform: `translate(${person.pointer.x * zoom}px, ${person.pointer.y * zoom}px)`, color: person.color }}>
          <svg className="cf-presence__arrow" width="16" height="19" viewBox="0 0 16 19">
            <path d={ARROW} fill="currentColor" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="cf-presence__tag">{person.name}</span>
        </div>
      ) : null}
    </div>
  );
}
