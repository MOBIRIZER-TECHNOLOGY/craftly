/**
 * `#/reset/<code>` (a one-time link from the operator, `scripts/accounts.mjs reset`) and `#/reset` (with the email and the recovery
 * code shown at sign-up): a new password. Every session of the person ends; a reset with the recovery code uses it up and shows a
 * new one.
 */
import { useState, type FormEvent } from "react";
import { cloudErrorText, resetPassword } from "@/cloud/api";
import { CODE } from "@/cloud/validate";
import { m } from "@/i18n";
import { Button, TextField } from "@/ui";
import { Page, PageHeader } from "../Page";
import { RecoveryCode } from "./RecoveryCode";
import { checkedServer, ServerField, startingServer } from "./ServerField";
import "./account.css";

export function ResetPage({ code }: { code?: string }) {
  const withCode = !!code && CODE.test(code);
  const [server, setServer] = useState(startingServer);
  const [serverError, setServerError] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [recovery, setRecovery] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ recoveryCode?: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const to = checkedServer(server);
    if (!to) {
      setServerError(m.cloud.server.invalid);
      return;
    }
    setServerError(undefined);
    if ([...password.normalize("NFC")].length < 10) {
      setProblem(m.cloud.signUp.tooShort);
      return;
    }
    setBusy(true);
    try {
      const body = withCode ? { code: code as string, newPassword: password } : { email: email.trim(), recoveryCode: recovery.trim(), newPassword: password };
      setDone(await resetPassword({ server: to, token: null }, body));
    } catch (error) {
      setProblem(cloudErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Page className="cf-acct">
        <PageHeader title={m.cloud.reset.title} subtitle={m.cloud.reset.done} />
        {done.recoveryCode ? <RecoveryCode code={done.recoveryCode} lead={m.cloud.reset.newRecovery} onDone={() => (window.location.hash = "#/signin")} /> : null}
        {done.recoveryCode ? null : (
          <p>
            <a href="#/signin">{m.cloud.signIn.title}</a>
          </p>
        )}
      </Page>
    );
  }

  return (
    <Page className="cf-acct">
      <PageHeader title={m.cloud.reset.title} subtitle={withCode ? m.cloud.reset.withCode : m.cloud.reset.withRecovery} />
      <form className="cf-acct__card cf-acct__form" onSubmit={(event) => void submit(event)} aria-label={m.cloud.reset.title} noValidate>
        <ServerField value={server} onChange={setServer} error={serverError} />
        {withCode ? null : (
          <>
            <TextField
              label={m.cloud.reset.email}
              type="email"
              name="email"
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField label={m.cloud.reset.recoveryCode} name="recovery" autoComplete="off" spellCheck={false} value={recovery} onChange={(e) => setRecovery(e.target.value)} />
          </>
        )}
        <TextField
          label={m.cloud.reset.newPassword}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {problem ? (
          <p className="cf-acct__problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="cf-acct__row">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? m.cloud.reset.working : m.cloud.reset.submit}
          </Button>
          <a href="#/signin">{m.cloud.signIn.title}</a>
        </div>
      </form>
    </Page>
  );
}
