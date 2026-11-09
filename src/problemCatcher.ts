/**
 * Writes down what nothing else catches: an error thrown in an event handler or a timer, and a failure that nothing waited for
 * (a promise that rejected). The screen that stops is the error boundary's (src/components/ErrorBoundary.tsx). The problem is
 * kept on this device (src/core/problems.ts); the person is told about it once in a while, with a way to see the details.
 */
import { openProblemsDialog } from "@/components/problemsDialogState";
import { recordProblem, type Problem } from "@/core/problems";
import { isCrashing } from "@/core/recovery";
import { toast } from "@/ui";

const NOTICE = "Something unexpected went wrong. If something does not work, reload the page.";
/** at least this long between two notices, and no more than three in a page's life: it is a hint, not an alarm */
const NOTICE_GAP = 60_000;
const NOTICE_LIMIT = 3;

export function installProblemCatcher(options: { now?: () => number } = {}): () => void {
  const now = options.now ?? Date.now;
  let lastNotice = -Infinity;
  let notices = 0;

  const tell = (problem: Problem | null) => {
    // a problem that came again is the same one; the screen that stopped says what it has to say itself
    if (!problem || problem.count > 1 || isCrashing() || notices >= NOTICE_LIMIT || now() - lastNotice < NOTICE_GAP) return;
    lastNotice = now();
    notices += 1;
    toast.error(NOTICE, { actionLabel: "Details", onAction: () => openProblemsDialog(problem.id), duration: 10_000 });
  };

  const onError = (event: ErrorEvent) => tell(recordProblem("script", event.error ?? event.message, { source: event.filename, now: now() }));
  const onRejection = (event: PromiseRejectionEvent) => tell(recordProblem("promise", event.reason, { now: now() }));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
