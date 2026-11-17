/**
 * Signing out (docs/ACCOUNTS.md, "Signing out"): what waits is sent first. The account's designs are then removed from this
 * device (the default, for shared computers), unless the person keeps copies here; when changes could not be sent, keeping copies
 * is what is offered first. Designs that were never moved into the account stay.
 */
import { useEffect, useState } from "react";
import { countWaiting, signOutAccount } from "@/cloud/account";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, Checkbox, Modal, toast } from "@/ui";
import "./account.css";

export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [waiting, setWaiting] = useState<number | null>(null);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWaiting(null);
    void countWaiting()
      .then((n) => {
        setWaiting(n);
        setKeep(n > 0);
      })
      .catch(() => setWaiting(0));
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await signOutAccount({ keepCopies: keep });
      toast.success(m.cloud.signOut.done);
      onClose();
      navigate("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={m.cloud.signOut.title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {m.cloud.signOut.cancel}
          </Button>
          <Button variant="primary" disabled={busy || waiting === null} aria-busy={busy || undefined} onClick={() => void confirm()}>
            {busy ? m.cloud.signOut.working : m.cloud.signOut.confirm}
          </Button>
        </>
      }
    >
      <div className="cf-acct__form">
        <p className="cf-acct__text">{m.cloud.signOut.body}</p>
        {waiting ? (
          <p className="cf-acct__problem" role="status">
            {m.cloud.signOut.waiting(waiting)}
          </p>
        ) : null}
        <Checkbox checked={keep} onChange={setKeep} label={m.cloud.signOut.keep} />
      </div>
    </Modal>
  );
}
