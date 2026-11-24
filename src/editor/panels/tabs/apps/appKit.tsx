/**
 * Building blocks shared by the built-in apps: the page frame (header, scrolling body, pinned action footer),
 * a compact colour field and the module state that remembers which app is open.
 */
import { useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { m } from "@/i18n";
import { ColorPicker, ColorSwatch, Popover, cx } from "@/ui";
import { PanelHeader } from "../../shared/PanelHeader";
import { Panel, PanelScroll, PanelTop } from "../../shared/PanelLayout";
import "./appKit.css";

export type AppId = "qr" | "emoji" | "lorem" | "placeholder" | "palette" | "bulk";

interface AppsNav {
  app: AppId | null;
  query: string;
  open(app: AppId): void;
  back(): void;
  setQuery(q: string): void;
}

/** Which app is open survives switching to another side-panel tab and back. */
export const useAppsNav = create<AppsNav>()((set) => ({
  app: null,
  query: "",
  open: (app) => set({ app }),
  back: () => set({ app: null }),
  setQuery: (query) => set({ query }),
}));

export interface AppPageProps {
  title: string;
  subtitle?: string;
  /** fixed area under the header (search field, chips ...) */
  top?: ReactNode;
  children: ReactNode;
  /** pinned at the bottom of the panel, e.g. the primary "Add to design" button */
  footer?: ReactNode;
  scrollClassName?: string;
}

export function AppPage({ title, subtitle, top, children, footer, scrollClassName }: AppPageProps) {
  const back = useAppsNav((s) => s.back);
  return (
    <Panel>
      <PanelTop>
        <PanelHeader title={title} subtitle={subtitle} onBack={back} backLabel={m.panelsTabs.appKit.back} />
        {top}
      </PanelTop>
      <PanelScroll className={scrollClassName}>{children}</PanelScroll>
      {footer ? <div className="cf-app__footer">{footer}</div> : null}
    </Panel>
  );
}

/** A labelled group of controls inside an app. */
export function AppField({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("cf-app__field", className)}>
      <div className="cf-app__label">{label}</div>
      {children}
      {hint ? <p className="cf-app__hint">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* colour field                                                         */
/* ------------------------------------------------------------------ */

export interface ColorButtonProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** quick picks shown above the full picker */
  presets?: string[];
}

/** A swatch + hex code that opens a popover with quick picks and the full colour picker. */
export function ColorButton({ value, onChange, label, presets }: ColorButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="cf-app__color"
        aria-label={m.panelsTabs.appKit.colorButton(label, value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ColorSwatch color={value} size={22} />
        <span className="cf-app__color-hex">{value.toUpperCase()}</span>
      </button>
      <Popover open={open} anchor={ref.current} onClose={() => setOpen(false)} placement="bottom-start" className="cf-app__picker" aria-label={label}>
        {presets?.length ? (
          <div className="cf-app__presets" role="group" aria-label={m.panelsTabs.appKit.quickColours}>
            {presets.map((c) => (
              <ColorSwatch key={c} color={c} size={24} selected={c.toLowerCase() === value.toLowerCase()} title={c} onClick={() => onChange(c)} />
            ))}
          </div>
        ) : null}
        <ColorPicker value={value} onChange={onChange} />
      </Popover>
    </>
  );
}
