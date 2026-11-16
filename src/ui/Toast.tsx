import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { m } from "@/i18n";
import "./Toast.css";
import { cx } from "./cx";
import { IconAlert, IconClose, IconInfo, IconSuccess } from "./icons";
import { getOverlayRoot } from "./overlay";

export type ToastKind = "info" | "success" | "error";

export interface ToastOptions {
  message: ReactNode;
  kind?: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
  /** auto-dismiss delay in ms (default 4000). 0 keeps the toast until it is dismissed. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  duration: number;
  leaving: boolean;
}

const MAX_VISIBLE = 4;
const EXIT_MS = 200;

let items: ToastItem[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getItems(): ToastItem[] {
  return items;
}

function remove(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

function dismiss(id: number): void {
  const target = items.find((item) => item.id === id);
  if (!target || target.leaving) return;
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
  window.setTimeout(() => remove(id), EXIT_MS);
}

function show(options: ToastOptions): number {
  sequence += 1;
  const id = sequence;
  items = [...items, { ...options, id, kind: options.kind ?? "info", duration: options.duration ?? 4000, leaving: false }];
  emit();
  // Keep the stack short: retire the oldest toasts first, those that leave by themselves before those that stay until they
  // are dismissed (a notice that nobody has answered must not be pushed out by chatter), and never the one just raised.
  const others = items.filter((item) => !item.leaving && item.id !== id);
  const retire = [...others.filter((item) => item.duration > 0), ...others.filter((item) => item.duration <= 0)];
  for (const old of retire.slice(0, Math.max(0, others.length + 1 - MAX_VISIBLE))) dismiss(old.id);
  return id;
}

/** Imperative toast API. Requires `<ToastHost />` somewhere in the tree. */
export const toast = {
  show,
  info: (message: ReactNode, options?: Omit<ToastOptions, "message" | "kind">) => show({ ...options, message, kind: "info" }),
  success: (message: ReactNode, options?: Omit<ToastOptions, "message" | "kind">) => show({ ...options, message, kind: "success" }),
  error: (message: ReactNode, options?: Omit<ToastOptions, "message" | "kind">) => show({ ...options, message, kind: "error" }),
  dismiss,
  clear: () => items.forEach((item) => dismiss(item.id)),
};

const ICONS: Record<ToastKind, ReactNode> = {
  info: <IconInfo aria-hidden="true" />,
  success: <IconSuccess aria-hidden="true" />,
  error: <IconAlert aria-hidden="true" />,
};

/** Renders the toast stack (bottom centre). Mount once near the app root. */
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, getItems, getItems);
  if (list.length === 0) return null;
  return createPortal(
    <div className="cf-toasts" role="region" aria-label={m.ui.toast.region}>
      {list.map((item) => (
        <ToastView key={item.id} item={item} />
      ))}
    </div>,
    getOverlayRoot(),
  );
}

function ToastView({ item }: { item: ToastItem }) {
  const timer = useRef(0);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  const { id, duration, leaving } = item;

  const start = () => {
    if (duration <= 0 || leaving) return;
    window.clearTimeout(timer.current);
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => dismiss(id), remaining.current);
  };
  const pause = () => {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
    remaining.current = Math.max(1200, remaining.current - (Date.now() - startedAt.current));
  };

  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cx("cf-toast", `cf-toast--${item.kind}`, leaving && "is-leaving")}
      role={item.kind === "error" ? "alert" : "status"}
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <span className="cf-toast__icon">{ICONS[item.kind]}</span>
      <span className="cf-toast__message">{item.message}</span>
      {item.actionLabel ? (
        <button
          type="button"
          className="cf-toast__action"
          onClick={() => {
            item.onAction?.();
            dismiss(id);
          }}
        >
          {item.actionLabel}
        </button>
      ) : null}
      <button type="button" className="cf-toast__close" aria-label={m.ui.toast.dismiss} onClick={() => dismiss(id)}>
        <IconClose aria-hidden="true" />
      </button>
    </div>
  );
}
