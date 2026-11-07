/**
 * `promptText()` - a small "type a name" dialog (rename, new folder), the text twin of the kit's `confirm()`.
 * Resolves with the trimmed text, or null when cancelled. Mount <PromptHost /> once (the Dashboard does).
 */
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Button, Modal, TextField } from "@/ui";
import "./prompt.css";

export interface PromptOptions {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  /** default "Save" */
  confirmLabel?: string;
  hint?: string;
  maxLength?: number;
}

interface PendingPrompt extends PromptOptions {
  id: number;
  resolve: (value: string | null) => void;
}

let queue: PendingPrompt[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
const getQueue = () => queue;

export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    sequence += 1;
    queue = [...queue, { ...options, id: sequence, resolve }];
    emit();
  });
}

export function PromptHost() {
  const pending = useSyncExternalStore(subscribe, getQueue, getQueue);
  const current = pending[0];
  // keep the last request rendered while the dialog plays its exit animation
  const shown = useRef<PendingPrompt | undefined>(undefined);
  if (current) shown.current = current;
  const view = shown.current;

  const settle = (value: string | null) => {
    if (!current) return;
    queue = queue.filter((item) => item.id !== current.id);
    emit();
    current.resolve(value);
  };

  return (
    <Modal open={current !== undefined} onClose={() => settle(null)} size="sm" title={view?.title} hideClose className="cf-prompt">
      {view ? <PromptForm key={view.id} request={view} onSettle={settle} /> : null}
    </Modal>
  );
}

function PromptForm({ request, onSettle }: { request: PromptOptions; onSettle: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const trimmed = value.trim();

  const submit = () => {
    if (trimmed) onSettle(trimmed);
  };

  return (
    <form
      id={formId}
      className="cf-prompt__form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField
        ref={inputRef}
        label={request.label}
        value={value}
        placeholder={request.placeholder}
        hint={request.hint}
        maxLength={request.maxLength ?? 120}
        size="lg"
        autoComplete="off"
        spellCheck={false}
        data-autofocus=""
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="cf-prompt__actions">
        <Button variant="secondary" onClick={() => onSettle(null)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!trimmed}>
          {request.confirmLabel ?? "Save"}
        </Button>
      </div>
    </form>
  );
}
