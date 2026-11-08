import { DATABASE_NEWER_MESSAGE } from "@/core/schema/database";
import { Button, IconWarning } from "@/ui";
import { designsStore } from "./data";
import "./StorageNotice.css";

/**
 * Shown when IndexedDB can not be opened (private windows in some browsers, blocked site data), or when it can, but a newer
 * Craftly upgraded it and this tab, which runs an older one, must not touch it: that one needs a reload, not advice about storage.
 */
export function StorageNotice({ detail }: { detail: string }) {
  if (detail === DATABASE_NEWER_MESSAGE) {
    return (
      <div className="cf-dstorage" role="alert">
        <IconWarning className="cf-dstorage__icon" aria-hidden="true" />
        <p className="cf-dstorage__text">
          <strong>This tab is older than your designs.</strong> {detail}
        </p>
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
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
