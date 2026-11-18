/**
 * `#/invite/<code>.<server>`: joining a team with an invite (src/cloud/inviteLink.ts). The link names the account server the team
 * is on; its host is shown plainly, so that a person sees where they make their account. Signed in, one button joins; signed out,
 * the person makes an account with the invite on that server (or signs in, and then joins). Signed in on another server, they are
 * told so and not offered to join: the invite is not that server's.
 */
import { useState } from "react";
import { cloudErrorText, hostOf } from "@/cloud/api";
import { redeemInvite } from "@/cloud/account";
import { parseInvite } from "@/cloud/inviteLink";
import { useCloud } from "@/cloud/state";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, toast } from "@/ui";
import { Page, PageHeader } from "../Page";
import { SignInPage } from "./SignInPage";
import "./account.css";

export function InvitePage({ code: part }: { code: string }) {
  const session = useCloud((s) => s.session);
  // a person who came signed out makes their account (or signs in) on this page, and joins with it: the page stays the sign-up
  // form until it is done, so that the recovery code is shown
  const [signedOut] = useState(() => !useCloud.getState().session);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invite = parseInvite(part);

  if (!invite) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.invite.title} subtitle={m.cloud.invite.notAnInvite} />
      </Page>
    );
  }
  const { code, server } = invite;
  if (!session || signedOut) return <SignInPage mode="signup" inviteCode={code} inviteServer={server ?? undefined} />;

  const elsewhere = server !== null && server !== session.server;
  const join = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const team = await redeemInvite(code);
      toast.success(m.cloud.invite.joined(team.name));
      navigate("/");
    } catch (error) {
      setProblem(cloudErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page className="cf-acct">
      <PageHeader title={m.cloud.invite.title} subtitle={m.cloud.invite.body} />
      <div className="cf-acct__card">
        <p className="cf-acct__text">{m.cloud.invite.server(hostOf(server ?? session.server))}</p>
        <p className="cf-acct__text">{m.cloud.signIn.signedIn(session.user.name)}</p>
        {elsewhere ? (
          <p className="cf-acct__problem" role="alert">
            {m.cloud.invite.otherServer(hostOf(server), hostOf(session.server))}
          </p>
        ) : null}
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
        {elsewhere ? null : (
          <div className="cf-acct__row">
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void join()}>
              {busy ? m.cloud.invite.working : m.cloud.invite.join}
            </Button>
          </div>
        )}
      </div>
    </Page>
  );
}
