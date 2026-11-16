import { useEffect, useRef, useState } from "react";
import { kindOfLoadFailure, type Problem } from "@/core/problems";
import { savedAt } from "@/core/recovery";
import { date, m } from "@/i18n";
import { Button } from "@/ui";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReportPanel } from "./ReportPanel";
import "./ErrorBoundary.css";

interface Props {
  error: Error;
  /** what was written down about it, for the report */
  problem: Problem | null;
  /** the design that was open, when the screen that stopped was the editor */
  designId: string | null;
  /** how many times in a row the screen of this design stopped, this one included */
  crashes: number;
  onGoToProjects: () => void;
}

/**
 * What a person sees when Craftly stops (docs/CRASH-RECOVERY.md): what happened, how to go on, and for a design how to go back
 * to an earlier version or get a copy out without opening it, which may be what stops Craftly. The report is folded away.
 */
export function CrashScreen({ error, problem, designId, crashes, onGoToProjects }: Props) {
  const reload = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const loadFailure = kindOfLoadFailure(error.message);

  // the screen that had the keyboard is gone
  useEffect(() => reload.current?.focus(), []);

  useEffect(() => {
    if (!designId) return;
    let live = true;
    void savedAt(designId).then(
      (at) => live && setSaved(at),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [designId]);

  let text = m.app.crash.unexpected;
  if (loadFailure) text = m.app.crash.loadFailure;
  else if (designId && crashes >= 2) text = m.app.crash.stoppedAgain;
  else if (designId) text = m.app.crash.designStopped(saved ? date(saved, { timeStyle: "short" }) : null);

  return (
    <div className="cf-crash">
      <div className="cf-crash__card">
        <div role="alert">
          <h1>{loadFailure ? m.app.crash.titleLoad : m.app.crash.title}</h1>
          <p>{text}</p>
          <pre className="cf-crash__detail">{error.message}</pre>
        </div>
        <div className="cf-crash__actions">
          <Button ref={reload} variant="primary" onClick={() => window.location.reload()}>
            {m.app.crash.reload}
          </Button>
          <Button variant="secondary" onClick={onGoToProjects}>
            {m.app.crash.goToProjects}
          </Button>
        </div>
        {designId ? <RecoveryPanel designId={designId} open={crashes >= 2} /> : null}
        {problem ? (
          <details className="cf-crash__more">
            <summary>{m.app.crash.report}</summary>
            <ReportPanel problem={problem} />
          </details>
        ) : null}
      </div>
    </div>
  );
}
