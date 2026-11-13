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
import { Badge, Button, TextField, toast } from "@/ui";
import { CreateKeyError, deniedText, shareDesign, stopSharing, useLiveStatus } from "./connection";
import { rememberShared } from "./joined";
import { joinUrl } from "./links";
import { NameField } from "./LivePeople";
import "./live.css";

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
export function liveStatusText(status: ReturnType<typeof useLiveStatus.getState>["status"], role: "edit" | "view" | null): string {
  if (status === "live") return role === "view" ? "Live, view only" : "Live";
  if (status === "connecting") return "Connecting...";
  if (status === "reconnecting") return "Reconnecting...";
  if (status === "denied") return "Not allowed in";
  return "Not connected";
}

function CopyLink({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("The link could not be copied. Select it and copy it by hand.");
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
          <Button size="sm" variant="secondary" onClick={() => void copy()} aria-label={`Copy the ${label.toLowerCase()}`}>
            {copied ? "Copied" : "Copy"}
          </Button>
        }
      />
    </div>
  );
}

export function LiveSection() {
  const link = useEditor((s) => s.design?.live ?? null);
  const designId = useEditor((s) => s.design?.id ?? "");
  const { status, role, reason } = useLiveStatus();
  const [server, setServer] = useState(savedServer);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  /** Whether the server at this address said that it wants a key to start sharing, the key as typed, and what is wrong with it. */
  const [keyAsked, setKeyAsked] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [keyProblem, setKeyProblem] = useState<string | null>(null);

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
      } else setProblem(error instanceof Error ? error.message : "Sharing could not be started.");
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
      setProblem(error instanceof Error ? error.message : "Sharing could not be stopped.");
    } finally {
      setBusy(false);
    }
  };

  if (!link) {
    return (
      <section className="cf-live" aria-labelledby="cf-live-title">
        <h3 className="cf-live__title" id="cf-live-title">
          Work together
        </h3>
        <p className="cf-live__text">Edit this design at the same time as other people, and see each other's changes as they happen. It needs a Craftly live server.</p>
        <TextField label="Server address" value={server} onChange={(e) => changeServer(e.target.value)} spellCheck={false} autoComplete="off" error={problem ?? undefined} />
        {keyAsked ? (
          <TextField
            label="Key to start sharing"
            type="password"
            value={createKey}
            onChange={(e) => {
              setCreateKey(e.target.value);
              setKeyProblem(null);
            }}
            hint="This server asks for a key to start sharing. Whoever runs it can give it to you."
            error={keyProblem ?? undefined}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        ) : null}
        <NameField />
        <Button variant="primary" onClick={() => void start()} disabled={busy || !server.trim() || (keyAsked && !createKey.trim())} aria-busy={busy || undefined}>
          Start live session
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
          Work together
        </h3>
        <Badge tone={status === "live" ? "success" : status === "denied" ? "danger" : "warning"}>{liveStatusText(status, role)}</Badge>
      </div>
      {owner ? (
        <>
          <CopyLink label="Edit link" url={joinUrl(here, link)} hint="Anyone with this link can change the design." />
          <CopyLink label="View link" url={joinUrl(here, { ...link, key: link.viewKey as string, role: "view" })} hint="Anyone with this link can look, not change." />
        </>
      ) : (
        <p className="cf-live__text">
          {link.role === "view" ? "You can look at this design, not change it." : "You are editing this design together with the person who shared it."}
        </p>
      )}
      <NameField />
      {problem ? (
        <p className="cf-live__problem" role="alert">
          {problem}
        </p>
      ) : null}
      {status === "denied" && reason ? (
        <p className="cf-live__problem" role="alert">
          {deniedText(reason)}
        </p>
      ) : null}
      {asking ? (
        <div className="cf-live__ask" role="group" aria-label="Stop sharing">
          <p className="cf-live__text">
            {owner ? "Everybody is sent away and the links stop working. The design stays on this device." : "This design stays on this device as your own copy."}
          </p>
          <div className="cf-live__actions">
            <Button variant="danger" onClick={() => void stop()} disabled={busy}>
              {owner ? "Stop sharing" : "Leave"}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
              Keep sharing
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAsking(true)}>
          {owner ? "Stop sharing" : "Leave"}
        </Button>
      )}
    </section>
  );
}

/** The state of the connection in the top bar, for a design that is shared. */
export function LiveBadge() {
  const link: LiveLink | null = useEditor((s) => s.design?.live ?? null);
  const { status, role } = useLiveStatus();
  if (!link) return null;
  return (
    <span className={`cf-live-badge cf-live-badge--${status}`} role="status" title={link.role === "view" ? "Shared with you to look at" : "Shared: changes are sent to everybody"}>
      <span className="cf-live-badge__dot" aria-hidden="true" />
      {liveStatusText(status, role)}
    </span>
  );
}
