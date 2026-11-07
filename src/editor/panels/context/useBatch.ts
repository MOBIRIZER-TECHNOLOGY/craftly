import { useEffect, useMemo, useRef } from "react";
import { getActions } from "@/core/store";

/**
 * Groups a continuous gesture (slider scrub, colour drag, number scrub) into ONE undo step.
 * `run(fn)` opens a store transaction on the first call and then runs `fn`; `end()` closes it
 * (call it from `onChangeEnd` / `onCommit`). An open transaction is closed when the panel unmounts,
 * otherwise undo would stay blocked.
 */
export interface Batch {
  run(fn: () => void): void;
  end(): void;
}

export function useBatch(): Batch {
  const open = useRef(false);
  const batch = useMemo<Batch>(
    () => ({
      run(fn) {
        if (!open.current) {
          open.current = true;
          getActions().beginTransaction();
        }
        fn();
      },
      end() {
        if (open.current) {
          open.current = false;
          getActions().endTransaction();
        }
      },
    }),
    [],
  );
  useEffect(() => () => batch.end(), [batch]);
  return batch;
}
