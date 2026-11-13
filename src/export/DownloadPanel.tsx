import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./DownloadPanel.css";
import { PageThumb } from "@/components/PageThumb";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
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
import { detectVideoSupport, type VideoSupport } from "./animated/video";
import { describeExportError, isCancelled } from "./errors";
import { downloadBlob, exportDesign, type ExportFormat } from "./exporters";
import { exportSeveralSizes } from "./multiSize";
import { CURRENT_SIZE_ID, MAX_SIZES, defaultSizeIds, multiSizeOptions, planMultiSize, sizeChoices, sizeLabel, type MultiSizeFormat } from "./multiSizePlan";
import { MAX_BLEED_MM, MAX_EXPORT_SIDE, estimateExportBytes, formatBytes, pagesLabel, planRaster, resolveExportOptions } from "./options";
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  DOWNLOAD_SETTINGS_KEY,
  SIZE_MAX,
  SIZE_MIN,
  pagesFor,
  readStoredSettings,
  serializeSettings,
  toExportOptions,
  type DownloadSettings,
  type PagesMode,
} from "./settings";
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
type Bundle = "sizes" | "html";
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

const FILE_OPTIONS: SelectOption<FileKey>[] = [
  { value: "png", icon: <IconFileImage aria-hidden="true" />, textValue: "PNG", label: <Option name="PNG" badge="Suggested" hint="Sharp images" /> },
  { value: "jpg", icon: <IconImage aria-hidden="true" />, textValue: "JPG", label: <Option name="JPG" hint="Small photos" /> },
  { value: "pdf-standard", icon: <IconDocument aria-hidden="true" />, textValue: "PDF Standard", label: <Option name="PDF Standard" hint="Screens and sharing" /> },
  { value: "pdf-print", icon: <IconPrint aria-hidden="true" />, textValue: "PDF Print", label: <Option name="PDF Print" hint="300 dpi" /> },
  { value: "svg", icon: <IconFileCode aria-hidden="true" />, textValue: "SVG", label: <Option name="SVG" hint="Editable vector" /> },
  { value: "gif", icon: <IconImages aria-hidden="true" />, textValue: "Animated GIF", label: <Option name="Animated GIF" hint="Plays on any device" /> },
  { value: "webm", icon: <IconVideo aria-hidden="true" />, textValue: "Video (WebM)", label: <Option name="Video (WebM)" hint="Smooth, small files" /> },
  { value: "sizes", icon: <IconLayers aria-hidden="true" />, textValue: "Several sizes", label: <Option name="Several sizes" hint="One ZIP, a file per size" /> },
  { value: "html", icon: <IconWebsite aria-hidden="true" />, textValue: "Web page (HTML)", label: <Option name="Web page (HTML)" hint="A slideshow in any browser" /> },
];

/** The list as this browser can use it: a video the browser cannot record stays visible but disabled, with the reason. */
const optionsFor = (video: VideoSupport): SelectOption<FileKey>[] =>
  video.ok
    ? FILE_OPTIONS
    : FILE_OPTIONS.map((o) => (o.value === "webm" ? { ...o, disabled: true, label: <Option name="Video (WebM)" hint="Not supported in this browser" /> } : o));

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
  return { plan, text: `${plan.width.toLocaleString("en-US")} × ${plan.height.toLocaleString("en-US")} px` };
};

interface PageGridProps {
  design: Design;
  selected: ReadonlySet<number>;
  onToggle: (index: number) => void;
}

function PageGrid({ design, selected, onToggle }: PageGridProps) {
  return (
    <div className="cf-dl__grid" role="group" aria-label="Pages to download">
      {design.pages.map((page, index) => {
        const on = selected.has(index);
        return (
          <div key={page.id} className={`cf-dl__tile${on ? " is-on" : ""}`}>
            <button type="button" className="cf-dl__thumb" tabIndex={-1} aria-hidden="true" onClick={() => onToggle(index)}>
              <PageThumb design={design} page={page} width={96} sharp={false} />
            </button>
            <Checkbox className="cf-dl__check" checked={on} onChange={() => onToggle(index)} aria-label={`Page ${index + 1}`} />
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
  const tabHidden = useTabHidden(progress !== null && !bundle && settings.format === "webm");

  if (!design) return <div className="cf-dl cf-dl--empty">Open a design to download it.</div>;

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
          : await exportDesign(design, options, report, controller.signal);
      downloadBlob(file.blob, file.name);
      toast.show({ kind: "success", message: `Downloaded ${file.name}` });
      if (file.note) toast.show({ kind: "info", message: file.note, duration: 9000 });
      if (alive.current) onDone?.();
    } catch (error) {
      if (isCancelled(error)) toast.show({ kind: "info", message: "Download cancelled" });
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

  const status = !progress
    ? null
    : progress.done >= progress.total
      ? "Finishing up…"
      : several
        ? `Rendering picture ${progress.done + 1} of ${progress.total}…`
        : format === "webm"
          ? tabHidden
            ? "Recording pauses while this tab is in the background. Switch back to keep going."
            : `Recording ${Math.floor(progress.done / VIDEO_FPS)} s of ${Math.round(progress.total / VIDEO_FPS)} s…`
          : format === "gif"
            ? progress.done === 0
              ? "Preparing your download…"
              : `Rendering frame ${progress.done + 1} of ${progress.total}…`
            : progress.total === 1
              ? "Preparing your download…"
              : `Preparing page ${progress.done + 1} of ${progress.total}…`;

  const sliderSize = (
    <>
      <Slider
        label="Size"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={0.25}
        value={settings.scale}
        showValue
        format={(v) => `×${v} · ${sizeText(design, v).text}`}
        onChange={(v) => patch({ scale: v })}
        disabled={busy}
      />
      {sizing.plan.clamped ? <p className="cf-dl__hint">Reduced to fit {MAX_EXPORT_SIDE.toLocaleString("en-US")} px on the longest side.</p> : null}
    </>
  );

  return (
    <section className="cf-dl" aria-label="Download">
      <Field label="File type" id="cf-dl-type">
        <Select<FileKey>
          aria-label="File type"
          value={bundle ?? fileKeyOf(settings)}
          options={fileOptions}
          disabled={busy}
          onChange={(key) => {
            if (key === "sizes" || key === "html") {
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
          <Switch checked={settings.transparent} onChange={(transparent) => patch({ transparent })} label="Transparent background" disabled={busy} />
        </div>
      )}

      {format === "jpg" && (
        <div className="cf-dl__group">
          {sliderSize}
          <Slider
            label="Quality"
            min={10}
            max={100}
            step={5}
            value={Math.round(settings.quality * 100)}
            showValue
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => patch({ quality: v / 100 })}
            disabled={busy}
          />
        </div>
      )}

      {format === "pdf" && (
        <div className="cf-dl__group">
          <Field label="Presets">
            <Segmented<"standard" | "print">
              aria-label="PDF preset"
              fullWidth
              value={settings.pdfMode}
              onChange={(pdfMode) => patch({ pdfMode })}
              options={[
                { value: "standard", label: "Digital" },
                { value: "print", label: "Print" },
              ]}
            />
          </Field>
          <p className="cf-dl__hint">{settings.pdfMode === "print" ? "300 dpi pages, sharp when printed." : "Light pages for screens, email and sharing."}</p>
          <Switch checked={settings.compress} onChange={(compress) => patch({ compress })} label="Compress PDF" disabled={busy} />
          <p className="cf-dl__hint">Makes the file smaller with slightly lower image quality.</p>
          {/* what only a printer needs: shown for the print preset alone */}
          {settings.pdfMode === "print" ? (
            <>
              <Switch checked={settings.bleed} onChange={(bleed) => patch({ bleed })} label="Bleed" disabled={busy} />
              {settings.bleed ? (
                <>
                  <NumberField
                    aria-label="Bleed size"
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
                  <p className="cf-dl__hint">
                    The page background is extended {settings.bleedMm} mm beyond every edge, so nothing white shows when the sheet is cut. Keep what matters away from the edges.
                  </p>
                </>
              ) : null}
              <Switch checked={settings.cropMarks} onChange={(cropMarks) => patch({ cropMarks })} label="Crop marks" disabled={busy} />
              <p className="cf-dl__hint">Thin lines outside the page that show the printer where to cut. The PDF page becomes larger to hold them.</p>
            </>
          ) : null}
        </div>
      )}

      {format === "svg" && (
        <div className="cf-dl__group">
          <Switch checked={settings.embedFonts} onChange={(embedFonts) => patch({ embedFonts })} label="Embed fonts" disabled={busy} />
          <p className="cf-dl__hint">Text looks the same everywhere. Turn off for a smaller file; the SVG then relies on fonts installed on the viewing device.</p>
        </div>
      )}

      {animated && animation && (
        <div className="cf-dl__group">
          <Field label="Resolution" aside={<span className="cf-dl__count">{`${animation.width.toLocaleString("en-US")} × ${animation.height.toLocaleString("en-US")} px`}</span>}>
            <Segmented<AnimResolution>
              aria-label="Resolution"
              size="sm"
              fullWidth
              value={settings.resolution}
              onChange={(resolution) => patch({ resolution })}
              options={ANIM_RESOLUTIONS.map((r) => ({ value: r, label: resolutionLabel(r), disabled: busy }))}
            />
          </Field>
          {format === "gif" ? (
            <Field label="Frame rate">
              <Segmented<number>
                aria-label="Frame rate"
                size="sm"
                fullWidth
                value={settings.gifFps}
                onChange={(gifFps) => patch({ gifFps })}
                options={GIF_FPS_CHOICES.map((fps) => ({ value: fps, label: `${fps} fps`, disabled: busy }))}
              />
            </Field>
          ) : (
            <Field label="Frame rate" aside={<span className="cf-dl__count">{VIDEO_FPS} fps</span>}>
              <p className="cf-dl__hint">Recorded as it plays, so it takes as long as the animation. Keep this tab open and in front while it records.</p>
            </Field>
          )}
          {/* one note at a time, the most useful first: what stops the download, then why it looks static, then a size warning */}
          {problem ? (
            <p className="cf-dl__note cf-dl__note--error" role="alert">
              {problem}
            </p>
          ) : !animation.animated ? (
            <p className="cf-dl__note">Nothing is animated yet - use Animate on the toolbar</p>
          ) : bigGif ? (
            <p className="cf-dl__note cf-dl__note--warn">Many sites accept GIFs of about 15 MB at most. A lower resolution or frame rate makes this one smaller.</p>
          ) : null}
        </div>
      )}

      {sizePlan && (
        <div className="cf-dl__group">
          <Field
            label="Sizes"
            aside={
              <span className="cf-dl__count" aria-live="polite">
                {sizePlan.sizes.length} of {MAX_SIZES}
              </span>
            }
          >
            <div className="cf-dl__sizes" role="group" aria-label="Sizes to download">
              {choices.map((choice) => (
                <Checkbox
                  key={choice.id}
                  className="cf-dl__size"
                  checked={tickedSizes.has(choice.id)}
                  onChange={() => toggleSize(choice.id)}
                  disabled={busy}
                  label={
                    <>
                      <span className="cf-dl__size-name">{choice.id === CURRENT_SIZE_ID ? `${choice.name} (this design)` : choice.name}</span>
                      <span className="cf-dl__size-px">{sizeLabel(choice)}</span>
                    </>
                  }
                />
              ))}
            </div>
          </Field>
          <Field label="Format">
            <Segmented<MultiSizeFormat>
              aria-label="Format of each size"
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
          <p className="cf-dl__hint">
            Every size is made from a copy that is scaled to fit and centred, as Resize does it. This design is not changed. The files come together in one .zip
            {sizesFormat === "pdf" ? ", one PDF for each size." : ", each exactly as many pixels as its size."}
          </p>
          {sizePlan.problem && pages.length ? (
            <p className="cf-dl__note cf-dl__note--error" role="alert">
              {sizePlan.problem}
            </p>
          ) : null}
        </div>
      )}

      {format === "html" && (
        <div className="cf-dl__group">
          <p className="cf-dl__hint">
            One .html file that shows the pages as a slideshow in any browser, for people who do not have Craftly: next and back with the buttons, the arrow keys, a click or a
            swipe, and a full screen button. Nothing is loaded from the internet.
          </p>
          <p className="cf-dl__hint">Every page is a picture. Animations, transitions and links are not carried over; pages change with a short fade.</p>
          <Switch checked={webNotes} onChange={setWebNotes} label="Include speaker notes" disabled={busy} />
          <p className="cf-dl__hint">
            {webNotes ? "The notes are shown under each page. Everyone who gets the file can read them." : "Notes are private and stay out of the file."}
          </p>
        </div>
      )}

      <Field
        label="Select pages"
        aside={
          <span className="cf-dl__count" aria-live="polite">
            {pagesLabel(pages.length)}
          </span>
        }
      >
        {multi ? (
          <Segmented<PagesMode>
            aria-label="Pages to download"
            size="sm"
            fullWidth
            value={settings.pagesMode}
            onChange={(pagesMode) => patch({ pagesMode })}
            options={[
              { value: "all", label: "All pages" },
              { value: "current", label: "Current page" },
              { value: "custom", label: "Custom" },
            ]}
          />
        ) : null}
        {multi && settings.pagesMode === "custom" ? (
          <>
            <div className="cf-dl__bulk">
              <Button size="sm" variant="ghost" onClick={() => setCustom(new Set(Array.from({ length: pageCount }, (_v, i) => i)))} disabled={customSet.size === pageCount}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCustom(new Set())} disabled={customSet.size === 0}>
                Select none
              </Button>
            </div>
            <PageGrid design={design} selected={customSet} onToggle={toggleCustom} />
          </>
        ) : null}
        {multi && settings.pagesMode !== "custom" ? (
          <p className="cf-dl__hint">
            {settings.pagesMode === "current" ? `Page ${activeIndex + 1} of ${pageCount}` : "Every page in this design"}
            {pages.length > 1 && animated ? " - played one after another" : pages.length > 1 && format !== "pdf" && !bundle ? " - saved together as a .zip" : ""}
          </p>
        ) : null}
      </Field>

      <div className="cf-dl__footer">
        <p className="cf-dl__estimate">
          {pages.length ? (
            <>
              Estimated size <strong>~{formatBytes(estimate)}</strong>
              {animation ? <> · {formatDuration(animation.total)}</> : null}
              {sizePlan ? <> · {sizePlan.files === 1 ? "1 file" : `${sizePlan.files} files`}</> : null}
            </>
          ) : (
            "Select at least one page to download."
          )}
        </p>
        <Button variant="primary" size="lg" block icon={<IconDownload aria-hidden="true" />} loading={busy} disabled={!pages.length || !!refusal} onClick={run}>
          Download
        </Button>
        {busy ? (
          <div className="cf-dl__progress">
            <div className="cf-dl__bar" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${Math.max(6, (progress.done / progress.total) * 100)}%` }} />
            </div>
            <div className="cf-dl__status">
              <span role="status">{status}</span>
              <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
