import { useEffect, useState, type ReactNode } from "react";
import { getActions } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { askToDownload } from "@/ml/askToDownload";
import { BLUR_STRENGTHS, type BlurStrength } from "@/ml/blur";
import { POP_STYLES, type PopStyle } from "@/ml/colourPop";
import type { Support } from "@/ml/device";
import { asMlError } from "@/ml/errors";
import { INSTALL_TEXT, remainingText, STAGE_TEXT } from "@/ml/labels";
import { DEFAULT_MODEL, formatBytes, getModelSpec } from "@/ml/registry";
import { blurBackground, colourPop, refreshModels, removeBackground, restoreOriginal, upscale } from "@/ml/service";
import { modelStatus, useMlStore, type InstallState, type JobKind, type JobState } from "@/ml/state";
import { UPSCALE_FACTORS, upscaleChoices } from "@/ml/tiles";
import type { MlTask } from "@/ml/types";
import { useSupport } from "@/ml/useSupport";
import { Badge, Button, IconAlert, IconAperture, IconContrast, IconRotateLeft, IconSparkle, IconSuccess, IconWand, Progress, Segmented, Spinner, toast } from "@/ui";
import { Section } from "./PanelShell";
import "./ToolsTab.css";

/** A photo of this many pixels or more takes a minute or more on a laptop graphics card (about 30 seconds a megapixel). */
const SLOW_PIXELS = 1_500_000;

const pixels = (n: number) => n.toLocaleString("en-US");

/** Photo tools that run an AI model on this device: Remove background, Blur background, Colour pop and Upscale. */
export function ToolsTab({ photos }: { photos: ImageElement[] }) {
  const photo = photos.length === 1 ? photos[0]! : null;
  // the browser as such (background tasks, storage, WebGPU) holds for every tool; a missing graphics-card feature only for the tool that needs it
  const browser = useSupport([]);

  useEffect(() => {
    void refreshModels().catch(() => undefined);
  }, []);

  return (
    <>
      <Notices photo={photo} browser={browser} />
      <RemoveBackgroundTool photo={photo} browser={browser} />
      <BlurBackgroundTool photo={photo} browser={browser} />
      <ColourPopTool photo={photo} browser={browser} />
      <UpscaleTool photo={photo} browser={browser} />
      <OriginalPhoto photo={photo} />
      <Section title="On-device models">
        <p className="cf-ctx__hint cf-tool__lede">Models stay on this device. See what is installed, free up space, or add a model from a file.</p>
        <Button size="sm" variant="secondary" onClick={() => getActions().openDialog("models")}>
          Manage models
        </Button>
      </Section>
    </>
  );
}

const warning = (message: string) => (
  <p className="cf-tool__note cf-tool__note--warn">
    <IconAlert aria-hidden="true" />
    <span>{message}</span>
  </p>
);

/**
 * What holds for every tool: the browser cannot run them, no single photo is selected, a tool is working on this photo (the
 * others wait: said once, not under each of them), or a job on another photo is running.
 */
function Notices({ photo, browser }: { photo: ImageElement | null; browser: Support | null }) {
  const job = useMlStore((s) => s.job);
  return (
    <>
      {browser && !browser.ok ? warning(browser.message) : null}
      {job && photo && job.elementId === photo.id ? <p className="cf-tool__note">A photo tool is working on this photo.</p> : null}
      {job && job.elementId !== photo?.id ? (
        <p className="cf-tool__note cf-tool__note--action">
          <span>Another photo is being processed.</span>
          <Button size="sm" variant="secondary" onClick={() => job.cancel()}>
            Cancel
          </Button>
        </p>
      ) : null}
      {!photo ? <p className="cf-tool__note">Select one photo to use these tools.</p> : null}
    </>
  );
}

/** The tool a download is shown under when no tool asked for it (the person chose to install the model): the first to use it. */
const FIRST_TOOL: Record<MlTask, JobKind> = { "background-removal": "remove-background", upscaling: "upscale" };

/** What a tool's section needs to know about its model, the running job and the device. */
function useTool(task: MlTask, kind: JobKind, photo: ImageElement | null, browser: Support | null) {
  const spec = getModelSpec(DEFAULT_MODEL[task])!;
  const status = useMlStore((s) => modelStatus(spec, s));
  const downloading = useMlStore((s) => s.installing[spec.id]);
  // two tools can share a model: its download is shown under the tool that asked for it, once, but holds up both
  const install = downloading && (downloading.requestedBy ?? FIRST_TOOL[task]) === kind ? downloading : undefined;
  const job = useMlStore((s) => s.job);
  const own = useSupport(spec.gpuFeatures, browser?.ok === true && spec.gpuFeatures.length > 0);
  const lacking = own && !own.ok ? own : null;
  const working = !!job && job.kind === kind && !!photo && job.elementId === photo.id;
  const canStart = !!photo && !photo.locked && browser?.ok !== false && !lacking && !job && !downloading;
  return { spec, status, install, job, working, lacking, canStart };
}

type Tool = ReturnType<typeof useTool>;

/** The note under a tool's button: the first thing that stands in the way of it, or what the first use costs. */
function toolNote(tool: Tool, photo: ImageElement | null, locked: string): ReactNode {
  if (tool.lacking) return warning(tool.lacking.message);
  if (photo?.locked) return <p className="cf-tool__note">{locked}</p>;
  if (photo && tool.status !== "ready" && tool.status !== "unknown") {
    return <p className="cf-tool__note">One-time download of {formatBytes(tool.spec.bytes)}. After that it works offline.</p>;
  }
  return null;
}

/* ---------------- Remove background ---------------- */

function RemoveBackgroundTool({ photo, browser }: { photo: ImageElement | null; browser: Support | null }) {
  const tool = useTool("background-removal", "remove-background", photo, browser);
  const { job, install, working, canStart } = tool;

  const run = async () => {
    if (!photo) return;
    try {
      const result = await removeBackground(photo.id, { askToDownload });
      if (!result.applied) {
        toast.info("The whole photo looks like the subject, so nothing was removed.");
        return;
      }
      toast.show({
        message: result.scaled ? "Background removed. The photo was reduced to 25 megapixels." : "Background removed.",
        kind: "success",
        actionLabel: "Undo",
        onAction: () => getActions().undo(),
      });
    } catch (error) {
      const known = asMlError(error, "runtime");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  return (
    <Section title="Remove background" aside={<Badge tone="primary">On-device</Badge>}>
      <p className="cf-ctx__hint cf-tool__lede">Cuts out the main subject of the photo. Everything happens on this device, and the photo is never uploaded.</p>
      {install ? (
        <InstallProgress install={install} kind="remove-background" />
      ) : working && job ? (
        <BusyBlock job={job} label="Removing background" />
      ) : (
        <>
          <Button variant="primary" block icon={<IconWand />} disabled={!canStart} data-focus-key="tool:remove-background" onClick={() => void run()}>
            Remove background
          </Button>
          {toolNote(tool, photo, "Unlock the photo to remove its background.")}
        </>
      )}
    </Section>
  );
}

/**
 * What a tool's section shows while its job runs and nothing says how far it has come: the step, a way to stop it, and a bar
 * that only says "busy". Only the step is announced; Cancel takes the keyboard, because the button that was pressed is gone.
 * Cancel and the tool's own button carry the same `data-focus-key`: a dialog that opens meanwhile (the question about the
 * download) gives focus back to whichever of the two is on the page when it closes.
 */
function BusyBlock({ job, label }: { job: JobState; label: string }) {
  return (
    <div className="cf-tool__work">
      <div className="cf-tool__row">
        <span className="cf-tool__stage" role="status">
          <Spinner size={16} />
          {STAGE_TEXT[job.kind][job.stage]}
        </span>
        <Button size="sm" variant="secondary" autoFocus data-focus-key={`tool:${job.kind}`} onClick={() => job.cancel()}>
          Cancel
        </Button>
      </div>
      <Progress label={label} />
    </div>
  );
}

/* ---------------- Blur background ---------------- */

const STRENGTH_LABEL: Record<BlurStrength, string> = { light: "Light", medium: "Medium", strong: "Strong" };

function BlurBackgroundTool({ photo, browser }: { photo: ImageElement | null; browser: Support | null }) {
  const tool = useTool("background-removal", "blur-background", photo, browser);
  const { job, install, working, canStart } = tool;
  const [strength, setStrength] = useState<BlurStrength>("medium");

  const run = async () => {
    if (!photo) return;
    try {
      const result = await blurBackground(photo.id, { strength, askToDownload });
      if (!result.applied) {
        toast.info(
          result.reason === "whole-photo"
            ? "The whole photo looks like the subject, so there is no background to blur."
            : "Everything around the subject is already transparent, so there is nothing to blur.",
        );
        return;
      }
      toast.show({
        message: result.scaled ? "Background blurred. The photo was reduced to 25 megapixels." : "Background blurred.",
        kind: "success",
        actionLabel: "Undo",
        onAction: () => getActions().undo(),
      });
    } catch (error) {
      const known = asMlError(error, "runtime");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  return (
    <Section title="Blur background" aside={<Badge tone="primary">On-device</Badge>}>
      <p className="cf-ctx__hint cf-tool__lede">Keeps the main subject sharp and blurs everything behind it. Everything happens on this device, and the photo is never uploaded.</p>
      {install ? (
        <InstallProgress install={install} kind="blur-background" />
      ) : working && job ? (
        <BusyBlock job={job} label="Blurring the background" />
      ) : (
        <>
          <Segmented
            aria-label="Blur strength"
            className="cf-tool__choice"
            fullWidth
            value={strength}
            onChange={setStrength}
            options={BLUR_STRENGTHS.map((s) => ({ value: s, label: STRENGTH_LABEL[s] }))}
          />
          <Button variant="primary" block icon={<IconAperture />} disabled={!canStart} data-focus-key="tool:blur-background" onClick={() => void run()}>
            Blur background
          </Button>
          {toolNote(tool, photo, "Unlock the photo to blur its background.")}
        </>
      )}
    </Section>
  );
}

/* ---------------- Colour pop ---------------- */

const POP_STYLE_LABEL: Record<PopStyle, string> = { "black-and-white": "Black & white", faded: "Faded" };

function ColourPopTool({ photo, browser }: { photo: ImageElement | null; browser: Support | null }) {
  const tool = useTool("background-removal", "colour-pop", photo, browser);
  const { job, install, working, canStart } = tool;
  const [style, setStyle] = useState<PopStyle>("black-and-white");

  const run = async () => {
    if (!photo) return;
    try {
      const result = await colourPop(photo.id, { style, askToDownload });
      if (!result.applied) {
        toast.info(
          result.reason === "whole-photo"
            ? "The whole photo looks like the subject, so there is no background to change."
            : "The background has no colour to take out: it is already black and white, or transparent.",
        );
        return;
      }
      toast.show({
        message: result.scaled ? "Colour pop applied. The photo was reduced to 25 megapixels." : "Colour pop applied.",
        kind: "success",
        actionLabel: "Undo",
        onAction: () => getActions().undo(),
      });
    } catch (error) {
      const known = asMlError(error, "runtime");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  return (
    <Section title="Colour pop" aside={<Badge tone="primary">On-device</Badge>}>
      <p className="cf-ctx__hint cf-tool__lede">
        Keeps the main subject in colour and turns everything behind it black and white. Everything happens on this device, and the photo is never uploaded.
      </p>
      {install ? (
        <InstallProgress install={install} kind="colour-pop" />
      ) : working && job ? (
        <BusyBlock job={job} label="Taking the colour out" />
      ) : (
        <>
          <Segmented
            aria-label="Background style"
            className="cf-tool__choice"
            fullWidth
            value={style}
            onChange={setStyle}
            options={POP_STYLES.map((s) => ({ value: s, label: POP_STYLE_LABEL[s] }))}
          />
          <Button variant="primary" block icon={<IconContrast />} disabled={!canStart} data-focus-key="tool:colour-pop" onClick={() => void run()}>
            Colour pop
          </Button>
          {toolNote(tool, photo, "Unlock the photo to take the colour out of its background.")}
        </>
      )}
    </Section>
  );
}

/* ---------------- Upscale ---------------- */

function UpscaleTool({ photo, browser }: { photo: ImageElement | null; browser: Support | null }) {
  const tool = useTool("upscaling", "upscale", photo, browser);
  const { job, install, working, canStart } = tool;
  const [wanted, setWanted] = useState(2);

  const choices = photo ? upscaleChoices(photo.naturalWidth, photo.naturalHeight) : [];
  // the factor asked for, or the largest one that fits when the photo is too large for it
  const choice = choices.find((c) => c.factor === wanted && c.fits) ?? [...choices].reverse().find((c) => c.fits) ?? null;
  const tooLarge = choices.filter((c) => !c.fits);
  const pixelCount = photo ? photo.naturalWidth * photo.naturalHeight : 0;

  const run = async () => {
    if (!photo || !choice) return;
    try {
      const result = await upscale(photo.id, { factor: choice.factor, askToDownload });
      toast.show({
        message: `Enlarged to ${pixels(result.width)} × ${pixels(result.height)} px.`,
        kind: "success",
        actionLabel: "Undo",
        onAction: () => getActions().undo(),
      });
    } catch (error) {
      const known = asMlError(error, "runtime");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  return (
    <Section title="Upscale" aside={<Badge tone="primary">On-device</Badge>}>
      <p className="cf-ctx__hint cf-tool__lede">Makes a small or soft photo larger and sharper. Everything happens on this device, and the photo is never uploaded.</p>
      {install ? (
        <InstallProgress install={install} kind="upscale" />
      ) : working && job ? (
        <UpscaleProgress job={job} />
      ) : (
        <>
          <Segmented
            aria-label="Enlarge by"
            fullWidth
            value={choice?.factor ?? wanted}
            onChange={setWanted}
            options={UPSCALE_FACTORS.map((factor) => ({ value: factor, label: `${factor}×`, disabled: !choices.find((c) => c.factor === factor)?.fits }))}
          />
          {photo && choice ? (
            <span className="cf-tool__sizes cf-tool__sizes--line">
              {pixels(photo.naturalWidth)} × {pixels(photo.naturalHeight)} px → {pixels(choice.width)} × {pixels(choice.height)} px
            </span>
          ) : null}
          <Button variant="primary" block icon={<IconSparkle />} disabled={!canStart || !choice} data-focus-key="tool:upscale" onClick={() => void run()}>
            Upscale
          </Button>
          {toolNote(tool, photo, "Unlock the photo to make it larger.")}
          {photo && !choice ? <p className="cf-tool__note">This photo is too large to enlarge: the result would be over 25 megapixels. Crop it first.</p> : null}
          {photo && choice && tooLarge.length ? (
            <p className="cf-tool__note">{tooLarge.map((c) => `${c.factor}×`).join(" and ")} is not available: the result would be over 25 megapixels.</p>
          ) : null}
          {photo && choice && pixelCount >= SLOW_PIXELS ? (
            <p className="cf-tool__note">A photo this size can take a minute or more on a laptop. You can cancel at any time.</p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** Only the step is announced ("Making it larger…"); the percentage changes with every piece and stays out of it. */
function UpscaleProgress({ job }: { job: JobState }) {
  const left = remainingText(job.remainingMs);
  return (
    <div className="cf-tool__work">
      <div className="cf-tool__row">
        <span className="cf-tool__stage" role="status">
          <Spinner size={16} />
          {STAGE_TEXT[job.kind][job.stage]}
        </span>
        <Button size="sm" variant="secondary" autoFocus data-focus-key={`tool:${job.kind}`} onClick={() => job.cancel()}>
          Cancel
        </Button>
      </div>
      <Progress label="Making the photo larger" value={job.progress} />
      {job.progress !== undefined ? (
        <span className="cf-tool__sizes">
          {Math.round(job.progress * 100)} % done{left ? `, ${left}` : ""}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- the picture a tool replaced ---------------- */

/** Every tool keeps the picture it replaced, once: this puts it back. */
function OriginalPhoto({ photo }: { photo: ImageElement | null }) {
  const job = useMlStore((s) => s.job);
  if (!photo?.originalSrc || job?.elementId === photo.id) return null;

  const restore = async () => {
    try {
      await restoreOriginal(photo.id);
    } catch (error) {
      toast.error(asMlError(error, "image").message);
    }
  };

  return (
    <div className="cf-tool__done">
      <span className="cf-tool__done-text">
        <IconSuccess aria-hidden="true" />
        Original photo kept
      </span>
      <Button size="sm" variant="secondary" icon={<IconRotateLeft />} disabled={!!job} onClick={() => void restore()}>
        Restore original
      </Button>
    </div>
  );
}

/**
 * Only the step is announced ("Downloading the model"), not the percentage, which changes a couple of
 * hundred times. Cancel takes the keyboard, because the button that started the download is no longer there.
 */
function InstallProgress({ install, kind }: { install: InstallState; kind: JobKind }) {
  const downloading = install.phase === "downloading";
  return (
    <div className="cf-tool__work">
      <div className="cf-tool__row">
        <span className="cf-tool__stage" role="status">
          {INSTALL_TEXT[install.phase]}
        </span>
        {install.phase !== "saving" ? (
          <Button size="sm" variant="secondary" autoFocus data-focus-key={`tool:${kind}`} onClick={() => install.cancel()}>
            Cancel
          </Button>
        ) : null}
      </div>
      <Progress label={INSTALL_TEXT.downloading} value={downloading ? install.received / install.total : undefined} />
      {downloading ? (
        <span className="cf-tool__sizes">
          {formatBytes(install.received)} of {formatBytes(install.total)}
        </span>
      ) : null}
    </div>
  );
}
