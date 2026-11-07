/**
 * The small pill anchored above the selection: lock, duplicate, delete and the "..." menu.
 * It sits above the top edge of the selection's bounds (flipping below when there is no room), stays
 * inside the workspace and follows scroll and zoom live. Hidden while editing text, cropping, during
 * gestures and in view mode.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { getActions, useActivePage, useEditor, useSelectedElements } from "@/core/store";
import { useGesture } from "@/editor/canvas/gestureStore";
import { designToScreen, useView } from "@/editor/canvas/viewStore";
import { IconDuplicate, IconLock, IconTrash, IconUnlock } from "@/ui";
import { MoreButton } from "./common";
import { TBIcon } from "./kit";
import { clampNumber, worldBounds } from "./selection";
import "./MiniToolbar.css";

/** distance between the pill and the selection frame (the frame's own handles stick out a few px) */
const GAP_ABOVE = 18;
/** below the frame there are the rotate / move handles, about 44px deep */
const GAP_BELOW = 60;
const MARGIN = 8;
/** the floating toolbar occupies the top 12 + 48 px of the workspace */
const TOP_SAFE = 68;

export function MiniToolbar() {
  const mode = useEditor((s) => s.mode);
  const presenting = useEditor((s) => s.presenting);
  const editing = useEditor((s) => s.editingTextId);
  const cropping = useEditor((s) => s.croppingId);
  const gesture = useGesture((s) => s.active);
  const page = useActivePage();
  const els = useSelectedElements();
  const view = useView((s) => s);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 148, h: 40 });

  // The pill's width depends on its buttons (a locked selection has fewer): measure after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measures after every render; setSize keeps the old object when nothing changed, so it settles
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  });

  if (!page || mode !== "edit" || presenting || editing || cropping || gesture || !els.length) return null;

  const ids = els.map((e) => e.id);
  const bounds = worldBounds(page, ids);
  if (!bounds) return null;

  const topLeft = designToScreen(view, bounds.x, bounds.y);
  const bottomRight = designToScreen(view, bounds.x + bounds.w, bounds.y + bounds.h);
  // Nothing to anchor to when the selection is scrolled completely out of view.
  if (bottomRight.x < 0 || topLeft.x > view.width || bottomRight.y < 0 || topLeft.y > view.height) return null;

  let top = topLeft.y - GAP_ABOVE - size.h;
  let side: "above" | "below" = "above";
  if (top < TOP_SAFE) {
    top = bottomRight.y + GAP_BELOW;
    side = "below";
  }
  top = clampNumber(top, MARGIN, Math.max(MARGIN, view.height - size.h - MARGIN));
  const centre = (topLeft.x + bottomRight.x) / 2;
  const left = clampNumber(centre - size.w / 2, MARGIN, Math.max(MARGIN, view.width - size.w - MARGIN));

  const actions = getActions();
  const allLocked = els.every((e) => e.locked);

  return (
    <div
      ref={ref}
      className="cf-minitb"
      role="toolbar"
      aria-label="Selected element quick actions"
      data-cf-ui
      data-cf-minitoolbar={side}
      style={{ left: Math.round(left), top: Math.round(top) }}
    >
      <TBIcon label={allLocked ? "Unlock" : "Lock"} shortcut="Alt+Shift+L" icon={allLocked ? <IconUnlock /> : <IconLock />} onClick={() => actions.setLocked(ids, !allLocked)} />
      {!allLocked && <TBIcon label="Duplicate" shortcut="Ctrl+D" icon={<IconDuplicate />} onClick={() => actions.duplicateSelection()} />}
      {!allLocked && <TBIcon label="Delete" shortcut="Delete" icon={<IconTrash />} onClick={() => actions.deleteElements()} />}
      <MoreButton />
    </div>
  );
}
