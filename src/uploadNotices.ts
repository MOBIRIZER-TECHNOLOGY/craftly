/**
 * Tells the person when an SVG was not kept as an SVG. An uploaded SVG that is more than plain drawing (a style sheet, a comment,
 * a script, a link) is drawn and stored as a PNG picture (checkUpload in src/core/assets.ts), wherever it came from: the upload
 * field, a drop, a project file, a backup, somebody else in a shared design. The picture looks the same, but it is no longer a
 * vector, so the person is told, once for a batch of them.
 */
import { subscribeFlattenedSvg } from "@/core/assets";
import { toast } from "@/ui";

export const FLATTENED_SVG_NOTICE = "This SVG had parts Craftly does not keep, so it was added as a picture.";

/** How long the notice stays, and how long another SVG of the same kind is not announced again. */
const NOTICE_MS = 8000;

export function installUploadNotices(now: () => number = Date.now): () => void {
  let last = -Infinity;
  return subscribeFlattenedSvg(() => {
    if (now() - last < NOTICE_MS) return;
    last = now();
    toast.info(FLATTENED_SVG_NOTICE, { duration: NOTICE_MS });
  });
}
