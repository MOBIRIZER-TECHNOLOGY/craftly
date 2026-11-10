/**
 * Tells the person about the two things that only happen when Craftly is open in more than one tab and a new release changes
 * the way the library is stored (src/core/schema/database.ts, docs/MIGRATIONS.md):
 *   - another tab has the database open in an older release that does not give way, so this tab's upgrade waits;
 *   - another tab upgraded the database, so this tab (which still runs the old release) wrote what it had and let go of it.
 * Neither can happen before the first release that changes the stores; the code is here, and tested, ahead of it.
 */
import { watchDatabase } from "@/core/persistence";
import { toast } from "@/ui";
import { settleSaves } from "./settleSaves";

export const BLOCKED_NOTICE = "Your designs are waiting for another Craftly tab that is still on an older version. Close or reload that tab.";
export const REPLACED_NOTICE = "Craftly was updated in another tab. Reload this tab to keep working.";

/** How long this tab may take to write the open design before it gives the database up (the database layer waits a little longer). */
const SAVE_BUDGET_MS = 2000;

export function installDatabaseNotices(options: { reload?: () => void } = {}): () => void {
  const reload = options.reload ?? (() => window.location.reload());
  let waiting: number | null = null;
  return watchDatabase({
    blocked() {
      if (waiting === null) waiting = toast.info(BLOCKED_NOTICE, { duration: 0 });
    },
    unblocked() {
      if (waiting !== null) toast.dismiss(waiting);
      waiting = null;
    },
    async replaced() {
      const saved = await settleSaves(SAVE_BUDGET_MS);
      if (saved === "saved") toast.info(REPLACED_NOTICE, { actionLabel: "Reload", duration: 0, onAction: reload });
      else toast.error("Craftly updated in another tab. Download your unsaved changes as a project file before reloading.", { duration: 0 });
    },
  });
}
