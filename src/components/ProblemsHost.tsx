import { lazy, Suspense, useRef } from "react";
import { closeProblemsDialog, useProblemsDialog } from "./problemsDialogState";

const ProblemsDialog = lazy(() => import("./ProblemsDialog").then((m) => ({ default: m.ProblemsDialog })));

/** Mounted once near the root: loads the "Report a problem" dialog the first time somebody opens it. */
export function ProblemsHost() {
  const open = useProblemsDialog((s) => s.open);
  const problemId = useProblemsDialog((s) => s.problemId);
  const openings = useProblemsDialog((s) => s.opened);
  const opened = useRef(false);
  if (open) opened.current = true;
  if (!opened.current) return null;
  return (
    <Suspense fallback={null}>
      <ProblemsDialog key={openings} open={open} problemId={problemId} onClose={closeProblemsDialog} />
    </Suspense>
  );
}
