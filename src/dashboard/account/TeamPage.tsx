/**
 * `#/team/<id>`: a team's members with their roles, its invites, and the team itself (docs/ACCOUNTS.md, "Roles"). Everybody in the
 * team sees the members and may leave; an owner changes roles, removes members, makes and revokes invites, renames and deletes
 * the team. The server decides every time; the page only leaves out what the role may not do.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as api from "@/cloud/api";
import { cloudErrorText } from "@/cloud/api";
import { currentConn } from "@/cloud/account";
import { inviteUrl } from "@/cloud/inviteLink";
import { setActiveSpace, updateSession, useCloud } from "@/cloud/state";
import type { CloudInvite, CloudMember, CloudTeam, Role } from "@/cloud/validate";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, TextField, confirm, toast } from "@/ui";
import { Page, PageHeader } from "../Page";
import "./account.css";

const ROLES: Role[] = ["owner", "editor", "viewer"];

export function TeamPage({ teamId }: { teamId: string }) {
  const session = useCloud((s) => s.session);
  const [team, setTeam] = useState<CloudTeam | null>(null);
  const [members, setMembers] = useState<CloudMember[]>([]);
  const [invites, setInvites] = useState<CloudInvite[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [uses, setUses] = useState("5");
  const [hours, setHours] = useState("72");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const conn = currentConn();
    if (!conn) return;
    try {
      const page = await api.getTeam(conn, teamId);
      setTeam(page.team);
      setName(page.team.name);
      setMembers(page.members);
      setMissing(false);
      if (page.team.role === "owner") setInvites(await api.listInvites(conn, teamId));
      // the role as the server says it now
      await updateSession((kept) => ({ ...kept, teams: kept.teams.map((t) => (t.id === page.team.id ? { ...t, name: page.team.name, role: page.team.role } : t)) }));
    } catch (error) {
      if (error instanceof api.CloudError && error.code === "not-found") setMissing(true);
      else setProblem(cloudErrorText(error));
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: (conn: api.Conn) => Promise<unknown>) => {
    const conn = currentConn();
    if (!conn) return;
    setProblem(null);
    try {
      await work(conn);
      await load();
    } catch (error) {
      setProblem(cloudErrorText(error));
    }
  };

  if (!session) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.signIn.title} subtitle={m.cloud.invite.signInFirst} />
        <a href="#/signin">{m.cloud.signIn.title}</a>
      </Page>
    );
  }
  if (missing) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.teamPage.members} subtitle={m.cloud.teamPage.notInTeam} />
        <a href="#/">{m.cloud.signIn.back}</a>
      </Page>
    );
  }
  if (!team) {
    return (
      <Page className="cf-acct">
        <p aria-busy="true">{m.cloud.teamPage.loading}</p>
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
      </Page>
    );
  }

  const owner = team.role === "owner";
  const roleWord = (role: Role) => m.cloud.teams.role[role];

  const leave = async () => {
    const ok = await confirm({ title: m.cloud.teamPage.leave, message: m.cloud.teamPage.leaveConfirm, confirmLabel: m.cloud.teamPage.leave, danger: true });
    if (!ok) return;
    const conn = currentConn();
    if (!conn) return;
    try {
      await api.removeMember(conn, team.id, session.user.id);
      await updateSession((kept) => ({ ...kept, teams: kept.teams.filter((t) => t.id !== team.id) }));
      await setActiveSpace(session.user.id);
      void import("@/cloud/sync").then((sync) => sync.requestSync());
      navigate("/");
    } catch (error) {
      setProblem(cloudErrorText(error));
    }
  };

  const remove = async (member: CloudMember) => {
    const ok = await confirm({
      title: m.cloud.teamPage.remove(member.name),
      message: m.cloud.teamPage.removeConfirm(member.name),
      confirmLabel: m.cloud.teamPage.remove(member.name),
      danger: true,
    });
    if (ok) await act((conn) => api.removeMember(conn, team.id, member.id));
  };

  const makeInvite = async (event: FormEvent) => {
    event.preventDefault();
    await act(async (conn) => {
      const invite = await api.createInvite(conn, team.id, {
        role: inviteRole,
        uses: Math.max(1, Math.min(100, Number(uses) || 1)),
        hours: Math.max(1, Math.min(720, Number(hours) || 72)),
      });
      // the invite page of this copy of Craftly, with the code and the account server it is for (inviteLink.ts)
      setMade(inviteUrl(`${window.location.origin}${window.location.pathname}`, invite.code, conn.server));
    });
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.trim() === team.name) return;
    await act((conn) => api.renameTeam(conn, team.id, name.trim()));
  };

  const deleteTeam = async () => {
    const ok = await confirm({ title: m.cloud.teamPage.deleteTeam, message: m.cloud.teamPage.deleteConfirm(team.name), confirmLabel: m.cloud.teamPage.deleteTeam, danger: true });
    if (!ok) return;
    const conn = currentConn();
    if (!conn) return;
    try {
      await api.deleteTeam(conn, team.id);
      await updateSession((kept) => ({ ...kept, teams: kept.teams.filter((t) => t.id !== team.id) }));
      await setActiveSpace(session.user.id);
      void import("@/cloud/sync").then((sync) => sync.requestSync());
      navigate("/");
    } catch (error) {
      setProblem(cloudErrorText(error));
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(m.cloud.teamPage.copied);
    } catch {
      /* the link is on the screen to copy by hand */
    }
  };

  return (
    <Page className="cf-acct">
      <PageHeader
        title={m.cloud.teamPage.title(team.name)}
        subtitle={roleWord(team.role)}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void setActiveSpace(team.id);
              navigate("/projects");
            }}
          >
            {m.cloud.teamPage.back}
          </Button>
        }
      />
      {problem ? (
        <p className="cf-acct__problem" role="alert">
          {problem}
        </p>
      ) : null}

      <section className="cf-acct__card" aria-labelledby="cf-team-members">
        <h2 className="cf-acct__section-title" id="cf-team-members">
          {m.cloud.teamPage.members}
        </h2>
        <ul className="cf-acct__list">
          {members.map((member) => {
            const me = member.id === session.user.id;
            return (
              <li key={member.id} className="cf-acct__item">
                <span className="cf-acct__who">
                  <span className="cf-acct__name">
                    {member.name || member.email}
                    {me ? ` (${m.cloud.teamPage.you})` : ""}
                  </span>
                  <span className="cf-acct__meta">{member.email}</span>
                </span>
                <span className="cf-acct__row">
                  {owner ? (
                    <select
                      className="cf-acct__select"
                      aria-label={m.cloud.teamPage.roleOf(member.name || member.email)}
                      value={member.role}
                      onChange={(event) => void act((conn) => api.setRole(conn, team.id, member.id, event.target.value as Role))}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {roleWord(role)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="cf-acct__meta">{roleWord(member.role)}</span>
                  )}
                  {owner && !me ? (
                    <Button variant="ghost" size="sm" onClick={() => void remove(member)}>
                      {m.cloud.teamPage.remove(member.name || member.email)}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="cf-acct__row">
          <Button variant="secondary" onClick={() => void leave()}>
            {m.cloud.teamPage.leave}
          </Button>
        </div>
      </section>

      {owner ? (
        <section className="cf-acct__card" aria-labelledby="cf-team-invites" style={{ marginTop: 16 }}>
          <h2 className="cf-acct__section-title" id="cf-team-invites">
            {m.cloud.teamPage.invites}
          </h2>
          {invites.length ? (
            <ul className="cf-acct__list">
              {invites.map((invite) => (
                <li key={invite.id} className="cf-acct__item">
                  <span className="cf-acct__meta">{m.cloud.teamPage.inviteLine(roleWord(invite.role), invite.usesLeft, invite.expiresAt)}</span>
                  <Button variant="ghost" size="sm" onClick={() => void act((conn) => api.revokeInvite(conn, team.id, invite.id))}>
                    {m.cloud.teamPage.revoke}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cf-acct__text">{m.cloud.teamPage.noInvites}</p>
          )}
          <form className="cf-acct__form" onSubmit={(event) => void makeInvite(event)} aria-label={m.cloud.teamPage.newInvite}>
            <h3 className="cf-acct__label">{m.cloud.teamPage.newInvite}</h3>
            <div className="cf-acct__row">
              <label>
                <span className="cf-acct__label">{m.cloud.teamPage.inviteRole}</span>
                <select className="cf-acct__select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleWord(role)}
                    </option>
                  ))}
                </select>
              </label>
              <TextField label={m.cloud.teamPage.uses} type="number" min={1} max={100} value={uses} onChange={(e) => setUses(e.target.value)} />
              <TextField label={m.cloud.teamPage.hours} type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="cf-acct__row">
              <Button type="submit" variant="primary">
                {m.cloud.teamPage.makeInvite}
              </Button>
            </div>
          </form>
          {made ? (
            <div className="cf-acct__form" role="status">
              <p className="cf-acct__text">{m.cloud.teamPage.inviteMade}</p>
              <TextField
                label={m.cloud.teamPage.inviteLink}
                readOnly
                value={made}
                onFocus={(e) => e.currentTarget.select()}
                trailing={
                  <Button size="sm" variant="secondary" onClick={() => void copy(made)}>
                    {m.cloud.teamPage.copyLink}
                  </Button>
                }
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {owner ? (
        <section className="cf-acct__card" aria-labelledby="cf-team-settings" style={{ marginTop: 16 }}>
          <h2 className="cf-acct__section-title" id="cf-team-settings">
            {m.cloud.teamPage.rename}
          </h2>
          <form className="cf-acct__row" onSubmit={(event) => void rename(event)}>
            <TextField label={m.cloud.teamPage.renameLabel} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="secondary">
              {m.cloud.teamPage.save}
            </Button>
          </form>
          <div className="cf-acct__row">
            <Button variant="danger" onClick={() => void deleteTeam()}>
              {m.cloud.teamPage.deleteTeam}
            </Button>
          </div>
        </section>
      ) : null}
    </Page>
  );
}
