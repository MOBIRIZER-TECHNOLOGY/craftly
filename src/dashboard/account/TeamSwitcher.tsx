/**
 * The space the dashboard lists (docs/ACCOUNTS.md, "Listings by space"): the person's own designs, or one of their teams'. Above
 * every page of the dashboard while a person is signed in; nothing otherwise. With a team chosen, its members' page is a link
 * away, and a new team is made from here.
 */
import { useState, type FormEvent } from "react";
import { createTeam, cloudErrorText } from "@/cloud/api";
import { currentConn } from "@/cloud/account";
import { setActiveSpace, updateSession, useCloud } from "@/cloud/state";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, IconPlus, Modal, TextField, toast } from "@/ui";
import { openAccountDialog } from "./dialogState";
import "./account.css";

export function TeamSwitcher() {
  const session = useCloud((s) => s.session);
  if (!session) return null;
  const active = session.activeSpace;
  const team = session.teams.find((t) => t.id === active);
  return (
    <div className="cf-spacebar">
      <label className="cf-spacebar__label" htmlFor="cf-space-select">
        {m.cloud.teams.switcher}
      </label>
      <select id="cf-space-select" className="cf-acct__select" value={active} onChange={(event) => void setActiveSpace(event.target.value)}>
        <option value={session.user.id}>{m.cloud.teams.yourDesigns}</option>
        {session.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {m.cloud.teams.team(t.name)}
          </option>
        ))}
      </select>
      {team ? (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/team/${encodeURIComponent(team.id)}`)}>
          {m.cloud.menu.teamMembers}
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" icon={<IconPlus aria-hidden="true" />} onClick={() => openAccountDialog("createTeam")}>
        {m.cloud.teams.createTeam}
      </Button>
    </div>
  );
}

export function CreateTeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const conn = currentConn();
    if (!conn || !name.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const team = await createTeam(conn, name.trim());
      await updateSession((session) => ({ ...session, teams: [...session.teams, { id: team.id, name: team.name, role: team.role }] }));
      await setActiveSpace(team.id);
      toast.success(m.cloud.teams.created(team.name));
      setName("");
      onClose();
      navigate(`/team/${encodeURIComponent(team.id)}`);
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
      title={m.cloud.teams.createTeam}
      size="sm"
      footer={
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          {m.cloud.teams.create}
        </Button>
      }
    >
      <form className="cf-acct__form" onSubmit={(event) => void submit(event)}>
        <TextField label={m.cloud.teams.teamName} value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} data-autofocus />
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
