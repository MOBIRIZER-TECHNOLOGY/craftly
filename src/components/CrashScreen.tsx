import { useEffect, useRef, useState } from "react";
import { kindOfLoadFailure, type Problem } from "@/core/problems";
import { savedAt } from "@/core/recovery";
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

const savedTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

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

  let text = "Craftly hit an unexpected problem. Your designs are saved on this device, so nothing you finished is lost.";
  if (loadFailure) text = "Check your connection, then reload. Your designs are saved on this device.";
  else if (designId && crashes >= 2)
    text = "Craftly stopped again when this design was opened. Go back to an earlier version below, or save a copy of the design to a file before you try anything else.";
  else if (designId)
    text = `Craftly stopped unexpectedly. Your design is saved on this device${saved ? ` (last saved at ${savedTime.format(saved)})` : ""}, so reloading should bring you back to where you were.`;

  return (
    <div className="cf-crash">
      <div className="cf-crash__card">
        <div role="alert">
          <h1>{loadFailure ? "A part of Craftly could not load" : "Something went wrong"}</h1>
          <p>{text}</p>
          <pre className="cf-crash__detail">{error.message}</pre>
        </div>
        <div className="cf-crash__actions">
          <Button ref={reload} variant="primary" onClick={() => window.location.reload()}>
            Reload Craftly
          </Button>
          <Button variant="secondary" onClick={onGoToProjects}>
            Go to your projects
          </Button>
        </div>
        {designId ? <RecoveryPanel designId={designId} open={crashes >= 2} /> : null}
        {problem ? (
          <details className="cf-crash__more">
            <summary>Report this problem</summary>
            <ReportPanel problem={problem} />
          </details>
        ) : null}
      </div>
    </div>
  );
}
