import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { m } from "@/i18n";
import "./Confirm.css";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  /** default "Confirm" ("Delete" is a good label for destructive prompts) */
  confirmLabel?: string;
  /** default "Cancel" */
  cancelLabel?: string;
  /** red confirm button; focus starts on Cancel so Enter cannot destroy anything by accident */
  danger?: boolean;
  /** focus starts on Cancel, the safe answer, without the red button: for a question where a held or doubled Enter must not say yes */
  focusCancel?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

let queue: PendingConfirm[] = [];
let sequence = 0;
let mountedHosts = 0;
let warned = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getQueue(): PendingConfirm[] {
  return queue;
}

function plainText(node: ReactNode, fallback: string): string {
  return typeof node === "string" ? node : fallback;
}

/**
 * Asks the user to confirm an action. Resolves `true` on confirm, `false` on cancel / Esc / backdrop click.
 * Requires `<ConfirmHost />` somewhere in the tree; without one it falls back to `window.confirm`.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (mountedHosts === 0) {
    if (!warned) {
      warned = true;
      console.warn("[ui] confirm() called without a mounted <ConfirmHost />; falling back to window.confirm.");
    }
    const text = plainText(options.message, plainText(options.title, m.ui.confirm.areYouSure));
    return Promise.resolve(window.confirm(text));
  }
  return new Promise<boolean>((resolve) => {
    sequence += 1;
    queue = [...queue, { ...options, id: sequence, resolve }];
    emit();
  });
}

/** Renders the confirm dialogs requested through `confirm()`. Mount once near the app root. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribe, getQueue, getQueue);
  const current = pending[0];
  // Keep showing the last request while the dialog plays its exit animation.
  const shown = useRef<PendingConfirm | undefined>(undefined);
  if (current) shown.current = current;
  const view = shown.current;

  useEffect(() => {
    mountedHosts += 1;
    return () => {
      mountedHosts -= 1;
    };
  }, []);

  const settle = (value: boolean) => {
    if (!current) return;
    queue = queue.filter((item) => item.id !== current.id);
    emit();
    current.resolve(value);
  };

  return (
    <Modal
      open={current !== undefined}
      onClose={() => settle(false)}
      size="sm"
      title={view?.title}
      hideClose
      className="cf-confirm"
      footer={
        view ? (
          <>
            <Button variant="secondary" onClick={() => settle(false)} data-autofocus={view.danger || view.focusCancel ? "" : undefined}>
              {view.cancelLabel ?? m.common.cancel}
            </Button>
            <Button variant={view.danger ? "danger" : "primary"} onClick={() => settle(true)} data-autofocus={view.danger || view.focusCancel ? undefined : ""}>
              {view.confirmLabel ?? m.ui.confirm.confirm}
            </Button>
          </>
        ) : null
      }
    >
      {view?.message ? <p className="cf-confirm__message">{view.message}</p> : null}
    </Modal>
  );
}
