/**
 * `#/invite/<code>`: joining a team with an invite. Signed in, one button joins; signed out, the person makes an account with the
 * invite (or signs in, and then joins).
 */
import { useState } from "react";
import { cloudErrorText, hostOf } from "@/cloud/api";
import { redeemInvite } from "@/cloud/account";
import { useCloud } from "@/cloud/state";
import { CODE } from "@/cloud/validate";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, toast } from "@/ui";
import { Page, PageHeader } from "../Page";
import { SignInPage } from "./SignInPage";
import "./account.css";

export function InvitePage({ code }: { code: string }) {
  const session = useCloud((s) => s.session);
  // a person who came signed out makes their account (or signs in) on this page, and joins with it: the page stays the sign-up
  // form until it is done, so that the recovery code is shown
  const [signedOut] = useState(() => !useCloud.getState().session);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!CODE.test(code)) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.invite.title} subtitle={m.cloud.invite.notAnInvite} />
      </Page>
    );
  }
  if (!session || signedOut) return <SignInPage mode="signup" inviteCode={code} />;

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
        <p className="cf-acct__text">{m.cloud.invite.server(hostOf(session.server))}</p>
        <p className="cf-acct__text">{m.cloud.signIn.signedIn(session.user.name)}</p>
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="cf-acct__row">
          <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void join()}>
            {busy ? m.cloud.invite.working : m.cloud.invite.join}
          </Button>
        </div>
      </div>
    </Page>
  );
}
