/**
 * Dev-only showcase of the whole UI kit (open /showcase.html with the Vite dev server).
 * It doubles as a manual test bench: the "Overlays" tab exercises popovers, menus, modals and toasts,
 * including viewport-edge flipping and popovers opened from inside modals.
 */
import { useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import "./Showcase.css";
import {
  Avatar,
  Badge,
  BrandMark,
  Button,
  Checkbox,
  ColorPicker,
  ColorSwatch,
  ConfirmHost,
  ContextMenuHost,
  Divider,
  EmptyState,
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconButton,
  IconChevronDown,
  IconCloudSaved,
  IconCopy,
  IconCrop,
  IconDownload,
  IconEffects,
  IconFlipH,
  IconFolder,
  IconGridView,
  IconHome,
  IconImage,
  IconItalic,
  IconLayers,
  IconLock,
  IconMinus,
  IconMore,
  IconPlus,
  IconPresentation,
  IconRedo,
  IconShare,
  IconStar,
  IconStrikethrough,
  IconTemplate,
  IconTrash,
  IconUnderline,
  IconUndo,
  IconUpload,
  Kbd,
  Menu,
  MenuPopover,
  Modal,
  NumberField,
  Popover,
  RotateHandleIcon,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TextField,
  ToastHost,
  Tooltip,
  confirm,
  openContextMenu,
  sliderRatioToValue,
  sliderValueToRatio,
  toast,
  type MenuEntry,
  type PopoverPlacement,
} from "./index";
import * as iconModule from "./icons";

/* ------------------------------------------------------------------ */
/* Layout helpers                                                     */
/* ------------------------------------------------------------------ */

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="sc__section" aria-label={title}>
      <h2 className="sc__title">
        {title}
        {hint ? <small>{hint}</small> : null}
      </h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="sc__label">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Root                                                               */
/* ------------------------------------------------------------------ */

type TabId = "components" | "overlays" | "icons";

export function Showcase() {
  const [tab, setTab] = useState<TabId>("components");
  return (
    <div className="sc">
      <header className="sc__header">
        <div className="sc__brand">
          <BrandMark size={30} />
          <span>
            Craftly <small>UI kit</small>
          </span>
        </div>
        <div className="sc__spacer" />
        <Tabs
          variant="pill"
          aria-label="Showcase sections"
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          tabs={[
            { id: "components", label: "Components" },
            { id: "overlays", label: "Overlays" },
            { id: "icons", label: "Icons" },
          ]}
        />
      </header>
      <main className="sc__page">
        {tab === "components" ? <ComponentsTab /> : null}
        {tab === "overlays" ? <OverlaysTab /> : null}
        {tab === "icons" ? <IconsTab /> : null}
      </main>
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Components tab                                                     */
/* ------------------------------------------------------------------ */

const TOKEN_GROUPS: Array<{ title: string; tokens: Array<[string, string]> }> = [
  {
    title: "Brand",
    tokens: [
      ["--c-primary", "#fff"],
      ["--c-primary-hover", "#fff"],
      ["--c-primary-press", "#fff"],
      ["--c-primary-soft", "var(--c-primary)"],
      ["--c-primary-softer", "var(--c-primary)"],
      ["--c-ring", "#fff"],
      ["--c-teal", "#fff"],
      ["--c-blue", "#fff"],
    ],
  },
  {
    title: "Ink and lines",
    tokens: [
      ["--c-ink", "#fff"],
      ["--c-ink-2", "#fff"],
      ["--c-ink-3", "#fff"],
      ["--c-ink-4", "#fff"],
      ["--c-ink-5", "var(--c-ink)"],
      ["--c-line", "var(--c-ink)"],
      ["--c-line-strong", "var(--c-ink)"],
    ],
  },
  {
    title: "Surfaces",
    tokens: [
      ["--c-bg", "var(--c-ink)"],
      ["--c-bg-subtle", "var(--c-ink)"],
      ["--c-workspace", "var(--c-ink)"],
      ["--c-hover", "var(--c-ink)"],
      ["--c-press", "var(--c-ink)"],
    ],
  },
  {
    title: "Status",
    tokens: [
      ["--c-danger", "#fff"],
      ["--c-success", "#fff"],
      ["--c-warning", "var(--c-ink)"],
      ["--c-danger-soft", "var(--c-danger-ink)"],
      ["--c-success-soft", "var(--c-success-ink)"],
      ["--c-warning-soft", "var(--c-ink)"],
      ["--c-danger-ink", "#fff"],
      ["--c-danger-solid", "#fff"],
      ["--c-success-ink", "#fff"],
      ["--c-success-solid", "#fff"],
      ["--c-info-ink", "#fff"],
      ["--c-info-solid", "#fff"],
    ],
  },
];

function FoundationSection() {
  return (
    <Section title="Foundations" hint="tokens.css">
      <div className="sc__card sc__col" style={{ gap: 24 }}>
        {TOKEN_GROUPS.map((group) => (
          <div key={group.title}>
            <Label>{group.title}</Label>
            <div className="sc__tokens">
              {group.tokens.map(([name, ink]) => (
                <div key={name} className="sc__token" style={{ background: `var(${name})`, color: ink }}>
                  {name}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="sc__grid sc__grid--3">
          <div>
            <Label>Gradients</Label>
            <div className="sc__col" style={{ gap: 10 }}>
              <div className="sc__thumb" style={{ background: "var(--grad-brand)", height: 48 }} />
              <div className="sc__thumb" style={{ background: "var(--grad-brand-bright)", height: 48 }} />
              <div className="sc__thumb" style={{ background: "var(--grad-hero)", height: 48 }} />
              <div
                style={{
                  background: "var(--grad-text)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  fontSize: 28,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                Gradient text
              </div>
            </div>
          </div>
          <div>
            <Label>Radii</Label>
            <div className="sc__row" style={{ alignItems: "flex-end" }}>
              {(["xs", "sm", "md", "lg", "xl"] as const).map((r) => (
                <div key={r} className="sc__col" style={{ alignItems: "center", gap: 6 }}>
                  <div className="sc__radius" style={{ width: 48, height: 48, borderRadius: `var(--r-${r})` }} />
                  <span className="sc__note">{r}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label>Shadows</Label>
            <div className="sc__row" style={{ gap: 16, background: "var(--c-workspace)", padding: 16, borderRadius: 16 }}>
              {(["sh-1", "sh-2", "sh-float", "sh-pop"] as const).map((s) => (
                <div key={s} className="sc__shadow" style={{ width: 80, height: 56, boxShadow: `var(--${s})` }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="sc__type">
          <Label>Type scale - Plus Jakarta Sans</Label>
          <div style={{ fontSize: "var(--fs-3xl)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>Design anything</div>
          <div style={{ fontSize: "var(--fs-2xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>What will you design today?</div>
          <div style={{ fontSize: "var(--fs-xl)", fontWeight: 700 }}>Templates for you</div>
          <div style={{ fontSize: "var(--fs-lg)", fontWeight: 600 }}>Create a design from scratch</div>
          <div style={{ fontSize: "var(--fs-md)" }}>Body text at 14px - the quick brown fox jumps over the lazy dog.</div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-3)" }}>Caption 12.5px - Last edited 3 minutes ago</div>
        </div>
      </div>
    </Section>
  );
}

function HeroSection() {
  const [tab, setTab] = useState("home");
  const [query, setQuery] = useState("");
  return (
    <Section title="Dashboard hero" hint="Tabs (pill) + SearchField (lg) on --grad-hero">
      <div className="sc__hero">
        <h2>What will you design today?</h2>
        <Tabs
          variant="pill"
          aria-label="Dashboard"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "home", label: "Home", icon: <IconHome /> },
            { id: "templates", label: "Templates", icon: <IconTemplate /> },
          ]}
        />
        <SearchField
          size="lg"
          value={query}
          onChange={setQuery}
          placeholder="Search anything"
          trailing={
            <Button variant="primary" size="md">
              Search
            </Button>
          }
        />
      </div>
    </Section>
  );
}

function BrandBarSection() {
  return (
    <Section title="On the brand gradient" hint="--cf-ib-* and --cf-btn-ghost-* theme hooks">
      <div className="sc__topbar">
        <BrandMark variant="light" size={30} />
        <Button variant="ghost" iconRight={<IconChevronDown />}>
          File
        </Button>
        <Button variant="ghost">Resize</Button>
        <IconButton label="Undo" shortcut="Ctrl+Z" icon={<IconUndo />} />
        <IconButton label="Redo" shortcut="Ctrl+Shift+Z" icon={<IconRedo />} />
        <span className="sc__saved">
          <IconCloudSaved /> All changes saved
        </span>
        <span className="sc__topbar-title">Untitled design - Presentation</span>
        <Button variant="ghost" icon={<IconPresentation />}>
          Present
        </Button>
        <Button variant="secondary" icon={<IconShare />}>
          Share
        </Button>
      </div>
    </Section>
  );
}

function ButtonSection() {
  const [loading, setLoading] = useState(false);
  const variants = ["primary", "secondary", "soft", "ghost", "danger"] as const;
  return (
    <Section title="Buttons" hint="Button, IconButton">
      <div className="sc__card sc__col" style={{ gap: 20 }}>
        {(["lg", "md", "sm"] as const).map((size) => (
          <div key={size}>
            <Label>Size {size}</Label>
            <div className="sc__row">
              {variants.map((v) => (
                <Button key={v} variant={v} size={size}>
                  {v[0].toUpperCase() + v.slice(1)}
                </Button>
              ))}
              <Button variant="primary" size={size} icon={<IconPlus />}>
                Create design
              </Button>
              <Button variant="secondary" size={size} icon={<IconUpload />}>
                Upload
              </Button>
              <Button variant="soft" size={size} iconRight={<IconChevronDown />}>
                Options
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Label>States</Label>
          <div className="sc__row">
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1800);
              }}
            >
              {loading ? "Saving" : "Click to load"}
            </Button>
            <Button variant="danger" icon={<IconTrash />}>
              Delete
            </Button>
            <div style={{ width: 220 }}>
              <Button block variant="primary">
                Block button
              </Button>
            </div>
          </div>
        </div>
        <div>
          <Label>Icon buttons - sm / md / lg, hover for tooltips, one active, one disabled</Label>
          <div className="sc__row">
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className="sc__row" style={{ gap: 4 }}>
                <IconButton size={size} label="Copy" shortcut="Ctrl+C" icon={<IconCopy />} />
                <IconButton size={size} label="Lock" icon={<IconLock />} active />
                <IconButton size={size} label="Crop" icon={<IconCrop />} />
                <IconButton size={size} label="Delete" shortcut="Delete" icon={<IconTrash />} disabled />
                <IconButton size={size} label="More" icon={<IconMore />} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <Label>Floating toolbar sample</Label>
          <ToolbarSample />
        </div>
      </div>
    </Section>
  );
}

function ToolbarSample() {
  const [font, setFont] = useState("jakarta");
  const [size, setSize] = useState(34);
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strike, setStrike] = useState(false);
  const [align, setAlign] = useState("left");
  const [color, setColor] = useState("#7c3aed");
  const [open, setOpen] = useState(false);
  const colorBtn = useRef<HTMLButtonElement>(null);
  return (
    <div className="sc__toolbar">
      <div style={{ width: 168 }}>
        <Select
          aria-label="Font family"
          value={font}
          onChange={setFont}
          options={[
            { value: "jakarta", label: "Plus Jakarta Sans" },
            { value: "inter", label: "Inter" },
            { value: "playfair", label: "Playfair Display" },
            { value: "fredoka", label: "Fredoka" },
            { value: "caveat", label: "Caveat" },
          ]}
        />
      </div>
      <NumberField stepper value={size} onChange={setSize} min={1} max={400} aria-label="Font size" width={116} />
      <Divider vertical />
      <Tooltip content="Text colour">
        <button ref={colorBtn} type="button" className="sc__font-color" aria-label="Text colour" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>A</span>
          <i style={{ background: color }} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={colorBtn.current} placement="bottom-start" aria-label="Text colour">
        <div style={{ width: 264, padding: 16 }}>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </Popover>
      <IconButton label="Bold" shortcut="Ctrl+B" icon={<IconBold />} active={bold} onClick={() => setBold((v) => !v)} />
      <IconButton label="Italic" shortcut="Ctrl+I" icon={<IconItalic />} active={italic} onClick={() => setItalic((v) => !v)} />
      <IconButton label="Underline" shortcut="Ctrl+U" icon={<IconUnderline />} active={underline} onClick={() => setUnderline((v) => !v)} />
      <IconButton label="Strikethrough" shortcut="Ctrl+Shift+X" icon={<IconStrikethrough />} active={strike} onClick={() => setStrike((v) => !v)} />
      <Divider vertical />
      <Segmented
        size="sm"
        aria-label="Text alignment"
        value={align}
        onChange={setAlign}
        options={[
          { value: "left", icon: <IconAlignLeft />, title: "Align left" },
          { value: "center", icon: <IconAlignCenter />, title: "Align centre" },
          { value: "right", icon: <IconAlignRight />, title: "Align right" },
          { value: "justify", icon: <IconAlignJustify />, title: "Justify" },
        ]}
      />
      <Divider vertical />
      <Button variant="ghost" size="sm" icon={<IconEffects />}>
        Effects
      </Button>
    </div>
  );
}

function InputSection() {
  const [name, setName] = useState("Summer campaign");
  const [email, setEmail] = useState("not-an-email");
  const [query, setQuery] = useState("");
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [x, setX] = useState(120.5);
  const [rot, setRot] = useState(0);
  const [radius, setRadius] = useState(12);
  const [fmt, setFmt] = useState<string>("png");
  const [on, setOn] = useState(true);
  const [snap, setSnap] = useState(false);
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [all, setAll] = useState(false);
  return (
    <Section title="Inputs" hint="TextField, SearchField, NumberField, Select, Switch, Checkbox">
      <div className="sc__grid sc__grid--2">
        <div className="sc__card sc__col">
          <TextField label="Design name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled design" />
          <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} error="Enter a valid email address, like name@example.com." />
          <TextField label="With hint" hint="Shown below the field until there is an error." placeholder="Type something" defaultValue="" />
          <TextField label="Disabled" disabled value="Cannot edit" onChange={() => undefined} />
          <div>
            <Label>SearchField md</Label>
            <SearchField value={query} onChange={setQuery} placeholder="Search elements" />
          </div>
          <div>
            <Label>SearchField lg</Label>
            <SearchField size="lg" value={query} onChange={setQuery} placeholder="Search anything" />
          </div>
        </div>
        <div className="sc__card sc__col">
          <div>
            <Label>NumberField - drag the prefix, arrows (Shift x10), Enter commits, Esc reverts</Label>
            <div className="sc__grid sc__grid--2" style={{ gap: 10 }}>
              <NumberField value={w} onChange={setW} min={1} max={10000} prefix={<span>W</span>} label="Width" suffix="px" />
              <NumberField value={h} onChange={setH} min={1} max={10000} prefix={<span>H</span>} label="Height" suffix="px" />
              <NumberField value={x} onChange={setX} step={0.5} precision={1} prefix={<span>X</span>} label="X position" />
              <NumberField value={rot} onChange={setRot} min={-360} max={360} label="Rotate" suffix="deg" />
              <NumberField value={radius} onChange={setRadius} min={0} max={200} label="Radius" size="sm" />
              <NumberField value={5} onChange={() => undefined} label="Locked" disabled />
            </div>
          </div>
          <div>
            <Label>Select</Label>
            <div className="sc__row">
              <Select
                width={200}
                aria-label="File type"
                value={fmt}
                onChange={setFmt}
                options={[
                  { value: "png", label: "PNG - best for web" },
                  { value: "jpg", label: "JPG - smaller files" },
                  { value: "pdf", label: "PDF - print and share" },
                  { value: "svg", label: "SVG - vector" },
                  { value: "zip", label: "ZIP - all pages", disabled: true },
                ]}
              />
              <Select width={160} size="sm" aria-label="Empty" value={null} onChange={() => undefined} placeholder="Choose font" options={[{ value: "a", label: "Inter" }]} />
            </div>
          </div>
          <div className="sc__grid sc__grid--2" style={{ gap: 10 }}>
            <div className="sc__col" style={{ gap: 12 }}>
              <Label>Switch</Label>
              <Switch checked={on} onChange={setOn} label="Show rulers" />
              <Switch checked={snap} onChange={setSnap} label="Snap to guides" />
              <Switch checked disabled onChange={() => undefined} label="Disabled" />
            </div>
            <div className="sc__col" style={{ gap: 12 }}>
              <Label>Checkbox</Label>
              <Checkbox
                checked={all}
                indeterminate={a !== b}
                onChange={(v) => {
                  setAll(v);
                  setA(v);
                  setB(v);
                }}
                label="Select all pages"
              />
              <Checkbox
                checked={a}
                onChange={(v) => {
                  setA(v);
                  setAll(v && b);
                }}
                label="Page 1"
              />
              <Checkbox
                checked={b}
                onChange={(v) => {
                  setB(v);
                  setAll(v && a);
                }}
                label="Page 2"
              />
              <Checkbox checked={false} disabled onChange={() => undefined} label="Disabled" />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

function SliderSection() {
  const [opacity, setOpacity] = useState(80);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState(24);
  const [ended, setEnded] = useState("-");
  return (
    <Section title="Sliders" hint="Slider linear + log (zoom)">
      <div className="sc__card sc__grid sc__grid--2">
        <div className="sc__col" style={{ gap: 22 }}>
          <Slider
            label="Transparency"
            showValue
            value={opacity}
            min={0}
            max={100}
            onChange={setOpacity}
            onChangeEnd={(v) => setEnded(`onChangeEnd(${v})`)}
            format={(v) => `${Math.round(v)}%`}
          />
          <Slider label="Font size" showValue value={size} min={8} max={96} step={2} onChange={setSize} format={(v) => `${v}px`} />
          <Slider label="Disabled" showValue value={40} min={0} max={100} onChange={() => undefined} disabled />
          <div className="sc__note">Last drag end: {ended}</div>
        </div>
        <div className="sc__col" style={{ gap: 14 }}>
          <div className="sc__row" style={{ gap: 14 }}>
            <IconButton label="Zoom out" icon={<IconMinus />} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.25))} tooltip={false} />
            <div style={{ width: 220 }}>
              <Slider aria-label="Zoom" value={zoom} min={ZOOM_MIN} max={ZOOM_MAX} scale="log" onChange={setZoom} format={(v) => `${Math.round(v * 100)}%`} />
            </div>
            <IconButton label="Zoom in" icon={<IconPlus />} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.25))} tooltip={false} />
            <span className="sc__readout" data-testid="zoom-readout" style={{ minWidth: 70, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="sc__note">
            Log scale: 10% .. 800%. 100% sits at {(sliderValueToRatio(1, ZOOM_MIN, ZOOM_MAX, "log") * 100).toFixed(1)}% of the track; the track centre is{" "}
            {Math.round(sliderRatioToValue(0.5, ZOOM_MIN, ZOOM_MAX, "log") * 100)}%.
          </div>
        </div>
      </div>
    </Section>
  );
}

function TabsSection() {
  const [u, setU] = useState("design");
  const [p, setP] = useState("elements");
  const [s, setS] = useState("grid");
  const [d, setD] = useState<"light" | "dark" | "auto">("auto");
  const [n, setN] = useState<1 | 2 | 3>(2);
  return (
    <Section title="Tabs and Segmented">
      <div className="sc__card sc__col" style={{ gap: 22 }}>
        <div>
          <Label>Tabs - underline (arrow keys move, Home/End)</Label>
          <Tabs
            aria-label="Project"
            value={u}
            onChange={setU}
            tabs={[
              { id: "design", label: "Designs" },
              { id: "folders", label: "Folders" },
              { id: "images", label: "Images" },
              { id: "brand", label: "Brand kit", icon: <IconStar /> },
            ]}
          />
        </div>
        <div className="sc__row" style={{ gap: 32 }}>
          <div>
            <Label>Tabs - pill</Label>
            <Tabs
              variant="pill"
              aria-label="Panel"
              value={p}
              onChange={setP}
              tabs={[
                { id: "elements", label: "Elements" },
                { id: "text", label: "Text" },
                { id: "uploads", label: "Uploads" },
              ]}
            />
          </div>
          <div style={{ width: 280 }}>
            <Label>Tabs - full width</Label>
            <Tabs
              fullWidth
              aria-label="Position"
              value={u === "design" ? "arrange" : "layers"}
              onChange={() => undefined}
              tabs={[
                { id: "arrange", label: "Arrange" },
                { id: "layers", label: "Layers" },
              ]}
            />
          </div>
        </div>
        <div className="sc__row" style={{ gap: 32, alignItems: "flex-start" }}>
          <div>
            <Label>Segmented - icons only</Label>
            <Segmented
              aria-label="View"
              value={s}
              onChange={setS}
              options={[
                { value: "grid", icon: <IconGridView />, title: "Grid view" },
                { value: "layers", icon: <IconLayers />, title: "Layers" },
                { value: "flip", icon: <IconFlipH />, title: "Flip" },
              ]}
            />
          </div>
          <div>
            <Label>Segmented - labels</Label>
            <Segmented
              aria-label="Theme"
              value={d}
              onChange={setD}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "auto", label: "Auto" },
              ]}
            />
          </div>
          <div>
            <Label>Segmented - sm, numeric</Label>
            <Segmented
              size="sm"
              aria-label="Columns"
              value={n}
              onChange={setN}
              options={[
                { value: 1, label: "1" },
                { value: 2, label: "2" },
                { value: 3, label: "3" },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

const SWATCHES = ["#ffffff", "#0e1318", "#e5484d", "#f59e0b", "#16a34a", "#12c2b9", "#3b82f6", "#7c3aed", "#ec4899", "rgba(124,58,237,0.35)", "transparent"];

function ColorSection() {
  const [color, setColor] = useState("#7c3aed");
  const [rgba, setRgba] = useState("rgba(18,194,185,0.6)");
  const [end, setEnd] = useState("-");
  return (
    <Section title="Colour" hint="ColorSwatch, ColorPicker">
      <div className="sc__grid sc__grid--2">
        <div className="sc__card sc__col" style={{ gap: 20 }}>
          <div>
            <Label>Swatches - circle, selected ring, translucent on checkerboard</Label>
            <div className="sc__swatches">
              {SWATCHES.map((c) => (
                <ColorSwatch key={c} color={c} selected={c === color} onClick={() => setColor(c)} title={c} />
              ))}
            </div>
          </div>
          <div>
            <Label>Swatches - square, sizes</Label>
            <div className="sc__swatches" style={{ alignItems: "center" }}>
              <ColorSwatch color="#7c3aed" shape="square" size={20} />
              <ColorSwatch color="#12c2b9" shape="square" size={28} selected />
              <ColorSwatch color="rgba(229,72,77,0.5)" shape="square" size={40} />
              <ColorSwatch color="#f59e0b" shape="square" size={56} />
            </div>
          </div>
          <div className="sc__readout" data-testid="color-readout">
            {color}
          </div>
          <div className="sc__note">Last drag end: {end}</div>
        </div>
        <div className="sc__card sc__grid sc__grid--2" style={{ gap: 24 }}>
          <div>
            <Label>ColorPicker</Label>
            <ColorPicker value={color} onChange={setColor} onChangeEnd={(v) => setEnd(v)} />
          </div>
          <div>
            <Label>ColorPicker with alpha</Label>
            <ColorPicker value={rgba} onChange={setRgba} showAlpha />
            <div className="sc__readout" style={{ marginTop: 12 }} data-testid="rgba-readout">
              {rgba}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function MiscSection() {
  const sample: MenuEntry[] = [
    { id: "copy", label: "Copy", icon: <IconCopy />, shortcut: "Ctrl+C" },
    { id: "dup", label: "Duplicate", icon: <IconPlus />, shortcut: "Ctrl+D" },
    { type: "divider" },
    { id: "lock", label: "Lock", icon: <IconLock /> },
    { id: "trash", label: "Move to trash", icon: <IconTrash />, danger: true, shortcut: "Delete" },
  ];
  return (
    <Section title="Small things" hint="Spinner, Skeleton, Avatar, Badge, Kbd, Divider, EmptyState, Menu">
      <div className="sc__grid sc__grid--2">
        <div className="sc__card sc__col" style={{ gap: 20 }}>
          <div>
            <Label>Spinner</Label>
            <div className="sc__row" style={{ gap: 20 }}>
              <Spinner size={14} />
              <Spinner size={20} />
              <Spinner size={32} label="Loading designs" />
              <Spinner size={48} />
            </div>
          </div>
          <div>
            <Label>Avatar</Label>
            <div className="sc__row">
              <Avatar name="Pawan Kumar" size={24} />
              <Avatar name="Ada Lovelace" size={32} />
              <Avatar name="Grace Hopper" size={40} />
              <Avatar name="Linus T" size={48} />
              <Avatar name="Zoe" size={56} color="var(--c-teal)" />
            </div>
          </div>
          <div>
            <Label>Badge</Label>
            <div className="sc__row">
              <Badge>Neutral</Badge>
              <Badge tone="primary">New</Badge>
              <Badge tone="success">Saved</Badge>
              <Badge tone="warning">Draft</Badge>
              <Badge tone="danger">Error</Badge>
              <Badge tone="info">Beta</Badge>
              <Badge tone="primary" variant="solid">
                12
              </Badge>
              <Badge tone="danger" variant="solid">
                3
              </Badge>
            </div>
          </div>
          <div>
            <Label>Kbd</Label>
            <div className="sc__row" style={{ gap: 16 }}>
              <Kbd keys="Ctrl+Z" />
              <Kbd keys="Ctrl+Shift+Z" />
              <Kbd keys="Delete" />
              <Kbd keys="Shift+Arrow Up" />
              <Kbd>Space</Kbd>
            </div>
          </div>
          <div>
            <Label>Divider</Label>
            <div className="sc__row" style={{ gap: 12, height: 24 }}>
              <span>One</span>
              <Divider vertical />
              <span>Two</span>
              <Divider vertical />
              <span>Three</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Divider />
            </div>
          </div>
        </div>
        <div className="sc__card sc__col" style={{ gap: 20 }}>
          <div>
            <Label>Skeleton - template card loading</Label>
            <div className="sc__row" style={{ alignItems: "flex-start", gap: 14, flexWrap: "nowrap" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="sc__col" style={{ gap: 8, flex: 1 }}>
                  <Skeleton height={86} radius={12} />
                  <Skeleton width="70%" height={12} />
                  <Skeleton width="45%" height={10} />
                </div>
              ))}
              <Skeleton circle width={44} />
            </div>
          </div>
          <div>
            <Label>EmptyState</Label>
            <div style={{ border: "1px solid var(--c-line)", borderRadius: 16 }}>
              <EmptyState
                icon={<IconImage />}
                title="Upload, store and organize"
                text="Drop images or SVG files here to use them in any design. Files stay in your browser."
                action={
                  <Button variant="primary" icon={<IconUpload />}>
                    Upload files
                  </Button>
                }
              />
            </div>
          </div>
          <div>
            <Label>Menu (static surface)</Label>
            <Menu items={sample} onClose={() => undefined} autoFocus={false} aria-label="Sample menu" />
          </div>
        </div>
      </div>
    </Section>
  );
}

function ComponentsTab() {
  return (
    <>
      <HeroSection />
      <BrandBarSection />
      <ButtonSection />
      <InputSection />
      <SliderSection />
      <TabsSection />
      <ColorSection />
      <MiscSection />
      <FoundationSection />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Overlays tab                                                       */
/* ------------------------------------------------------------------ */

function useMenuItems(): MenuEntry[] {
  const [rulers, setRulers] = useState(true);
  const [snap, setSnap] = useState(false);
  const [view, setView] = useState("single");
  return useMemo<MenuEntry[]>(
    () => [
      { id: "new", label: "Create new design", icon: <IconPlus />, shortcut: "Ctrl+N", onSelect: () => toast.show({ message: "Create new design" }) },
      { id: "upload", label: "Upload files", icon: <IconUpload />, onSelect: () => toast.show({ message: "Upload files" }) },
      { type: "divider" },
      { id: "copy", label: "Make a copy", icon: <IconCopy />, onSelect: () => toast.success("Copy created") },
      {
        id: "view",
        label: "Page view",
        icon: <IconGridView />,
        submenu: [
          { id: "single", label: "Single page", checked: view === "single", onSelect: () => setView("single") },
          { id: "grid", label: "Grid view", checked: view === "grid", onSelect: () => setView("grid") },
          { id: "film", label: "Filmstrip", checked: view === "film", onSelect: () => setView("film") },
          { type: "divider" },
          {
            id: "more",
            label: "More layouts",
            submenu: [
              { id: "a", label: "Two pages" },
              { id: "b", label: "Spread" },
            ],
          },
        ],
      },
      { type: "label", label: "Rulers and guides" },
      { id: "rulers", label: "Show rulers", checked: rulers, shortcut: "Shift+R", onSelect: () => setRulers((v) => !v) },
      { id: "snap", label: "Snap to guides", checked: snap, hint: "Beta", onSelect: () => setSnap((v) => !v) },
      { type: "divider" },
      { id: "download", label: "Download", icon: <IconDownload />, hint: "PNG, PDF", shortcut: "Ctrl+Shift+D" },
      { id: "history", label: "Version history", icon: <IconFolder />, disabled: true },
      {
        id: "trash",
        label: "Move to trash",
        icon: <IconTrash />,
        danger: true,
        onSelect: () => toast.error("Moved to trash", { actionLabel: "Undo", onAction: () => toast.info("Restored") }),
      },
    ],
    [rulers, snap, view],
  );
}

const PLACEMENTS: PopoverPlacement[] = ["bottom-start", "bottom", "bottom-end", "top-start", "top", "top-end", "right-start", "left-start"];

function PopoverDemo() {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement>("bottom-start");
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="sc__card sc__col">
      <Label>Popover - pick a placement; it flips and shifts near edges</Label>
      <div className="sc__row">
        <div style={{ width: 160 }}>
          <Select aria-label="Placement" value={placement} onChange={setPlacement} options={PLACEMENTS.map((p) => ({ value: p, label: p }))} />
        </div>
        <Button ref={ref} variant="secondary" iconRight={<IconChevronDown />} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Open popover
        </Button>
        <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} placement={placement} aria-label="Share design">
          <div className="sc__popover-body">
            <h4>Share this design</h4>
            <p>Anyone with the exported file can open it. Craftly never uploads your work.</p>
            <div className="sc__row">
              <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
                Copy link
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Popover>
      </div>
      <div className="sc__note">Four buttons are pinned to the corners of the window while this tab is open; open them to check flipping.</div>
    </div>
  );
}

function CornerButton({ corner, placement }: { corner: "tl" | "tr" | "bl" | "br"; placement: PopoverPlacement }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className={`sc__corner sc__corner--${corner}`}>
      <Button ref={ref} size="sm" variant="soft" onClick={() => setOpen((v) => !v)} data-testid={`corner-${corner}`}>
        {corner.toUpperCase()}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} placement={placement} aria-label={`Corner ${corner}`}>
        <div className="sc__popover-body">
          <h4>Corner {corner.toUpperCase()}</h4>
          <p>Requested {placement}; the kit flips and shifts it into view.</p>
          <Button size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </Popover>
    </div>
  );
}

function MenuDemo() {
  const items = useMenuItems();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="sc__card sc__col">
      <Label>MenuPopover - arrows, Enter, Right/Left for submenus, type-ahead, Esc</Label>
      <div className="sc__row">
        <Button ref={ref} variant="secondary" iconRight={<IconChevronDown />} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          File
        </Button>
        <MenuPopover open={open} anchor={ref.current} onClose={() => setOpen(false)} items={items} aria-label="File menu" />
        <IconButton
          label="More actions"
          icon={<IconMore />}
          onClick={(e) => openContextMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4, items })}
        />
      </div>
    </div>
  );
}

function ContextDemo() {
  const items = useMenuItems();
  const [last, setLast] = useState("Right-click anywhere in this area");
  return (
    <div className="sc__card sc__col">
      <Label>Context menu - openContextMenu({"{ x, y, items }"})</Label>
      <div
        className="sc__stage"
        onContextMenu={(e) => {
          e.preventDefault();
          setLast(`Opened at ${Math.round(e.clientX)}, ${Math.round(e.clientY)}`);
          openContextMenu({ x: e.clientX, y: e.clientY, items });
        }}
      >
        {last}
      </div>
    </div>
  );
}

function ModalDemo() {
  const [size, setSize] = useState<"sm" | "md" | "lg" | "xl" | "full" | null>(null);
  const [fmt, setFmt] = useState("png");
  const [pages, setPages] = useState("all");
  const [tab, setTab] = useState("file");
  const [name, setName] = useState("");
  return (
    <div className="sc__card sc__col">
      <Label>Modal - focus trap, Esc, backdrop click, scroll lock. Dialog 1 contains Select + Popover to test layering.</Label>
      <div className="sc__row">
        {(["sm", "md", "lg", "xl", "full"] as const).map((s) => (
          <Button key={s} variant="secondary" onClick={() => setSize(s)} data-testid={`open-modal-${s}`}>
            Modal {s}
          </Button>
        ))}
      </div>
      <Modal
        open={size !== null}
        onClose={() => setSize(null)}
        size={size ?? "md"}
        title={size === "sm" ? "Rename design" : "Download"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSize(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<IconDownload />}
              onClick={() => {
                setSize(null);
                toast.success("Download started");
              }}
            >
              Download
            </Button>
          </>
        }
      >
        {size === "sm" ? (
          <TextField label="Design name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled design" />
        ) : (
          <div className="sc__col" style={{ gap: 18 }}>
            <Tabs
              aria-label="Download options"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "file", label: "File type" },
                { id: "pages", label: "Pages" },
                { id: "advanced", label: "Advanced" },
              ]}
            />
            <div className="sc__grid sc__grid--2">
              <div>
                <Label>File type</Label>
                <Select
                  aria-label="File type"
                  value={fmt}
                  onChange={setFmt}
                  options={[
                    { value: "png", label: "PNG" },
                    { value: "jpg", label: "JPG" },
                    { value: "pdf", label: "PDF" },
                    { value: "svg", label: "SVG" },
                  ]}
                />
              </div>
              <div>
                <Label>Pages</Label>
                <Segmented
                  aria-label="Pages"
                  fullWidth
                  value={pages}
                  onChange={setPages}
                  options={[
                    { value: "all", label: "All pages" },
                    { value: "current", label: "Current" },
                  ]}
                />
              </div>
            </div>
            <Slider label="Quality" showValue value={80} min={10} max={100} onChange={() => undefined} format={(v) => `${v}%`} />
            <Switch checked onChange={() => undefined} label="Transparent background" />
            {size === "xl" || size === "full" ? (
              <div className="sc__stage sc__checker" style={{ minHeight: 280 }}>
                Preview area
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ConfirmDemo() {
  const [result, setResult] = useState("-");
  return (
    <div className="sc__card sc__col">
      <Label>confirm() - resolves a boolean</Label>
      <div className="sc__row">
        <Button
          variant="secondary"
          data-testid="confirm-plain"
          onClick={async () => {
            const ok = await confirm({
              title: "Replace the page background?",
              message: "The current background will be replaced. You can undo this with Ctrl+Z.",
              confirmLabel: "Replace",
            });
            setResult(ok ? "confirmed" : "cancelled");
          }}
        >
          Confirm
        </Button>
        <Button
          variant="danger"
          data-testid="confirm-danger"
          icon={<IconTrash />}
          onClick={async () => {
            const ok = await confirm({
              title: "Move this design to trash?",
              message: "It stays in Trash for 30 days, then it is removed for good.",
              confirmLabel: "Move to trash",
              danger: true,
            });
            setResult(ok ? "confirmed (danger)" : "cancelled (danger)");
          }}
        >
          Danger confirm
        </Button>
        <span className="sc__readout" data-testid="confirm-result">
          Result: {result}
        </span>
      </div>
    </div>
  );
}

function ToastDemo() {
  return (
    <div className="sc__card sc__col">
      <Label>toast.show / success / error / info</Label>
      <div className="sc__row">
        <Button variant="secondary" onClick={() => toast.info("Your design was resized to 1080 x 1080")}>
          Info
        </Button>
        <Button variant="secondary" onClick={() => toast.success("All changes saved")}>
          Success
        </Button>
        <Button variant="secondary" onClick={() => toast.error("Could not export the file. Check that pop-ups are allowed and try again.")}>
          Error
        </Button>
        <Button variant="secondary" onClick={() => toast.show({ message: "Page deleted", kind: "info", actionLabel: "Undo", onAction: () => toast.success("Page restored") })}>
          With action
        </Button>
        <Button variant="secondary" onClick={() => toast.show({ message: "Stays until dismissed", duration: 0 })}>
          Sticky
        </Button>
        <Button variant="ghost" onClick={() => toast.clear()}>
          Clear all
        </Button>
      </div>
    </div>
  );
}

function TooltipDemo() {
  return (
    <div className="sc__card sc__col">
      <Label>Tooltip - hover or focus (placement, shortcut, instant when moving between buttons)</Label>
      <div className="sc__row" style={{ gap: 18 }}>
        {(["top", "bottom", "left", "right"] as const).map((p) => (
          <Tooltip key={p} content={`Tooltip on ${p}`} placement={p}>
            <Button variant="secondary">{p}</Button>
          </Tooltip>
        ))}
        <Tooltip content="Undo" shortcut="Ctrl+Z">
          <span style={{ display: "inline-flex" }}>
            <IconButton label="Undo" icon={<IconUndo />} tooltip={false} />
          </span>
        </Tooltip>
        <IconButton label="Redo" shortcut="Ctrl+Shift+Z" icon={<IconRedo />} />
        <IconButton label="Delete" shortcut="Delete" icon={<IconTrash />} />
        <Tooltip content="A longer tooltip that wraps onto a second line when the text is too wide for one row of the layout." placement="bottom">
          <Button variant="soft">Long text</Button>
        </Tooltip>
      </div>
    </div>
  );
}

function OverlaysTab() {
  return (
    <>
      <CornerButton corner="tl" placement="bottom-start" />
      <CornerButton corner="tr" placement="bottom-end" />
      <CornerButton corner="bl" placement="top-start" />
      <CornerButton corner="br" placement="right-start" />
      <Section title="Popovers and menus">
        <div className="sc__grid sc__grid--2">
          <PopoverDemo />
          <MenuDemo />
        </div>
      </Section>
      <Section title="Context menu">
        <ContextDemo />
      </Section>
      <Section title="Dialogs">
        <div className="sc__grid sc__grid--2">
          <ModalDemo />
          <ConfirmDemo />
        </div>
      </Section>
      <Section title="Feedback">
        <div className="sc__grid sc__grid--2">
          <ToastDemo />
          <TooltipDemo />
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Icons tab                                                          */
/* ------------------------------------------------------------------ */

function IconsTab() {
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () =>
      Object.entries(iconModule)
        .filter(([name]) => name.startsWith("Icon"))
        .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, ComponentType<{ size?: number }>]>,
    [],
  );
  const shown = entries.filter(([name]) => name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Section title="Icons" hint={`${entries.length} semantic icons from icons.ts`}>
      <div className="sc__col" style={{ gap: 16 }}>
        <div style={{ maxWidth: 420 }}>
          <SearchField value={query} onChange={setQuery} placeholder="Filter icons" />
        </div>
        <div className="sc__row" style={{ gap: 20 }}>
          <div className="sc__row" style={{ gap: 10 }}>
            <BrandMark size={40} />
            <BrandMark size={40} variant="light" style={{ background: "var(--grad-brand)", borderRadius: 12 }} />
            <span className="sc__note">BrandMark</span>
          </div>
          <div className="sc__row" style={{ gap: 10 }}>
            <span style={{ display: "inline-flex", padding: 8, borderRadius: "50%", background: "var(--c-bg)", boxShadow: "var(--sh-float)", color: "var(--c-ink)" }}>
              <RotateHandleIcon size={20} />
            </span>
            <span className="sc__note">RotateHandleIcon</span>
          </div>
        </div>
        <div className="sc__icons">
          {shown.map(([name, Icon]) => (
            <div key={name} className="sc__icon" title={name}>
              <Icon />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
