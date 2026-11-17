/** A recovery code, shown once (after a sign-up, after a reset with the old one): to copy or write down, and "I have kept it". */
import { m } from "@/i18n";
import { Button, toast } from "@/ui";
import "./account.css";

export function RecoveryCode({ code, onDone, lead }: { code: string; onDone: () => void; lead?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(m.cloud.recovery.copied);
    } catch {
      /* the code is on the screen to write down */
    }
  };
  return (
    <div className="cf-acct__card">
      {lead ? <p className="cf-acct__text">{lead}</p> : null}
      <p className="cf-acct__text">{m.cloud.recovery.body}</p>
      <div>
        <span className="cf-acct__label" id="cf-recovery-label">
          {m.cloud.recovery.code}
        </span>
        <p className="cf-acct__code" aria-labelledby="cf-recovery-label" data-testid="recovery-code">
          {code}
        </p>
      </div>
      <div className="cf-acct__row">
        <Button variant="secondary" onClick={() => void copy()}>
          {m.cloud.recovery.copy}
        </Button>
        <Button variant="primary" onClick={onDone}>
          {m.cloud.recovery.kept}
        </Button>
      </div>
    </div>
  );
}
