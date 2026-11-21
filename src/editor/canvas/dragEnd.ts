import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * The end of the drag that an overlay has under way (the crop, point editing, a guide), called if what was pressed leaves the
 * page before the pointer is released. A drag opens one undo step and closes it when the pointer comes up on the element it
 * pressed; when that element goes first (Esc ends the crop or point editing, Shift+R hides the guides, a collaborator deletes
 * the element), its `pointerup` never comes, and a step left open blocks undo, redo and the history until another design is
 * opened. A drag puts its end here when it starts and takes it away when it ends; it is called when the overlay unmounts, or
 * when `shown` turns false for an overlay that stays mounted and draws nothing.
 */
export function useDragEnd(shown = true): MutableRefObject<(() => void) | null> {
  const end = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      end.current?.();
      end.current = null;
    },
    [shown],
  );
  return end;
}
