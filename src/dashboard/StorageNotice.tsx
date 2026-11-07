import { Button, IconWarning } from "@/ui";
import { designsStore } from "./data";
import "./StorageNotice.css";

/** Shown when IndexedDB can not be opened (private windows in some browsers, blocked site data). */
export function StorageNotice({ detail }: { detail: string }) {
  return (
    <div className="cf-dstorage" role="alert">
      <IconWarning className="cf-dstorage__icon" aria-hidden="true" />
      <p className="cf-dstorage__text">
        <strong>Craftly can't reach this browser's local storage.</strong> Designs can't be saved or listed right now. If this is a private window, open a normal one, and check
        that site data is allowed. ({detail})
      </p>
      <Button size="sm" variant="secondary" onClick={() => designsStore.reload()}>
        Try again
      </Button>
    </div>
  );
}
