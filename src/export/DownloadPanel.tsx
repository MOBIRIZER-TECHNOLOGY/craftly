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
  IconPrint,
  IconVideo,
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
import { downloadBlob, exportDesign } from "./exporters";
import { MAX_EXPORT_SIDE, estimateExportBytes, formatBytes, pagesLabel, planRaster, resolveExportOptions } from "./options";
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

type FileKey = "png" | "jpg" | "pdf-standard" | "pdf-print" | "svg" | "gif" | "webm";

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
  const estimate = useMemo(() => (design && pages.length ? estimateExportBytes(design, options) : 0), [design, options, pages.length]);
  // a GIF or video: the timeline of the chosen pages (picture size, length, whether anything moves)
  const animation = useMemo(
    () => (design && pages.length && isAnimatedFormat(options.format) ? resolveExportOptions(design, options).animation : null),
    [design, options, pages.length],
  );
  const video = getVideoSupport();
  const fileOptions = useMemo(() => optionsFor(video), [video]);
  const tabHidden = useTabHidden(progress !== null && settings.format === "webm");

  if (!design) return <div className="cf-dl cf-dl--empty">Open a design to download it.</div>;

  const busy = progress !== null;
  const multi = pageCount > 1;
  const sizing = sizeText(design, settings.scale);
  const animated = isAnimatedFormat(settings.format);
  const problem = animation ? animationProblem(animation) : null;
  /** many sites refuse GIFs bigger than this */
  const bigGif = settings.format === "gif" && estimate > 15 * 1024 * 1024;

  const toggleCustom = (index: number) => {
    const next = new Set(customSet);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCustom(next);
  };

  const run = async () => {
    if (abortRef.current || !pages.length || problem) return; // the ref (not `busy`) is the lock: two clicks in one tick must not start two exports
    const controller = new AbortController();
    abortRef.current = controller;
    const total = pages.length;
    setProgress({ done: 0, total });
    try {
      const file = await exportDesign(design, options, (done, of) => alive.current && setProgress({ done, total: of }), controller.signal);
      downloadBlob(file.blob, file.name);
      toast.show({ kind: "success", message: `Downloaded ${file.name}` });
      if (file.note) toast.show({ kind: "info", message: file.note, duration: 9000 });
      if (alive.current) onDone?.();
    } catch (error) {
      if (isCancelled(error)) toast.show({ kind: "info", message: "Download cancelled" });
      else {
        console.error("Export failed", error);
        toast.show({ kind: "error", message: describeExportError(error, { scale: options.format === "png" || options.format === "jpg" ? options.scale : undefined }) });
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
      : settings.format === "webm"
        ? tabHidden
          ? "Recording pauses while this tab is in the background. Switch back to keep going."
          : `Recording ${Math.floor(progress.done / VIDEO_FPS)} s of ${Math.round(progress.total / VIDEO_FPS)} s…`
        : settings.format === "gif"
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
          value={fileKeyOf(settings)}
          options={fileOptions}
          disabled={busy}
          onChange={(key) => {
            if (key === "pdf-standard") patch({ format: "pdf", pdfMode: "standard" });
            else if (key === "pdf-print") patch({ format: "pdf", pdfMode: "print" });
            else patch({ format: key });
          }}
        />
      </Field>

      {settings.format === "png" && (
        <div className="cf-dl__group">
          {sliderSize}
          <Switch checked={settings.transparent} onChange={(transparent) => patch({ transparent })} label="Transparent background" disabled={busy} />
        </div>
      )}

      {settings.format === "jpg" && (
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

      {settings.format === "pdf" && (
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
        </div>
      )}

      {settings.format === "svg" && (
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
          {settings.format === "gif" ? (
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
            {pages.length > 1 && animated ? " - played one after another" : pages.length > 1 && settings.format !== "pdf" ? " - saved together as a .zip" : ""}
          </p>
        ) : null}
      </Field>

      <div className="cf-dl__footer">
        <p className="cf-dl__estimate">
          {pages.length ? (
            <>
              Estimated size <strong>~{formatBytes(estimate)}</strong>
              {animation ? <> · {formatDuration(animation.total)}</> : null}
            </>
          ) : (
            "Select at least one page to download."
          )}
        </p>
        <Button variant="primary" size="lg" block icon={<IconDownload aria-hidden="true" />} loading={busy} disabled={!pages.length || !!problem} onClick={run}>
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
