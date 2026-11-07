import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  Button,
  EmptyState,
  IconBanner,
  IconButton,
  IconCustomSize,
  IconDocument,
  IconEffects,
  IconLink,
  IconLogo,
  IconPresentation,
  IconPrint,
  IconSearch,
  IconSocial,
  IconUnlink,
  IconUpload,
  Modal,
  NumberField,
  SearchField,
  Select,
  cx,
  type SelectOption,
} from "@/ui";
import type { SizeUnit } from "@/core/types";
import { isAcceptedImage } from "@/core/assets";
import { DESIGN_CATEGORY_LABELS, DESIGN_TYPES, POPULAR_DESIGN_TYPES, describeSize, fromPx, toPx, type DesignCategory, type DesignType } from "@/data/designTypes";
import { MAX_SIZE_PX, MIN_SIZE_PX, createBlankAndOpen, createCustomAndOpen, createFromImageFile, IMAGE_ACCEPT } from "./actions";
import { closeCreateDialog, useCreateDialog, type CreateTab } from "./createDialogState";
import { useFolders } from "./data";
import { CustomSizeTile, DesignTypeTile } from "./DesignTypeTile";
import { DesignMock } from "./DesignMock";
import { pickFiles } from "./files";
import { matchesWords, parseSizeQuery, searchWords } from "./format";
import "./CreateDialog.css";

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */

const categoryColor = (category: DesignCategory): string => DESIGN_TYPES.find((type) => type.category === category)?.color ?? "var(--c-primary)";

interface NavItem {
  id: CreateTab;
  label: string;
  icon: ReactNode;
  color: string;
}

const NAV: NavItem[] = [
  { id: "for-you", label: "For you", icon: <IconEffects aria-hidden="true" />, color: "var(--c-primary)" },
  { id: "presentation", label: DESIGN_CATEGORY_LABELS.presentation, icon: <IconPresentation aria-hidden="true" />, color: categoryColor("presentation") },
  { id: "social", label: DESIGN_CATEGORY_LABELS.social, icon: <IconSocial aria-hidden="true" />, color: categoryColor("social") },
  { id: "print", label: DESIGN_CATEGORY_LABELS.print, icon: <IconPrint aria-hidden="true" />, color: categoryColor("print") },
  { id: "document", label: DESIGN_CATEGORY_LABELS.document, icon: <IconDocument aria-hidden="true" />, color: categoryColor("document") },
  { id: "branding", label: DESIGN_CATEGORY_LABELS.branding, icon: <IconLogo aria-hidden="true" />, color: categoryColor("branding") },
  { id: "marketing", label: DESIGN_CATEGORY_LABELS.marketing, icon: <IconBanner aria-hidden="true" />, color: categoryColor("marketing") },
  { id: "custom", label: "Custom size", icon: <IconCustomSize aria-hidden="true" />, color: "var(--c-ink-2)" },
  { id: "upload", label: "Upload", icon: <IconUpload aria-hidden="true" />, color: "var(--c-ink-2)" },
];

/* ------------------------------------------------------------------ */
/* Dialog                                                             */
/* ------------------------------------------------------------------ */

/** "Create a design": search, categories, illustrated design-type tiles, custom size and upload. */
export function CreateDialog() {
  const state = useCreateDialog();
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Modal open={state.open} onClose={closeCreateDialog} size="xl" flush className="cf-create-modal" aria-label="Create a design" initialFocusRef={searchRef}>
      <CreateBody initialTab={state.tab} initialQuery={state.query} folderId={state.folderId} searchRef={searchRef} />
    </Modal>
  );
}

interface BodyProps {
  initialTab: CreateTab;
  initialQuery: string;
  folderId: string | null;
  searchRef: RefObject<HTMLInputElement | null>;
}

function CreateBody({ initialTab, initialQuery, folderId, searchRef }: BodyProps) {
  const [tab, setTab] = useState<CreateTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const { folders } = useFolders();
  const folder = folderId ? folders.find((item) => item.id === folderId) : undefined;
  const words = useMemo(() => searchWords(query), [query]);
  const searching = words.length > 0;
  const options = { folderId };

  const onNavKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const move =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
    if (move === null) return;
    event.preventDefault();
    // move from the tab that has focus (it is the selected one unless the user tabbed around)
    const focused = (event.target as HTMLElement).closest<HTMLElement>("[role=tab]")?.id.replace("cf-create-tab-", "");
    const index = NAV.findIndex((item) => item.id === (focused ?? tab));
    const next = move === "first" ? 0 : move === "last" ? NAV.length - 1 : (index + move + NAV.length) % NAV.length;
    setTab(NAV[next].id);
    setQuery("");
    requestAnimationFrame(() => document.getElementById(`cf-create-tab-${NAV[next].id}`)?.focus());
  };

  let content: ReactNode;
  if (searching)
    content = (
      <SearchResults
        query={query}
        words={words}
        onCustom={() => {
          setQuery("");
          setTab("custom");
        }}
        options={options}
      />
    );
  else if (tab === "for-you") {
    content = (
      <>
        <h3 className="cf-create__heading">Popular on Craftly</h3>
        <TileGrid types={POPULAR_DESIGN_TYPES} options={options} />
      </>
    );
  } else if (tab === "custom") content = <CustomSizePanel folderId={folderId} />;
  else if (tab === "upload") content = <UploadPanel folderId={folderId} />;
  else {
    content = (
      <>
        <h3 className="cf-create__heading">{DESIGN_CATEGORY_LABELS[tab]}</h3>
        <TileGrid types={DESIGN_TYPES.filter((type) => type.category === tab)} options={options} />
      </>
    );
  }

  const activeLabel = NAV.find((item) => item.id === tab)?.label ?? "";

  return (
    <div className="cf-create">
      <aside className="cf-create__side">
        <h2 className="cf-create__title">Create a design</h2>
        {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs are the focusable parts; the arrow keys move between them */}
        <div className="cf-create__nav" role="tablist" aria-orientation="vertical" aria-label="Design categories" onKeyDown={onNavKey}>
          {NAV.map((item) => {
            const selected = !searching && item.id === tab;
            return (
              <button
                key={item.id}
                id={`cf-create-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={item.id === tab ? 0 : -1}
                className={cx("cf-create__tab", selected && "is-selected")}
                style={{ "--cf-nav-color": item.color } as CSSProperties}
                onClick={() => {
                  setTab(item.id);
                  setQuery("");
                }}
              >
                <span className="cf-create__tab-icon">{item.icon}</span>
                <span className="cf-create__tab-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="cf-create__main">
        <div className="cf-create__search">
          <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="What would you like to create?" aria-label="Search design types" />
        </div>
        {folder ? <p className="cf-create__folder">New designs are saved in “{folder.name}”.</p> : null}
        <div className="cf-create__content" role="tabpanel" aria-label={searching ? "Search results" : activeLabel}>
          {content}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tiles and search                                                   */
/* ------------------------------------------------------------------ */

function TileGrid({ types, options }: { types: DesignType[]; options: { folderId: string | null } }) {
  return (
    <div className="cf-create__grid">
      {types.map((type) => (
        <DesignTypeTile key={type.id} type={type} onClick={() => void createBlankAndOpen(type, options)} />
      ))}
    </div>
  );
}

function SearchResults({ query, words, onCustom, options }: { query: string; words: string[]; onCustom: () => void; options: { folderId: string | null } }) {
  const types = useMemo(
    () =>
      DESIGN_TYPES.filter((type) =>
        matchesWords(`${type.name} ${type.id.replace(/-/g, " ")} ${DESIGN_CATEGORY_LABELS[type.category]} ${describeSize(type.width, type.height, type.unit)}`, words),
      ),
    [words],
  );
  const size = parseSizeQuery(query);

  if (types.length === 0 && !size) {
    return (
      <EmptyState
        icon={<IconSearch />}
        title={`No design types match “${query.trim()}”`}
        text="Try a word like poster, instagram or resume, or type a size such as 1200 x 628."
        action={
          <Button variant="primary" icon={<IconCustomSize aria-hidden="true" />} onClick={onCustom}>
            Create a custom size
          </Button>
        }
      />
    );
  }

  return (
    <>
      <h3 className="cf-create__heading">Results for “{query.trim()}”</h3>
      <div className="cf-create__grid">
        {size ? (
          <CustomSizeTile
            width={size.width}
            height={size.height}
            spec={{ width: size.width, height: size.height, color: "var(--c-primary)", icon: IconCustomSize }}
            onClick={() => {
              const fit = clampSize(size.width, size.height);
              void createCustomAndOpen(fit.width, fit.height, "px", options);
            }}
          />
        ) : null}
        {types.map((type) => (
          <DesignTypeTile key={type.id} type={type} onClick={() => void createBlankAndOpen(type, options)} />
        ))}
      </div>
    </>
  );
}

const clampSize = (width: number, height: number) => ({
  width: Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, Math.round(width))),
  height: Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, Math.round(height))),
});

/* ------------------------------------------------------------------ */
/* Custom size                                                        */
/* ------------------------------------------------------------------ */

const UNIT_OPTIONS: SelectOption<SizeUnit>[] = [
  { value: "px", label: "px" },
  { value: "in", label: "in" },
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
];
const UNIT_STEP: Record<SizeUnit, number> = { px: 1, in: 0.1, mm: 1, cm: 0.1 };
const UNIT_PRECISION: Record<SizeUnit, number> = { px: 0, in: 2, mm: 1, cm: 2 };

const trimNumber = (n: number) => String(Number(n.toFixed(2)));

function CustomSizePanel({ folderId }: { folderId: string | null }) {
  const [unit, setUnit] = useState<SizeUnit>("px");
  const [widthPx, setWidthPx] = useState(1080);
  const [heightPx, setHeightPx] = useState(1080);
  const [locked, setLocked] = useState(false);

  const shown = (px: number) => Number(fromPx(px, unit).toFixed(UNIT_PRECISION[unit]));
  const valid = (px: number) => Number.isFinite(px) && px >= MIN_SIZE_PX && px <= MAX_SIZE_PX;
  const rangeText = `${trimNumber(fromPx(MIN_SIZE_PX, unit))} - ${trimNumber(fromPx(MAX_SIZE_PX, unit))} ${unit}`;
  const widthOk = valid(widthPx);
  const heightOk = valid(heightPx);
  const ready = widthOk && heightOk;

  const changeWidth = (value: number) => {
    const px = toPx(value, unit);
    if (locked && widthPx > 0) setHeightPx(px * (heightPx / widthPx));
    setWidthPx(px);
  };
  const changeHeight = (value: number) => {
    const px = toPx(value, unit);
    if (locked && heightPx > 0) setWidthPx(px * (widthPx / heightPx));
    setHeightPx(px);
  };

  const create = () => {
    if (!ready) return;
    void createCustomAndOpen(widthPx, heightPx, unit, { folderId });
  };

  return (
    <div className="cf-custom">
      <h3 className="cf-create__heading">Custom size</h3>
      <div className="cf-custom__layout">
        <div className="cf-custom__form">
          <div className="cf-custom__row">
            <div className="cf-custom__field">
              <label className="cf-custom__label" htmlFor="cf-custom-width">
                Width
              </label>
              <NumberField
                id="cf-custom-width"
                value={shown(widthPx)}
                onChange={changeWidth}
                step={UNIT_STEP[unit]}
                precision={UNIT_PRECISION[unit]}
                prefix={<span>W</span>}
                suffix={unit}
                aria-label="Width"
                scrub={false}
              />
            </div>
            <IconButton
              className="cf-custom__lock"
              label={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              icon={locked ? <IconLink aria-hidden="true" /> : <IconUnlink aria-hidden="true" />}
              active={locked}
              onClick={() => setLocked((value) => !value)}
            />
            <div className="cf-custom__field">
              <label className="cf-custom__label" htmlFor="cf-custom-height">
                Height
              </label>
              <NumberField
                id="cf-custom-height"
                value={shown(heightPx)}
                onChange={changeHeight}
                step={UNIT_STEP[unit]}
                precision={UNIT_PRECISION[unit]}
                prefix={<span>H</span>}
                suffix={unit}
                aria-label="Height"
                scrub={false}
              />
            </div>
          </div>

          <div className="cf-custom__field cf-custom__field--unit">
            <label className="cf-custom__label" htmlFor="cf-custom-unit">
              Units
            </label>
            <Select<SizeUnit> id="cf-custom-unit" value={unit} onChange={setUnit} options={UNIT_OPTIONS} aria-label="Units" />
          </div>

          {!widthOk || !heightOk ? (
            <p className="cf-custom__error" role="alert">
              {widthOk ? "Height" : heightOk ? "Width" : "Width and height"} must be between {rangeText}.
            </p>
          ) : (
            <p className="cf-custom__hint">
              {unit === "px" ? `Between ${rangeText} per side.` : `${Math.round(widthPx)} × ${Math.round(heightPx)} px. Between ${rangeText} per side.`}
            </p>
          )}

          <Button variant="primary" size="lg" disabled={!ready} onClick={create}>
            Create new design
          </Button>
        </div>

        <div className="cf-custom__preview" aria-hidden="true">
          <DesignMock spec={{ width: ready ? widthPx : 1, height: ready ? heightPx : 1, color: "var(--c-primary)", icon: IconCustomSize }} height={190} />
          <p className="cf-custom__dims">{describeSize(widthPx, heightPx, unit)}</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upload                                                             */
/* ------------------------------------------------------------------ */

function UploadPanel({ folderId }: { folderId: string | null }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const start = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!isAcceptedImage(file)) {
      setProblem("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG file.");
      return;
    }
    setBusy(true);
    const message = await createFromImageFile(file, { folderId });
    setBusy(false);
    if (message) setProblem(message);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void start(event.dataTransfer.files[0]);
  };

  const choose = () => {
    void pickFiles({ accept: IMAGE_ACCEPT }).then(([file]) => start(file));
  };

  return (
    <div className="cf-upload">
      <h3 className="cf-create__heading">Upload</h3>
      <div
        className={cx("cf-upload__zone", dragging && "is-dragging")}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <span className="cf-upload__icon" aria-hidden="true">
          <IconUpload />
        </span>
        <p className="cf-upload__title">Start a design from your photo</p>
        <p className="cf-upload__text">Drop an image here. The new design is sized to the picture and the picture fills the page.</p>
        <Button variant="primary" size="lg" loading={busy} icon={<IconUpload aria-hidden="true" />} onClick={choose}>
          Choose an image
        </Button>
        <p className="cf-upload__formats">PNG, JPG, WebP, GIF or SVG</p>
        {problem ? (
          <p className="cf-upload__error" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
