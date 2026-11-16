import { useState } from "react";
import { copyText } from "@/core/clipboardText";
import { reportEndpoint, reportText, sendReport, type Problem } from "@/core/problems";
import { downloadBlob } from "@/export/download";
import { m } from "@/i18n";
import { Button, IconCopy, IconDownload, toast } from "@/ui";
import "./ReportPanel.css";

interface Props {
  problem: Problem;
  /** where a report may go; by default where the site that hosts Craftly says (none: the report can only be copied or downloaded) */
  endpoint?: string | null;
  /** called after the report was sent, so that a list can show it */
  onSent?: () => void;
}

/** A problem's report, as it would be sent, and what can be done with it: copy it, download it and, where the site allows it, send it. */
export function ReportPanel({ problem, endpoint = reportEndpoint(), onSent }: Props) {
  const text = reportText(problem);
  const [state, setState] = useState<"idle" | "sending" | "sent">(problem.sent ? "sent" : "idle");

  const copy = async () => {
    if (await copyText(text)) toast.success(m.app.report.copied);
    else toast.error(m.app.report.copyFailed);
  };

  const send = async () => {
    setState("sending");
    if ((await sendReport(problem, endpoint)) === "sent") {
      setState("sent");
      toast.success(m.app.report.sentToast);
      onSent?.();
    } else {
      setState("idle");
      toast.error(m.app.report.sendFailed);
    }
  };

  return (
    <div className="cf-report">
      <p className="cf-report__privacy">
        {m.app.report.holds} {endpoint ? m.app.report.sentOnlyOnPress : m.app.report.neverSent}
      </p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the report scrolls, so the keyboard has to reach it */}
      <pre className="cf-report__text" tabIndex={0} aria-label={m.app.report.textLabel}>
        {text}
      </pre>
      <div className="cf-report__actions">
        <Button variant="secondary" size="sm" icon={<IconCopy aria-hidden="true" />} onClick={() => void copy()}>
          {m.app.report.copy}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<IconDownload aria-hidden="true" />}
          onClick={() => downloadBlob(new Blob([text], { type: "application/json" }), "craftly-problem-report.json")}
        >
          {m.app.report.download}
        </Button>
        {endpoint ? (
          <Button variant="primary" size="sm" loading={state === "sending"} disabled={state === "sent"} onClick={() => void send()}>
            {state === "sending" ? m.app.report.sending : state === "sent" ? m.app.report.sent : m.app.report.send}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
