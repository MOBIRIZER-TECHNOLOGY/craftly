/**
 * "Edit live with your team", in the Share panel of a design of a team (docs/ACCOUNTS.md): no link, no key. Shown only while the
 * person is signed in and the open design is in one of their teams' spaces; a viewer sees the design live, read-only.
 */
import { useEffect, useState } from "react";
import { useCloud } from "@/cloud/state";
import { useEditor } from "@/core/store";
import { m } from "@/i18n";
import { Badge, Button } from "@/ui";
import { liveStatusText } from "./LiveSection";
import { useLiveStatus } from "./connection";
import { startTeamLive, stopTeamLive, teamOf, useTeamLive } from "./teamLive";
import "./live.css";

export function TeamLiveSection() {
  const signedIn = useCloud((s) => s.session !== null);
  const designId = useEditor((s) => s.design?.id ?? "");
  const shared = useEditor((s) => !!s.design?.live);
  const [team, setTeam] = useState<Awaited<ReturnType<typeof teamOf>>>(null);
  const live = useTeamLive((s) => (s.designId === designId ? s : null));
  const { status, role } = useLiveStatus();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    if (!signedIn || !designId) {
      setTeam(null);
      return;
    }
    void teamOf(designId)
      .then((found) => !gone && setTeam(found))
      .catch(() => !gone && setTeam(null));
    return () => {
      gone = true;
    };
  }, [signedIn, designId]);

  if (!team || shared) return null;
  const viewer = team.role === "viewer";
  const on = !!live?.link;

  const start = async () => {
    setProblem(null);
    try {
      await startTeamLive(designId);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="cf-live" aria-labelledby="cf-team-live-title">
      <div className="cf-live__head">
        <h3 className="cf-live__title" id="cf-team-live-title">
          {m.cloud.live.title}
        </h3>
        {on ? <Badge tone={status === "live" ? "success" : "neutral"}>{liveStatusText(status, role)}</Badge> : null}
      </div>
      <p className="cf-live__text">{viewer ? m.cloud.live.viewHint : m.cloud.live.hint}</p>
      {problem ? (
        <p className="cf-live__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="cf-live__actions">
        {on ? (
          <Button variant="secondary" onClick={() => stopTeamLive()}>
            {m.cloud.live.leave}
          </Button>
        ) : (
          <Button variant="primary" disabled={live?.joining} aria-busy={live?.joining || undefined} onClick={() => void start()}>
            {live?.joining ? m.cloud.live.joining : m.cloud.live.editLive}
          </Button>
        )}
      </div>
    </section>
  );
}
