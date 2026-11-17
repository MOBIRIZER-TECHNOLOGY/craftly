/** Account settings: who is signed in and where, the devices signed in (each can be signed out), and a new password. */
import { useEffect, useState, type FormEvent } from "react";
import { changePassword, cloudErrorText, endSession, getSessions, hostOf } from "@/cloud/api";
import { currentConn } from "@/cloud/account";
import { useCloud } from "@/cloud/state";
import { m } from "@/i18n";
import { Button, Modal, TextField, toast } from "@/ui";
import "./account.css";

type Sessions = Awaited<ReturnType<typeof getSessions>>;

export function AccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useCloud((s) => s.session);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    const conn = currentConn();
    if (!conn) return;
    getSessions(conn)
      .then(setSessions)
      .catch((error: unknown) => setProblem(cloudErrorText(error)));
  };
  useEffect(() => {
    if (open) load();
  }, [open]);

  if (!session) return null;

  const end = async (id: string) => {
    const conn = currentConn();
    if (!conn) return;
    try {
      await endSession(conn, id);
      load();
    } catch (error) {
      setProblem(cloudErrorText(error));
    }
  };

  const change = async (event: FormEvent) => {
    event.preventDefault();
    const conn = currentConn();
    if (!conn) return;
    if ([...newPassword.normalize("NFC")].length < 10) {
      setProblem(m.cloud.signUp.tooShort);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await changePassword(conn, oldPassword, newPassword);
      setOld("");
      setNew("");
      toast.success(m.cloud.account.passwordChanged);
      load();
    } catch (error) {
      setProblem(cloudErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.cloud.account.title}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {m.cloud.account.close}
        </Button>
      }
    >
      <div className="cf-acct__form">
        <dl className="cf-acct__list">
          <div className="cf-acct__item">
            <dt className="cf-acct__meta">{m.cloud.account.name}</dt>
            <dd className="cf-acct__name">{session.user.name}</dd>
          </div>
          <div className="cf-acct__item">
            <dt className="cf-acct__meta">{m.cloud.account.email}</dt>
            <dd className="cf-acct__name">{session.user.email}</dd>
          </div>
          <div className="cf-acct__item">
            <dt className="cf-acct__meta">{m.cloud.account.server}</dt>
            <dd className="cf-acct__name">{hostOf(session.server)}</dd>
          </div>
        </dl>

        <h3 className="cf-acct__section-title">{m.cloud.account.devices}</h3>
        {sessions === null ? (
          <p className="cf-acct__text">{m.cloud.account.loading}</p>
        ) : (
          <ul className="cf-acct__list">
            {sessions.map((one) => (
              <li key={one.id} className="cf-acct__item">
                <span className="cf-acct__who">
                  <span className="cf-acct__name">{one.current ? m.cloud.account.thisDevice : one.device || m.cloud.account.unknownDevice}</span>
                  <span className="cf-acct__meta">{m.cloud.account.lastUsed(one.lastUsedAt)}</span>
                </span>
                {one.current ? null : (
                  <Button variant="ghost" size="sm" onClick={() => void end(one.id)}>
                    {m.cloud.account.endSession(one.device || m.cloud.account.unknownDevice)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className="cf-acct__form" onSubmit={(event) => void change(event)} aria-label={m.cloud.account.password}>
          <h3 className="cf-acct__section-title">{m.cloud.account.password}</h3>
          {/* a password manager knows which account the new password is for */}
          <input type="text" name="username" autoComplete="username" value={session.user.email} readOnly hidden />
          <TextField label={m.cloud.account.oldPassword} type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
          <TextField label={m.cloud.account.newPassword} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          {problem ? (
            <p className="cf-acct__problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="cf-acct__row">
            <Button type="submit" variant="primary" disabled={busy || !oldPassword || !newPassword}>
              {m.cloud.account.changePassword}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
