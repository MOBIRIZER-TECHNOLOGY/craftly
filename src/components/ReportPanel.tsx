import { useState } from "react";
import { copyText } from "@/core/clipboardText";
import { reportEndpoint, reportText, sendReport, type Problem } from "@/core/problems";
import { downloadBlob } from "@/export/download";
import { Button, IconCopy, IconDownload, toast } from "@/ui";
import "./ReportPanel.css";

interface Props {
  problem: Problem;
  /** where a report may go; by default where the site that hosts Craftly says (none: the report can only be copied or downloaded) */
  endpoint?: string | null;
  /** called after the report was sent, so that a list can show it */
  onSent?: () => void;
}

const HOLDS =
  "This is everything a report holds: the error, the screen it happened on, the version of Craftly, your browser and the size of its window. It never holds your designs, their text or pictures, or file names.";

/** A problem's report, as it would be sent, and what can be done with it: copy it, download it and, where the site allows it, send it. */
export function ReportPanel({ problem, endpoint = reportEndpoint(), onSent }: Props) {
  const text = reportText(problem);
  const [state, setState] = useState<"idle" | "sending" | "sent">(problem.sent ? "sent" : "idle");

  const copy = async () => {
    if (await copyText(text)) toast.success("Report copied");
    else toast.error("Copying did not work. Select the text and copy it yourself.");
  };

  const send = async () => {
    setState("sending");
    if ((await sendReport(problem, endpoint)) === "sent") {
      setState("sent");
      toast.success("Report sent. Thank you.");
      onSent?.();
    } else {
      setState("idle");
      toast.error("The report could not be sent. You can copy it instead.");
    }
  };

  return (
    <div className="cf-report">
      <p className="cf-report__privacy">
        {HOLDS} {endpoint ? "Nothing is sent unless you press Send." : "Nothing is sent anywhere. Copy or download it to share it, for example in a bug report."}
      </p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the report scrolls, so the keyboard has to reach it */}
      <pre className="cf-report__text" tabIndex={0} aria-label="What a report holds">
        {text}
      </pre>
      <div className="cf-report__actions">
        <Button variant="secondary" size="sm" icon={<IconCopy aria-hidden="true" />} onClick={() => void copy()}>
          Copy report
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<IconDownload aria-hidden="true" />}
          onClick={() => downloadBlob(new Blob([text], { type: "application/json" }), "craftly-problem-report.json")}
        >
          Download report
        </Button>
        {endpoint ? (
          <Button variant="primary" size="sm" loading={state === "sending"} disabled={state === "sent"} onClick={() => void send()}>
            {state === "sending" ? "Sending…" : state === "sent" ? "Sent" : "Send report"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
