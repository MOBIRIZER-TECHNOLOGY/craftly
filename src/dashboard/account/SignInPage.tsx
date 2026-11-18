/**
 * `#/signin` and `#/signup` (docs/ACCOUNTS.md, "Client"): signing in to an account server, or making an account there, with the
 * server's host shown plainly. The fields carry `autocomplete` so that a password manager fills and keeps them. After a sign-up the
 * recovery code is shown once. After either, a person with designs on this device only is asked whether to move them in.
 * With `inviteCode` (the invite page), a new account is made with the invite and an existing one joins the team after signing in;
 * `inviteServer` is the account server the invite link names, which the form starts with (its host shown plainly) over any other.
 */
import { useState, type FormEvent } from "react";
import { cloudErrorText, hostOf } from "@/cloud/api";
import { localOnlyDesigns, redeemInvite, signInAccount, signUpAccount } from "@/cloud/account";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, TextField, toast } from "@/ui";
import { Page, PageHeader } from "../Page";
import { openAccountDialog } from "./dialogState";
import { checkedServer, ServerField, startingServer } from "./ServerField";
import { RecoveryCode } from "./RecoveryCode";
import "./account.css";

const MIN_PASSWORD = 10;

/** After signing in or up: the dashboard, and the question of moving designs in when there are designs on this device only. */
async function arrive(): Promise<void> {
  navigate("/");
  const local = await localOnlyDesigns().catch(() => []);
  if (local.length) openAccountDialog("move");
}

export function SignInPage({ mode, inviteCode, inviteServer }: { mode: "signin" | "signup"; inviteCode?: string; inviteServer?: string }) {
  const [current, setMode] = useState(mode);
  const [server, setServer] = useState(() => inviteServer ?? startingServer());
  const [serverError, setServerError] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(inviteCode ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [recovery, setRecovery] = useState<string | null>(null);
  const signingUp = current === "signup";

  const switchTo = (next: "signin" | "signup") => {
    setProblem(null);
    setPasswordError(undefined);
    if (inviteCode) setMode(next);
    else navigate(next === "signup" ? "/signup" : "/signin");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setPasswordError(undefined);
    const to = checkedServer(server);
    if (!to) {
      setServerError(m.cloud.server.invalid);
      return;
    }
    setServerError(undefined);
    if (signingUp && [...password.normalize("NFC")].length < MIN_PASSWORD) {
      setPasswordError(m.cloud.signUp.tooShort);
      return;
    }
    setBusy(true);
    try {
      if (signingUp) {
        const made = await signUpAccount(to, { email: email.trim(), password, name: name.trim(), ...(code.trim() ? { code: code.trim() } : {}) });
        if (made.team) toast.success(m.cloud.invite.joined(made.team.name));
        if (made.recoveryCode) {
          setRecovery(made.recoveryCode);
          return;
        }
      } else {
        await signInAccount(to, email.trim(), password);
        if (inviteCode) {
          const team = await redeemInvite(inviteCode);
          toast.success(m.cloud.invite.joined(team.name));
        }
      }
      await arrive();
    } catch (error) {
      setProblem(cloudErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.recovery.title} />
        <RecoveryCode code={recovery} onDone={() => void arrive()} />
      </Page>
    );
  }

  const title = signingUp ? m.cloud.signUp.title : m.cloud.signIn.title;
  return (
    <Page className="cf-acct">
      <PageHeader title={inviteCode ? m.cloud.invite.title : title} subtitle={inviteCode ? m.cloud.invite.signInFirst : m.cloud.signIn.intro} />
      <form className="cf-acct__card cf-acct__form" onSubmit={(event) => void submit(event)} aria-label={title} noValidate>
        {inviteCode ? <h2 className="cf-acct__section-title">{title}</h2> : null}
        {inviteServer ? <p className="cf-acct__text">{m.cloud.invite.server(hostOf(inviteServer))}</p> : null}
        <ServerField value={server} onChange={setServer} error={serverError} />
        {signingUp ? (
          <TextField label={m.cloud.signUp.name} name="name" autoComplete="name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        ) : null}
        <TextField
          label={signingUp ? m.cloud.signUp.email : m.cloud.signIn.email}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          spellCheck={false}
          autoCapitalize="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label={signingUp ? m.cloud.signUp.password : m.cloud.signIn.password}
          name="password"
          type="password"
          autoComplete={signingUp ? "new-password" : "current-password"}
          required
          minLength={signingUp ? MIN_PASSWORD : undefined}
          hint={signingUp ? m.cloud.signUp.passwordHint : undefined}
          error={passwordError}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {signingUp && !inviteCode ? (
          <TextField label={m.cloud.signUp.code} name="code" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        ) : null}
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="cf-acct__row">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? (signingUp ? m.cloud.signUp.working : m.cloud.signIn.working) : signingUp ? m.cloud.signUp.submit : m.cloud.signIn.submit}
          </Button>
        </div>
        <div className="cf-acct__links">
          {signingUp ? (
            <span>
              {m.cloud.signUp.haveAccount}{" "}
              <Button variant="ghost" size="sm" onClick={() => switchTo("signin")}>
                {m.cloud.signUp.signInInstead}
              </Button>
            </span>
          ) : (
            <span>
              {m.cloud.signIn.noAccount}{" "}
              <Button variant="ghost" size="sm" onClick={() => switchTo("signup")}>
                {m.cloud.signIn.createOne}
              </Button>
            </span>
          )}
          {signingUp ? null : <a href="#/reset">{m.cloud.signIn.forgot}</a>}
          <a href="#/">{m.cloud.signIn.back}</a>
        </div>
      </form>
    </Page>
  );
}
