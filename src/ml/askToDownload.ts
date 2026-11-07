import { confirm } from "@/ui";
import { formatBytes, modelHost } from "./registry";
import type { ModelSpec } from "./types";

/** The one question before anything is downloaded: what, how big, from where, and that photos stay on the device. */
export function askToDownload(spec: ModelSpec): Promise<boolean> {
  const size = formatBytes(spec.bytes);
  return confirm({
    title: `Download the ${spec.tool.toLowerCase()}?`,
    message: `This tool runs an AI model on your device, so your photos are never uploaded. The model, ${spec.name}, is ${size}. It downloads once from ${modelHost(spec)} and stays on this device, so the tool then works offline. Licence: ${spec.licence.name}.`,
    confirmLabel: `Download ${size}`,
    cancelLabel: "Not now",
    // the dialog opens from a button that is often pressed with Enter: a second press must not agree to 88 MB
    focusCancel: true,
  });
}
