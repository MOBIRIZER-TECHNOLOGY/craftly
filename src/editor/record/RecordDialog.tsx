import { useEffect, useRef, useState } from "react";
import { addAssetFromFile, assetSrc, videoInfo } from "@/core/assets";
import { insertVideo } from "@/editor/insert";
import { m } from "@/i18n";
import { clipClock } from "@/render/videos";
import { Button, Checkbox, IconCamera, IconDesktop, IconRecord, IconStop, Modal, Segmented } from "@/ui";
import {
  MAX_RECORDING_SECONDS,
  openStream,
  problemOf,
  record,
  recordingName,
  recordingSupport,
  stopStream,
  type RecordProblem,
  type RecordSource,
  type Recording,
} from "./recorder";
import "./recordDialog.css";

type Phase =
  | { kind: "ready" }
  | { kind: "starting" }
  | { kind: "recording"; since: number }
  | { kind: "review"; blob: Blob; url: string; seconds: number }
  | { kind: "saving"; blob: Blob; url: string; seconds: number };

type Problem = RecordProblem | "recorder" | "save" | "empty";

/**
 * Records a clip with the camera or of the screen, with the microphone or without, and puts it on the page: Start asks the browser
 * for the camera or the screen (it asks the person), the live picture shows while it records, Stop shows the recording to watch,
 * and **Add to the page** keeps it in the uploads and places it as a clip. Closing the dialog stops everything and keeps nothing.
 */
export function RecordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const words = m.panelsTabs.recording;
  const support = recordingSupport();
  const [source, setSource] = useState<RecordSource>(support.camera || !support.screen ? "camera" : "screen");
  const [sound, setSound] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [now, setNow] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const take = useRef<Recording | null>(null);
  const live = useRef<HTMLVideoElement>(null);
  const urlRef = useRef<string | null>(null);

  const release = () => {
    take.current?.stop();
    take.current = null;
    stopStream(stream.current);
    stream.current = null;
  };
  const forgetTake = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  // closing the dialog (or leaving the editor) stops the camera and the recording, and keeps nothing
  useEffect(() => {
    if (open) return;
    release();
    forgetTake();
    setPhase({ kind: "ready" });
    setProblem(null);
  }, [open]);
  useEffect(
    () => () => {
      release();
      forgetTake();
    },
    [],
  );

  // the clock while it records
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const tick = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(tick);
  }, [phase.kind]);

  const start = async () => {
    setProblem(null);
    forgetTake();
    setPhase({ kind: "starting" });
    let media: MediaStream;
    try {
      media = await openStream(source, sound);
    } catch (error) {
      setProblem(problemOf(error));
      setPhase({ kind: "ready" });
      return;
    }
    stream.current = media;
    if (live.current) {
      live.current.srcObject = media;
      void live.current.play()?.catch(() => undefined);
    }
    const since = performance.now();
    const recording = record(media);
    take.current = recording;
    setNow(since);
    setPhase({ kind: "recording", since });
    try {
      const blob = await recording.done;
      if (take.current !== recording) return;
      take.current = null;
      stopStream(media);
      stream.current = null;
      if (!blob.size) {
        setProblem("empty");
        setPhase({ kind: "ready" });
        return;
      }
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPhase({ kind: "review", blob, url, seconds: (performance.now() - since) / 1000 });
    } catch {
      if (take.current !== recording) return;
      release();
      setProblem("recorder");
      setPhase({ kind: "ready" });
    }
  };

  const stop = () => take.current?.stop();

  const again = () => {
    forgetTake();
    setProblem(null);
    setPhase({ kind: "ready" });
  };

  const add = async () => {
    if (phase.kind !== "review") return;
    setPhase({ ...phase, kind: "saving" });
    const type = phase.blob.type || "video/webm";
    try {
      const asset = await addAssetFromFile(new File([phase.blob], recordingName(new Date(), type), { type }));
      // a browser's own recording does not say its length until it has been read to the end: videoInfo finds it
      const info = await videoInfo(asset.blob);
      insertVideo(assetSrc(asset.id), asset.width, asset.height, info?.duration || phase.seconds || 1, undefined, asset.name);
      onClose();
    } catch {
      setProblem("save");
      setPhase({ ...phase, kind: "review" });
    }
  };

  const recording = phase.kind === "recording";
  const busy = phase.kind === "starting" || phase.kind === "saving";
  const reviewing = phase.kind === "review" || phase.kind === "saving";
  const can = source === "camera" ? support.camera : support.screen;

  const footer = reviewing ? (
    <>
      <Button variant="ghost" onClick={again} disabled={busy}>
        {words.again}
      </Button>
      <Button variant="primary" onClick={() => void add()} loading={phase.kind === "saving"}>
        {words.add}
      </Button>
    </>
  ) : recording ? (
    <Button variant="danger" icon={<IconStop />} onClick={stop}>
      {words.stop}
    </Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>
        {words.cancel}
      </Button>
      <Button variant="primary" icon={<IconRecord />} onClick={() => void start()} disabled={!can} loading={phase.kind === "starting"}>
        {words.start}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={words.title} size="md" footer={footer} className="cf-record">
      {!support.camera && !support.screen ? (
        <p className="cf-record__problem" role="alert">
          {words.unsupported}
        </p>
      ) : (
        <>
          {!reviewing && (
            <div className="cf-record__choices">
              <Segmented
                aria-label={words.source}
                fullWidth
                value={source}
                onChange={(next) => !recording && !busy && setSource(next)}
                options={[
                  { value: "camera", label: words.camera, icon: <IconCamera /> },
                  { value: "screen", label: words.screen, icon: <IconDesktop /> },
                ]}
              />
              <Checkbox checked={sound} onChange={setSound} label={words.sound} disabled={recording || busy} />
            </div>
          )}
          <div className={`cf-record__stage${source === "camera" && !reviewing ? " is-mirrored" : ""}`}>
            {/* the live picture: kept mounted so that its stream can be given to it before it records */}
            <video ref={live} className="cf-record__live" hidden={reviewing} muted playsInline aria-label={words.live} />
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the person's own recording, just made: there are no captions of it yet (they are added on the page) */}
            {reviewing && <video key={phase.url} className="cf-record__take" src={phase.url} controls playsInline aria-label={words.take} />}
            {recording && (
              <span className="cf-record__clock" role="timer" aria-live="off">
                <span className="cf-record__dot" aria-hidden="true" />
                {words.clock(clipClock((now - phase.since) / 1000), clipClock(MAX_RECORDING_SECONDS))}
              </span>
            )}
          </div>
          {reviewing ? (
            <p className="cf-record__hint" role="status">
              {phase.kind === "saving" ? words.saving : words.length(clipClock(phase.seconds))}
            </p>
          ) : (
            !recording && <p className="cf-record__hint">{source === "camera" ? words.cameraHint : words.screenHint}</p>
          )}
          {!can && !reviewing && <p className="cf-record__problem">{words.problems.unsupported}</p>}
          {problem && (
            <p className="cf-record__problem" role="alert">
              {words.problems[problem]}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
