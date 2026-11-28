import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./DownloadPanel.css";
import { PageThumb } from "@/components/PageThumb";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import {
  Badge,
  Button,
  Checkbox,
  IconDocument,
  IconDownload,
  IconFileCode,
  IconFileImage,
  IconImage,
  IconImages,
  IconLayers,
  IconPresentation,
  IconPrint,
  IconVideo,
  IconWebsite,
  NumberField,
  Segmented,
  Select,
  Slider,
  Switch,
  toast,
  type SelectOption,
} from "@/ui";
import { ANIM_RESOLUTIONS, GIF_FPS_CHOICES, VIDEO_FPS, animationProblem, formatDuration, isAnimatedFormat, resolutionLabel, type AnimResolution } from "./animated/frames";
import { detectVideoSupport, videoContainer, type VideoSupport } from "./animated/video";
import { describeExportError, isCancelled } from "./errors";
import { downloadBlob, exportDesign, type ExportFormat } from "./exporters";
import { exportSeveralSizes } from "./multiSize";
import { CURRENT_SIZE_ID, MAX_SIZES, ORIGINAL_SIZE_NAME, defaultSizeIds, multiSizeOptions, planMultiSize, sizeChoices, sizeLabel, type MultiSizeFormat } from "./multiSizePlan";
import { MAX_BLEED_MM, MAX_EXPORT_SIDE, PRINT_DPI_CHOICES, estimateExportBytes, formatBytes, pagesLabel, planDpi, planRaster, resolveExportOptions } from "./options";
import {
  BLEED_CHOICES,
  DEFAULT_DOWNLOAD_SETTINGS,
  DOWNLOAD_SETTINGS_KEY,
  SIZE_MAX,
  SIZE_MIN,
  bleedMmOf,
  pagesFor,
  readStoredSettings,
  serializeSettings,
  toExportOptions,
  type BleedChoice,
  type DownloadSettings,
  type PagesMode,
  type PrintDpi,
} from "./settings";
import { exportPptx, pptxOptions } from "./pptxExport";
import { exportWebPage, webPageOptions } from "./webPageExport";

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

let videoSupport: VideoSupport | null = null;
/** What this browser can record, looked up once (it cannot change while the page is open). */
const getVideoSupport = (): VideoSupport => (videoSupport ??= detectVideoSupport());

function loadSettings(): DownloadSettings {
  let settings: DownloadSettings;
  try {
    settings = readStoredSettings(window.localStorage.getItem(DOWNLOAD_SETTINGS_KEY));
  } catch {
    settings = { ...DEFAULT_DOWNLOAD_SETTINGS };
  }
  // "Video" chosen in another browser: this one cannot record it, and the option is disabled
  if (settings.format === "webm" && !getVideoSupport().ok) settings = { ...settings, format: DEFAULT_DOWNLOAD_SETTINGS.format };
  return settings;
}

/** True while the tab is hidden: browsers pause the animation frames a video recording depends on. */
function useTabHidden(active: boolean): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [active]);
  return hidden;
}

/* ------------------------------------------------------------------ */
/* file type select                                                    */
/* ------------------------------------------------------------------ */

/** Downloads that are more than one kind of file. They are chosen in the same list, but are not remembered as a format. */
type Bundle = "sizes" | "html" | "pptx";
type FileKey = "png" | "jpg" | "pdf-standard" | "pdf-print" | "svg" | "gif" | "webm" | Bundle;

function Option({ name, hint, badge }: { name: string; hint: string; badge?: string }) {
  return (
    <span className="cf-dl__opt">
      <span className="cf-dl__opt-name">{name}</span>
      {badge ? (
        <Badge tone="info" variant="soft" className="cf-dl__opt-badge">
          {badge}
        </Badge>
      ) : null}
      <span className="cf-dl__opt-hint">{hint}</span>
    </span>
  );
}

const words = m.exporting.panel;
const TYPES = words.types;

const FILE_OPTIONS: SelectOption<FileKey>[] = [
  { value: "png", icon: <IconFileImage aria-hidden="true" />, textValue: "PNG", label: <Option name="PNG" badge={m.exporting.panel.suggested} hint={TYPES.pngHint} /> },
  { value: "jpg", icon: <IconImage aria-hidden="true" />, textValue: "JPG", label: <Option name="JPG" hint={TYPES.jpgHint} /> },
  { value: "pdf-standard", icon: <IconDocument aria-hidden="true" />, textValue: TYPES.pdfStandard, label: <Option name={TYPES.pdfStandard} hint={TYPES.pdfStandardHint} /> },
  { value: "pdf-print", icon: <IconPrint aria-hidden="true" />, textValue: TYPES.pdfPrint, label: <Option name={TYPES.pdfPrint} hint={TYPES.pdfPrintHint} /> },
  { value: "svg", icon: <IconFileCode aria-hidden="true" />, textValue: "SVG", label: <Option name="SVG" hint={TYPES.svgHint} /> },
  { value: "gif", icon: <IconImages aria-hidden="true" />, textValue: TYPES.gif, label: <Option name={TYPES.gif} hint={TYPES.gifHint} /> },
  { value: "webm", icon: <IconVideo aria-hidden="true" />, textValue: TYPES.video, label: <Option name={TYPES.video} hint={TYPES.videoHint} /> },
  { value: "sizes", icon: <IconLayers aria-hidden="true" />, textValue: TYPES.sizes, label: <Option name={TYPES.sizes} hint={TYPES.sizesHint} /> },
  { value: "html", icon: <IconWebsite aria-hidden="true" />, textValue: TYPES.html, label: <Option name={TYPES.html} hint={TYPES.htmlHint} /> },
  { value: "pptx", icon: <IconPresentation aria-hidden="true" />, textValue: TYPES.pptx, label: <Option name={TYPES.pptx} hint={TYPES.pptxHint} /> },
];

/**
 * The list as this browser can use it: a video the browser cannot make stays visible but disabled, with the reason; one made frame
 * by frame is an MP4 with sound, and one recorded as MP4 (Safari without WebCodecs) is called so.
 */
const optionsFor = (video: VideoSupport): SelectOption<FileKey>[] =>
  FILE_OPTIONS.map((o) => {
    if (o.value !== "webm") return o;
    if (!video.ok) return { ...o, disabled: true, label: <Option name={TYPES.video} hint={TYPES.videoUnsupported} /> };
    if (video.offline) return { ...o, textValue: TYPES.videoMp4, label: <Option name={TYPES.videoMp4} hint={TYPES.videoSoundHint} /> };
    if (videoContainer(video.mimeType) === "mp4") return { ...o, textValue: TYPES.videoMp4, label: <Option name={TYPES.videoMp4} hint={TYPES.videoHint} /> };
    return o;
  });

/** The name of a size as the panel shows it: "Original size" stays English in the file names, and is said in the page's language here. */
const sizeName = (name: string): string => (name === ORIGINAL_SIZE_NAME ? words.originalSize : name);

const bleedLabel: Record<BleedChoice, string> = {
  none: words.bleedChoices.none,
  "3mm": words.bleedChoices.mm3,
  eighth: words.bleedChoices.eighth,
  custom: words.bleedChoices.custom,
};

const fileKeyOf = (s: DownloadSettings): FileKey => (s.format === "pdf" ? (s.pdfMode === "print" ? "pdf-print" : "pdf-standard") : s.format);

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

function Field({ label, id, children, aside }: { label: string; id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="cf-dl__section">
      <div className="cf-dl__row">
        <span className="cf-dl__label" id={id}>
          {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}

const sizeText = (design: Pick<Design, "width" | "height">, scale: number) => {
  const plan = planRaster(design.width, design.height, { format: "png", scale, pdfMode: "standard" });
  return { plan, text: m.exporting.panel.pixels(plan.width, plan.height) };
};

interface PageGridProps {
  design: Design;
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
}

function PageGrid({ design, selected, onToggle }: PageGridProps) {
  return (
    <div className="cf-dl__grid" role="group" aria-label={m.exporting.panel.pagesToDownload}>
      {design.pages.map((page, index) => {
        const on = selected.has(index);
        return (
          <div key={page.id} className={`cf-dl__tile${on ? " is-on" : ""}`}>
            <button type="button" className="cf-dl__thumb" tabIndex={-1} aria-hidden="true" onClick={() => onToggle(index)}>
              <PageThumb design={design} page={page} width={96} sharp={false} />
            </button>
            <Checkbox className="cf-dl__check" checked={on} onChange={() => onToggle(index)} aria-label={m.exporting.panel.page(index + 1)} />
            <span className="cf-dl__num">{index + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

interface Progress {
  done: number;
  total: number;
}

/** The Download panel shown in the Share popover and File > Download. */
export function DownloadPanel({ onDone }: { onDone?: () => void }) {
  const design = useEditor((s) => s.design);
  const activePageId = useEditor((s) => s.activePageId);
  const [settings, setSettings] = useState<DownloadSettings>(loadSettings);
  const [custom, setCustom] = useState<Set<number> | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  // several sizes: the ticked sizes (null until one is changed: the defaults for this design) and the format of every file
  const [sizeIds, setSizeIds] = useState<Set<string> | null>(null);
  const [sizesFormat, setSizesFormat] = useState<MultiSizeFormat>("png");
  // web page: presenter notes are private, so they are left out until someone asks for them, every time
  const [webNotes, setWebNotes] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      // the export keeps running when the panel closes; it only stops talking to the unmounted component
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, serializeSettings(settings));
    } catch {
      /* private mode: settings just are not remembered */
    }
  }, [settings]);

  const patch = useCallback((change: Partial<DownloadSettings>) => setSettings((s) => ({ ...s, ...change })), []);

  const pageCount = design?.pages.length ?? 0;
  const activeIndex = design
    ? Math.max(
        0,
        design.pages.findIndex((p) => p.id === activePageId),
      )
    : 0;

  // custom selection defaults to every page and survives page count changes
  const customSet = useMemo(() => {
    const base = custom ?? new Set(Array.from({ length: pageCount }, (_v, i) => i));
    return new Set([...base].filter((i) => i < pageCount));
  }, [custom, pageCount]);

  const pages = useMemo(() => pagesFor(settings.pagesMode, pageCount, activeIndex, customSet), [settings.pagesMode, customSet, activeIndex, pageCount]);

  const options = useMemo(() => toExportOptions(settings, pages), [settings, pages]);
  const several = bundle === "sizes";
  const width = design?.width ?? 0;
  const height = design?.height ?? 0;
  const typeId = design?.typeId ?? "";
  const choices = useMemo(() => (several ? sizeChoices({ width, height, typeId }) : []), [several, width, height, typeId]);
  const tickedSizes = useMemo(() => sizeIds ?? new Set(several ? defaultSizeIds({ width, height, typeId }) : []), [sizeIds, several, width, height, typeId]);
  const sizePlan = useMemo(() => (design && several ? planMultiSize(design, [...tickedSizes], pages, sizesFormat) : null), [design, several, tickedSizes, pages, sizesFormat]);
  const estimate = useMemo(() => {
    if (!design || !pages.length) return 0;
    // a web page: its pictures, a third larger for being written as text
    if (bundle === "html") return Math.round((estimateExportBytes(design, { ...webPageOptions(design, 0), pages }) * 4) / 3);
    // a presentation: its pictures, and little else
    if (bundle === "pptx") return estimateExportBytes(design, { ...pptxOptions(design, 0), pages });
    if (!sizePlan) return estimateExportBytes(design, options);
    // every size is weighed as the design at that size: what is on the pages stays, the pixels change
    const each = multiSizeOptions(sizesFormat, settings.quality, pages);
    return sizePlan.sizes.reduce((sum, s) => sum + estimateExportBytes({ width: s.width, height: s.height, pages: design.pages }, each), 0);
  }, [design, options, pages, bundle, sizePlan, sizesFormat, settings.quality]);
  // a GIF or video: the timeline of the chosen pages (picture size, length, whether anything moves)
  const animation = useMemo(
    () => (design && pages.length && !bundle && isAnimatedFormat(options.format) ? resolveExportOptions(design, options).animation : null),
    [design, options, pages.length, bundle],
  );
  const video = getVideoSupport();
  const fileOptions = useMemo(() => optionsFor(video), [video]);
  // only a recording stops in a background tab; a video made frame by frame goes on
  const tabHidden = useTabHidden(progress !== null && !bundle && settings.format === "webm" && !video.offline);

  if (!design) return <div className="cf-dl cf-dl--empty">{words.empty}</div>;

  const busy = progress !== null;
  const multi = pageCount > 1;
  const sizing = sizeText(design, settings.scale);
  /** what the panel shows the choices of: one kind of file, or a download made of several */
  const format: ExportFormat | Bundle = bundle ?? settings.format;
  const animated = !bundle && isAnimatedFormat(settings.format);
  const problem = animation ? animationProblem(animation) : null;
  /** many sites refuse GIFs bigger than this */
  const bigGif = format === "gif" && estimate > 15 * 1024 * 1024;
  /** why this download cannot start (a page that is missing is said in the footer, like for every other download) */
  const refusal = problem ?? sizePlan?.problem ?? null;
  /** a print PDF: the pixel size its pages are written at (with the bleed), and whether the resolution had to be lowered for it */
  const printPlan = format === "pdf" && settings.pdfMode === "print" ? resolveExportOptions(design, { ...options, pages: [] }).plan : null;
  const bleedMm = bleedMmOf(settings);
  const cmyk = printPlan !== null && settings.cmyk;

  const toggleSize = (id: string) => {
    const next = new Set(tickedSizes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSizeIds(next);
  };

  const toggleCustom = (index: number) => {
    const next = new Set(customSet);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCustom(next);
  };

  const run = async () => {
    if (abortRef.current || !pages.length || refusal) return; // the ref (not `busy`) is the lock: two clicks in one tick must not start two exports
    const controller = new AbortController();
    abortRef.current = controller;
    const total = several ? pages.length * tickedSizes.size : pages.length;
    setProgress({ done: 0, total });
    const report = (done: number, of: number) => alive.current && setProgress({ done, total: of });
    try {
      const file = several
        ? await exportSeveralSizes(design, { sizeIds: [...tickedSizes], pages, format: sizesFormat, quality: settings.quality }, report, controller.signal)
        : bundle === "html"
          ? // the file says which language it is in; the words on the pages are pictures, so that is the language of its own few words
            await exportWebPage(design, { pages, notes: webNotes, lang: document.documentElement.lang || "en" }, report, controller.signal)
          : bundle === "pptx"
            ? await exportPptx(design, { pages, notes: webNotes }, report, controller.signal)
            : await exportDesign(design, options, report, controller.signal);
      downloadBlob(file.blob, file.name);
      toast.show({ kind: "success", message: words.downloaded(file.name) });
      if (file.note) toast.show({ kind: "info", message: file.note, duration: 9000 });
      if (alive.current) onDone?.();
    } catch (error) {
      if (isCancelled(error)) toast.show({ kind: "info", message: words.cancelled });
      else {
        console.error("Export failed", error);
        // the size multiplier belongs in the message only where one was chosen: a single PNG or JPG
        toast.show({
          kind: "error",
          message: describeExportError(error, { scale: !bundle && (options.format === "png" || options.format === "jpg") ? options.scale : undefined }),
        });
      }
    } finally {
      abortRef.current = null;
      if (alive.current) setProgress(null);
    }
  };

  const { status: says } = words;
  const status = !progress
    ? null
    : progress.done >= progress.total
      ? says.finishing
      : several
        ? says.picture(progress.done + 1, progress.total)
        : format === "webm" && !video.offline
          ? tabHidden
            ? says.recordingHidden
            : says.recording(Math.floor(progress.done / VIDEO_FPS), Math.round(progress.total / VIDEO_FPS))
          : format === "gif" || format === "webm"
            ? progress.done === 0
              ? says.preparing
              : says.frame(progress.done + 1, progress.total)
            : progress.total === 1
              ? says.preparing
              : says.page(progress.done + 1, progress.total);

  const sliderSize = (
    <>
      <Slider
        label={words.size}
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={0.25}
        value={settings.scale}
        showValue
        format={(v) => words.sizeValue(v, sizeText(design, v).text)}
        onChange={(v) => patch({ scale: v })}
        disabled={busy}
      />
      {sizing.plan.clamped ? <p className="cf-dl__hint">{words.reduced(MAX_EXPORT_SIDE)}</p> : null}
    </>
  );

  return (
    <section className="cf-dl" aria-label={words.download}>
      <Field label={words.fileType} id="cf-dl-type">
        <Select<FileKey>
          aria-label={words.fileType}
          value={bundle ?? fileKeyOf(settings)}
          options={fileOptions}
          disabled={busy}
          onChange={(key) => {
            if (key === "sizes" || key === "html" || key === "pptx") {
              setBundle(key);
              return;
            }
            setBundle(null);
            if (key === "pdf-standard") patch({ format: "pdf", pdfMode: "standard" });
            else if (key === "pdf-print") patch({ format: "pdf", pdfMode: "print" });
            else patch({ format: key });
          }}
        />
      </Field>

      {format === "png" && (
        <div className="cf-dl__group">
          {sliderSize}
          <Switch checked={settings.transparent} onChange={(transparent) => patch({ transparent })} label={words.transparent} disabled={busy} />
        </div>
      )}

      {format === "jpg" && (
        <div className="cf-dl__group">
          {sliderSize}
          <Slider
            label={words.quality}
            min={10}
            max={100}
            step={5}
            value={Math.round(settings.quality * 100)}
            showValue
            format={(v) => words.percent(Math.round(v))}
            onChange={(v) => patch({ quality: v / 100 })}
            disabled={busy}
          />
        </div>
      )}

      {format === "pdf" && (
        <div className="cf-dl__group">
          <Field label={words.presets}>
            <Segmented<"standard" | "print">
              aria-label={words.pdfPreset}
              fullWidth
              value={settings.pdfMode}
              onChange={(pdfMode) => patch({ pdfMode })}
              options={[
                { value: "standard", label: words.digital },
                { value: "print", label: words.print },
              ]}
            />
          </Field>
          <p className="cf-dl__hint">{printPlan ? words.printHint(settings.printDpi) : words.digitalHint}</p>
          {/* a CMYK page is not a JPEG: there is nothing for compression to lower */}
          <Switch checked={settings.compress && !cmyk} onChange={(compress) => patch({ compress })} label={words.compress} disabled={busy || cmyk} />
          <p className="cf-dl__hint">{words.compressHint}</p>
          {/* what only a printer needs: shown for the print preset alone */}
          {printPlan ? (
            <>
              <Field label={words.printResolution} aside={<span className="cf-dl__count">{words.pixels(printPlan.width, printPlan.height)}</span>}>
                <Segmented<PrintDpi>
                  aria-label={words.printResolution}
                  size="sm"
                  fullWidth
                  value={settings.printDpi}
                  onChange={(printDpi) => patch({ printDpi })}
                  options={PRINT_DPI_CHOICES.map((dpi) => ({ value: dpi, label: words.dpi(dpi), disabled: busy }))}
                />
              </Field>
              {printPlan.clamped ? (
                <p className="cf-dl__note cf-dl__note--warn" role="status">
                  {words.dpiReduced(planDpi(printPlan), MAX_EXPORT_SIDE)}
                </p>
              ) : null}
              <Field label={words.bleed}>
                <Segmented<BleedChoice>
                  aria-label={words.bleed}
                  size="sm"
                  fullWidth
                  value={settings.bleed}
                  onChange={(bleed) => patch({ bleed })}
                  options={BLEED_CHOICES.map((choice) => ({ value: choice, label: bleedLabel[choice], disabled: busy }))}
                />
              </Field>
              {settings.bleed === "custom" ? (
                <NumberField
                  aria-label={words.bleedSize}
                  value={settings.bleedMm}
                  min={0}
                  max={MAX_BLEED_MM}
                  step={0.5}
                  suffix="mm"
                  stepper
                  width={140}
                  size="sm"
                  onChange={(bleedMm) => patch({ bleedMm })}
                  disabled={busy}
                />
              ) : null}
              <p className="cf-dl__hint">{bleedMm > 0 ? words.bleedHint(Math.round(bleedMm * 1000) / 1000) : words.bleedNoneHint}</p>
              <Switch checked={settings.cropMarks} onChange={(cropMarks) => patch({ cropMarks })} label={words.cropMarks} disabled={busy} />
              <p className="cf-dl__hint">{words.cropMarksHint}</p>
              <Switch checked={settings.registrationMarks} onChange={(registrationMarks) => patch({ registrationMarks })} label={words.registrationMarks} disabled={busy} />
              <p className="cf-dl__hint">{words.registrationMarksHint}</p>
              <Switch checked={settings.cmyk} onChange={(on) => patch({ cmyk: on })} label={words.cmyk} disabled={busy} />
              <p className="cf-dl__hint">{words.cmykHint}</p>
            </>
          ) : null}
        </div>
      )}

      {format === "svg" && (
        <div className="cf-dl__group">
          <Switch checked={settings.embedFonts} onChange={(embedFonts) => patch({ embedFonts })} label={words.embedFonts} disabled={busy} />
          <p className="cf-dl__hint">{words.embedFontsHint}</p>
        </div>
      )}

      {animated && animation && (
        <div className="cf-dl__group">
          <Field label={words.resolution} aside={<span className="cf-dl__count">{words.pixels(animation.width, animation.height)}</span>}>
            <Segmented<AnimResolution>
              aria-label={words.resolution}
              size="sm"
              fullWidth
              value={settings.resolution}
              onChange={(resolution) => patch({ resolution })}
              options={ANIM_RESOLUTIONS.map((r) => ({ value: r, label: resolutionLabel(r), disabled: busy }))}
            />
          </Field>
          {format === "gif" ? (
            <Field label={words.frameRate}>
              <Segmented<number>
                aria-label={words.frameRate}
                size="sm"
                fullWidth
                value={settings.gifFps}
                onChange={(gifFps) => patch({ gifFps })}
                options={GIF_FPS_CHOICES.map((fps) => ({ value: fps, label: words.fps(fps), disabled: busy }))}
              />
            </Field>
          ) : (
            <Field label={words.frameRate} aside={<span className="cf-dl__count">{words.fps(VIDEO_FPS)}</span>}>
              <p className="cf-dl__hint">{video.offline ? words.videoHintFrames : words.videoHint}</p>
            </Field>
          )}
          {/* one note at a time, the most useful first: what stops the download, then why it looks static, then a size warning */}
          {problem ? (
            <p className="cf-dl__note cf-dl__note--error" role="alert">
              {problem}
            </p>
          ) : !animation.animated ? (
            <p className="cf-dl__note">{words.notAnimated}</p>
          ) : bigGif ? (
            <p className="cf-dl__note cf-dl__note--warn">{words.bigGif}</p>
          ) : null}
        </div>
      )}

      {sizePlan && (
        <div className="cf-dl__group">
          <Field
            label={words.sizes}
            aside={
              <span className="cf-dl__count" aria-live="polite">
                {words.sizesCount(sizePlan.sizes.length, MAX_SIZES)}
              </span>
            }
          >
            <div className="cf-dl__sizes" role="group" aria-label={words.sizesToDownload}>
              {choices.map((choice) => (
                <Checkbox
                  key={choice.id}
                  className="cf-dl__size"
                  checked={tickedSizes.has(choice.id)}
                  onChange={() => toggleSize(choice.id)}
                  disabled={busy}
                  label={
                    <>
                      <span className="cf-dl__size-name">{choice.id === CURRENT_SIZE_ID ? words.thisDesign(sizeName(choice.name)) : choice.name}</span>
                      <span className="cf-dl__size-px">{sizeLabel(choice)}</span>
                    </>
                  }
                />
              ))}
            </div>
          </Field>
          <Field label={words.format}>
            <Segmented<MultiSizeFormat>
              aria-label={words.formatOfEachSize}
              size="sm"
              fullWidth
              value={sizesFormat}
              onChange={setSizesFormat}
              options={[
                { value: "png", label: "PNG", disabled: busy },
                { value: "jpg", label: "JPG", disabled: busy },
                { value: "pdf", label: "PDF", disabled: busy },
              ]}
            />
          </Field>
          <p className="cf-dl__hint">{sizesFormat === "pdf" ? words.sizesHintPdf : words.sizesHintPictures}</p>
          {sizePlan.problem && pages.length ? (
            <p className="cf-dl__note cf-dl__note--error" role="alert">
              {sizePlan.problem}
            </p>
          ) : null}
        </div>
      )}

      {format === "html" && (
        <div className="cf-dl__group">
          <p className="cf-dl__hint">{words.htmlHint}</p>
          <p className="cf-dl__hint">{words.htmlPictures}</p>
          <Switch checked={webNotes} onChange={setWebNotes} label={words.includeNotes} disabled={busy} />
          <p className="cf-dl__hint">{webNotes ? words.notesShown : words.notesPrivate}</p>
        </div>
      )}

      {format === "pptx" && (
        <div className="cf-dl__group">
          <p className="cf-dl__hint">{words.pptxHint}</p>
          <p className="cf-dl__hint">{words.pptxPictures}</p>
          <Switch checked={webNotes} onChange={setWebNotes} label={words.includeNotes} disabled={busy} />
          <p className="cf-dl__hint">{webNotes ? words.pptxNotesShown : words.notesPrivate}</p>
        </div>
      )}

      <Field
        label={words.selectPages}
        aside={
          <span className="cf-dl__count" aria-live="polite">
            {pagesLabel(pages.length)}
          </span>
        }
      >
        {multi ? (
          <Segmented<PagesMode>
            aria-label={words.pagesToDownload}
            size="sm"
            fullWidth
            value={settings.pagesMode}
            onChange={(pagesMode) => patch({ pagesMode })}
            options={[
              { value: "all", label: words.allPages },
              { value: "current", label: words.currentPage },
              { value: "custom", label: words.custom },
            ]}
          />
        ) : null}
        {multi && settings.pagesMode === "custom" ? (
          <>
            <div className="cf-dl__bulk">
              <Button size="sm" variant="ghost" onClick={() => setCustom(new Set(Array.from({ length: pageCount }, (_v, i) => i)))} disabled={customSet.size === pageCount}>
                {words.selectAll}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCustom(new Set())} disabled={customSet.size === 0}>
                {words.selectNone}
              </Button>
            </div>
            <PageGrid design={design} selected={customSet} onToggle={toggleCustom} />
          </>
        ) : null}
        {multi && settings.pagesMode !== "custom" ? (
          <p className="cf-dl__hint">
            {settings.pagesMode === "current"
              ? words.pageOf(activeIndex + 1, pageCount)
              : pages.length > 1 && animated
                ? words.everyPagePlayed
                : pages.length > 1 && format !== "pdf" && !bundle
                  ? words.everyPageZip
                  : words.everyPage}
          </p>
        ) : null}
      </Field>

      <div className="cf-dl__footer">
        <p className="cf-dl__estimate">
          {pages.length ? (
            <>
              {words.estimated} <strong>~{formatBytes(estimate)}</strong>
              {animation ? <> · {formatDuration(animation.total)}</> : null}
              {sizePlan ? <> · {words.files(sizePlan.files)}</> : null}
            </>
          ) : (
            m.exporting.errors.noPages
          )}
        </p>
        <Button variant="primary" size="lg" block icon={<IconDownload aria-hidden="true" />} loading={busy} disabled={!pages.length || !!refusal} onClick={run}>
          {words.download}
        </Button>
        {busy ? (
          <div className="cf-dl__progress">
            <div className="cf-dl__bar" role="progressbar" aria-label={words.progress} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${Math.max(6, (progress.done / progress.total) * 100)}%` }} />
            </div>
            <div className="cf-dl__status">
              <span role="status">{status}</span>
              <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
