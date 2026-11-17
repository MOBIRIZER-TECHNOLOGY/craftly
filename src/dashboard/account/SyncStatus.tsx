/**
 * The sync status beside the account menu of the dashboard and in the editor's top bar (docs/ACCOUNTS.md): synced, syncing,
 * offline with N waiting, or a problem in words. A button that opens a small panel with Sync now. Nothing at all while nobody is
 * signed in.
 */
import { useState } from "react";
import { useCloud } from "@/cloud/state";
import { statusWords, useSyncStatus } from "@/cloud/syncStatus";
import { m } from "@/i18n";
import { Button, IconCloud, IconCloudOff, IconCloudSaved, IconWarning, Popover, Spinner, cx } from "@/ui";
import "./account.css";

export function SyncStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const signedIn = useCloud((s) => s.session !== null);
  const status = useSyncStatus();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!signedIn || status.state === "off") return null;
  const words = statusWords(status, { synced: m.cloud.status.synced, syncing: m.cloud.status.syncing, offline: m.cloud.status.offline, problem: m.cloud.status.problem });
  const icon =
    status.state === "syncing" ? (
      <Spinner size={16} />
    ) : status.state === "synced" ? (
      <IconCloudSaved aria-hidden="true" />
    ) : status.state === "offline" ? (
      <IconCloudOff aria-hidden="true" />
    ) : status.state === "problem" ? (
      <IconWarning aria-hidden="true" />
    ) : (
      <IconCloud aria-hidden="true" />
    );
  const syncNow = async () => {
    setBusy(true);
    try {
      const { syncNow: run } = await import("@/cloud/sync");
      await run().catch(() => null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        size="sm"
        className={cx("cf-syncstatus", `is-${status.state}`, compact && "is-compact", className)}
        icon={icon}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${m.cloud.status.label}: ${words}`}
        onClick={() => setOpen((v) => !v)}
      >
        {compact ? null : <span className="cf-syncstatus__text">{words}</span>}
      </Button>
      <span className="cf-sr-only" role="status" aria-live="polite">
        {status.state === "problem" || status.state === "offline" ? words : ""}
      </span>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} placement="bottom-end" offset={6} className="cf-syncpop" aria-label={m.cloud.status.details}>
        <div className="cf-syncpop__body">
          <p className="cf-syncpop__state">{words}</p>
          {status.lastSyncedAt ? <p className="cf-syncpop__when">{m.cloud.status.lastSynced(status.lastSyncedAt)}</p> : null}
          <Button variant="secondary" size="sm" disabled={busy || status.state === "syncing"} onClick={() => void syncNow()}>
            {m.cloud.status.syncNow}
          </Button>
        </div>
      </Popover>
    </>
  );
}
