/**
 * Putting a sound of the uploads on the design: a track that starts where the timeline's playhead is (at the start when the timeline
 * is closed), whole, playing once. The timeline opens and the new sound is chosen, so its controls are at hand.
 */
import { audioInfo, assetSrc } from "@/core/assets";
import { MAX_TRACKS, createAudioTrack } from "@/core/audioTracks";
import { useEditor } from "@/core/store";
import type { Asset } from "@/core/types";
import { m } from "@/i18n";
import { toast } from "@/ui";
import { chooseTrack, setTimelineOpen, useTimeline } from "./timelineStore";

/** Adds `asset` (a sound of the uploads) to the design as a track; its id, or "" when nothing was added (no design, too many sounds). */
export async function addSoundToDesign(asset: Pick<Asset, "id" | "name" | "blob">, known = 0): Promise<string> {
  const s = useEditor.getState();
  if (!s.design || s.mode === "view") return "";
  if ((s.design.audio?.length ?? 0) >= MAX_TRACKS) {
    toast.error(m.panelsTabs.uploads.tooManySounds(MAX_TRACKS));
    return "";
  }
  const duration = known > 0 ? known : ((await audioInfo(asset.blob))?.duration ?? 0);
  const timeline = useTimeline.getState();
  const track = createAudioTrack({ src: assetSrc(asset.id), name: asset.name, duration, startAt: timeline.open ? timeline.time : 0 });
  if (!useEditor.getState().actions.addAudioTrack(track)) return "";
  setTimelineOpen(true);
  chooseTrack(track.id);
  toast.success(m.panelsTabs.uploads.soundAdded(asset.name));
  return track.id;
}
