import { m } from "@/i18n";
import { confirm } from "@/ui";
import { formatBytes, modelHost } from "./registry";
import type { ModelSpec } from "./types";

/** The one question before anything is downloaded: what, how big, from where, and that photos stay on the device. */
export function askToDownload(spec: ModelSpec): Promise<boolean> {
  const size = formatBytes(spec.bytes);
  return confirm({
    title: m.ml.ask.title(spec.tool),
    message: m.ml.ask.message(spec.name, size, modelHost(spec), spec.licence.name),
    confirmLabel: m.ml.ask.confirm(size),
    cancelLabel: m.ml.ask.notNow,
    // the dialog opens from a button that is often pressed with Enter: a second press must not agree to 88 MB
    focusCancel: true,
  });
}
