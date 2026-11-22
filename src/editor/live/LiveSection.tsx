/**
 * "Work together", in the Share panel: start editing the open design at the same time as other people, hand out the links (one that
 * lets people edit, one that only lets them look), see how the connection is, and stop. It needs a Craftly live server
 * (docs/COLLABORATION.md): the address is asked for once and remembered on this device.
 *
 * A server may let only people with a key start to share. The panel does not know that beforehand: the first attempt goes without
 * a key, and when the server answers that it wants one, a field for it appears and the person tries again. The key is held while the
 * panel is open and kept nowhere: it is the operator's secret, and a browser's storage keeps things as plain text.
 */
import { CONFIGURED_SERVER } from "./knownServers";
import { useState } from "react";
import { useEditor } from "@/core/store";
import type { LiveLink } from "@/core/types";
import { m } from "@/i18n";
import { Badge, Button, TextField, toast } from "@/ui";
import { CreateKeyError, endedText, shareDesign, stopSharing, useLiveStatus } from "./connection";
import { rememberShared } from "./joined";
import { joinUrl } from "./links";
import { NameField } from "./LivePeople";
import { useTeamLive } from "./teamLive";
import "./live.css";

/** Whether the open design is edited live with its team (teamLive.ts), with no link: the room the editor is joined to. */
function useTeamLink(): LiveLink | null {
  const designId = useEditor((s) => s.design?.id ?? "");
  return useTeamLive((s) => (s.designId === designId && designId ? s.link : null));
}

const SERVER_KEY = "craftly.live.server";
const DEFAULT_SERVER = CONFIGURED_SERVER ?? "http://localhost:8787";

const savedServer = (): string => {
  try {
    return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
};

/** How the connection is, in words. */
export function liveStatusText(status: ReturnType<typeof useLiveStatus.getState>["status"], role: "edit" | "comment" | "view" | null, stopped = false): string {
  if (status === "live") return role === "view" ? m.editor.live.status.liveView : role === "comment" ? m.editor.live.status.liveComment : m.editor.live.status.live;
  if (status === "connecting") return m.editor.live.status.connecting;
  if (status === "reconnecting") return m.editor.live.status.reconnecting;
  if (status === "denied") return stopped ? m.editor.live.status.stopped : m.editor.live.status.denied;
  return m.editor.live.status.off;
}

/** `copyLabel` names the button that copies the link. */
function CopyLink({ label, copyLabel, url, hint }: { label: string; copyLabel: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(m.editor.live.copyFailed);
    }
  };
  return (
    <div className="cf-live__link">
      <TextField
        label={label}
        hint={hint}
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        trailing={
          <Button size="sm" variant="secondary" onClick={() => void copy()} aria-label={copyLabel}>
            {copied ? m.editor.live.copied : m.editor.live.copy}
          </Button>
        }
      />
    </div>
  );
}

export function LiveSection() {
  const link = useEditor((s) => s.design?.live ?? null);
  const designId = useEditor((s) => s.design?.id ?? "");
  const { status, role, reason, stopped } = useLiveStatus();
  const ended = status === "denied" ? endedText({ reason, stopped }) : null;
  const [server, setServer] = useState(savedServer);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** Whether the server at this address said that it wants a key to start sharing, the key as typed, and what is wrong with it. */
  const [keyAsked, setKeyAsked] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const team = useTeamLink();

  /** Another address is another server: the question was not its question, and the key is not shown to it. */
  const changeServer = (address: string) => {
    setServer(address);
    setKeyAsked(false);
    setCreateKey("");
    setKeyProblem(null);
  };

  const start = async () => {
    setBusy(true);
    setProblem(null);
    setKeyProblem(null);
    try {
      const made = await shareDesign(server, {}, keyAsked ? createKey : "");
      rememberShared(made, designId);
      try {
        localStorage.setItem(SERVER_KEY, made.server);
      } catch {
        /* it is asked for again */
      }
    } catch (error) {
      if (error instanceof CreateKeyError) {
        // the first time it is a question, shown as the hint of the field; a key that was sent and refused is a problem
        setKeyAsked(true);
        if (error.kind === "wrong") setKeyProblem(error.message);
      } else setProblem(error instanceof Error ? error.message : m.editor.live.startFailed);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await stopSharing();
      setAsking(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : m.editor.live.stopFailed);
    } finally {
      setBusy(false);
    }
  };

  // edited live with the team already: a link session of the same design would be a second room beside it, so none is offered
  if (!link && team) return null;

  if (!link) {
    return (
      <section className="cf-live" aria-labelledby="cf-live-title">
        <h3 className="cf-live__title" id="cf-live-title">
          {m.editor.live.title}
        </h3>
        <p className="cf-live__text">{m.editor.live.intro}</p>
        <TextField
          label={m.editor.live.serverAddress}
          value={server}
          onChange={(e) => changeServer(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          error={problem ?? undefined}
        />
        {keyAsked ? (
          <TextField
            label={m.editor.live.keyLabel}
            type="password"
            value={createKey}
            onChange={(e) => {
              setCreateKey(e.target.value);
              setKeyProblem(null);
            }}
            hint={m.editor.live.keyNeeded}
            error={keyProblem ?? undefined}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        ) : null}
        <NameField />
        <Button variant="primary" onClick={() => void start()} disabled={busy || !server.trim() || (keyAsked && !createKey.trim())} aria-busy={busy || undefined}>
          {m.editor.live.start}
        </Button>
      </section>
    );
  }

  const here = window.location.href;
  const owner = link.role === "edit" && Boolean(link.ownerKey);
  return (
    <section className="cf-live" aria-labelledby="cf-live-title">
      <div className="cf-live__head">
        <h3 className="cf-live__title" id="cf-live-title">
          {m.editor.live.title}
        </h3>
        <Badge tone={status === "live" ? "success" : status === "denied" ? "danger" : "warning"}>{liveStatusText(status, role, stopped)}</Badge>
      </div>
      {owner ? (
        <>
          <CopyLink label={m.editor.live.editLink} copyLabel={m.editor.live.copyEditLink} url={joinUrl(here, link)} hint={m.editor.live.editLinkHint} />
          <CopyLink
            label={m.editor.live.viewLink}
            copyLabel={m.editor.live.copyViewLink}
            url={joinUrl(here, { ...link, key: link.viewKey as string, role: "view" })}
            hint={m.editor.live.viewLinkHint}
          />
        </>
      ) : (
        <p className="cf-live__text">{link.role === "view" ? m.editor.live.youView : m.editor.live.youEdit}</p>
      )}
      <NameField />
      {problem ? (
        <p className="cf-live__problem" role="alert">
          {problem}
        </p>
      ) : null}
      {ended ? (
        <p className="cf-live__problem" role="alert">
          {ended}
        </p>
      ) : null}
      {asking ? (
        <div className="cf-live__ask" role="group" aria-label={m.editor.live.stopSharing}>
          <p className="cf-live__text">{owner ? m.editor.live.stopOwner : m.editor.live.stopGuest}</p>
          <div className="cf-live__actions">
            <Button variant="danger" onClick={() => void stop()} disabled={busy}>
              {owner ? m.editor.live.stopSharing : m.editor.live.leave}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
              {m.editor.live.keepSharing}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAsking(true)}>
          {owner ? m.editor.live.stopSharing : m.editor.live.leave}
        </Button>
      )}
    </section>
  );
}

/** The state of the connection in the top bar, for a design that is shared by a link or edited live with its team. */
export function LiveBadge() {
  const shared: LiveLink | null = useEditor((s) => s.design?.live ?? null);
  const team = useTeamLink();
  const { status, role, stopped } = useLiveStatus();
  const link = shared ?? team;
  if (!link) return null;
  const linkTitle = link.role === "view" ? m.editor.live.badgeView : m.editor.live.badgeEdit;
  const title = stopped ? m.editor.live.ownerStopped : shared ? linkTitle : role === "view" ? m.cloud.live.viewing : m.cloud.live.joined;
  return (
    <span className={`cf-live-badge cf-live-badge--${status}`} role="status" title={title}>
      <span className="cf-live-badge__dot" aria-hidden="true" />
      {liveStatusText(status, role, stopped)}
    </span>
  );
}
