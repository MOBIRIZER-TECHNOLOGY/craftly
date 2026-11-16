import { useMemo, type CSSProperties, type ReactNode } from "react";
import { m } from "@/i18n";
import { Badge, IconEmoji, IconImage, IconPalette, IconQrCode, IconSearch, IconSparkle, IconText } from "@/ui";
import { DraggableItem } from "../shared/DraggableItem";
import { EmptyHint } from "../shared/EmptyHint";
import { useDebounced } from "../shared/hooks";
import { Panel, PanelScroll, PanelSection, PanelTop } from "../shared/PanelLayout";
import { PanelSearch } from "../shared/PanelSearch";
import { EmojiApp } from "./apps/EmojiApp";
import { LoremApp } from "./apps/LoremApp";
import { PaletteApp } from "./apps/PaletteApp";
import { PlaceholderApp } from "./apps/PlaceholderApp";
import { QrApp } from "./apps/QrApp";
import { useAppsNav, type AppId } from "./apps/appKit";
import "./AppsTab.css";

interface AppDef {
  id: AppId;
  name: string;
  description: string;
  keywords: string;
  icon: ReactNode;
  from: string;
  to: string;
}

const APPS: AppDef[] = [
  {
    id: "qr",
    name: m.panelsTabs.apps.list.qr.name,
    description: m.panelsTabs.apps.list.qr.description,
    keywords: "qr code scan barcode link wifi url",
    icon: <IconQrCode />,
    from: "#a78bfa",
    to: "#6d28d9",
  },
  {
    id: "emoji",
    name: m.panelsTabs.apps.list.emoji.name,
    description: m.panelsTabs.apps.list.emoji.description,
    keywords: "emoji smiley emoticon sticker reaction",
    icon: <IconEmoji />,
    from: "#fcd34d",
    to: "#f97316",
  },
  {
    id: "lorem",
    name: m.panelsTabs.apps.list.lorem.name,
    description: m.panelsTabs.apps.list.lorem.description,
    keywords: "lorem ipsum dummy filler placeholder text copy",
    icon: <IconText />,
    from: "#5eead4",
    to: "#0d9488",
  },
  {
    id: "placeholder",
    name: m.panelsTabs.apps.list.placeholder.name,
    description: m.panelsTabs.apps.list.placeholder.description,
    keywords: "placeholder image picture frame mock dummy",
    icon: <IconImage />,
    from: "#7dd3fc",
    to: "#2563eb",
  },
  {
    id: "palette",
    name: m.panelsTabs.apps.list.palette.name,
    description: m.panelsTabs.apps.list.palette.description,
    keywords: "colour color palette image extract swatches brand",
    icon: <IconPalette />,
    from: "#f9a8d4",
    to: "#be185d",
  },
];

/**
 * Apps: small tools that run entirely in your browser. Each one opens in this panel and puts its result on the page.
 */
export default function AppsTab() {
  const app = useAppsNav((s) => s.app);
  switch (app) {
    case "qr":
      return <QrApp />;
    case "emoji":
      return <EmojiApp />;
    case "lorem":
      return <LoremApp />;
    case "placeholder":
      return <PlaceholderApp />;
    case "palette":
      return <PaletteApp />;
    default:
      return <AppList />;
  }
}

function AppList() {
  const query = useAppsNav((s) => s.query);
  const setQuery = useAppsNav((s) => s.setQuery);
  const open = useAppsNav((s) => s.open);
  const q = useDebounced(query, 100).trim().toLowerCase();
  const apps = useMemo(() => APPS.filter((a) => !q || `${a.name} ${a.description} ${a.keywords}`.toLowerCase().includes(q)), [q]);

  return (
    <Panel>
      <PanelTop>
        <PanelSearch value={query} onChange={setQuery} placeholder={m.panelsTabs.apps.search} />
      </PanelTop>
      <PanelScroll>
        {!q ? (
          <div className="cf-apps__banner">
            <div className="cf-apps__banner-text">
              <strong>{m.panelsTabs.apps.bannerTitle}</strong>
              <span>{m.panelsTabs.apps.bannerText}</span>
            </div>
            <span className="cf-apps__banner-art" aria-hidden="true">
              <IconSparkle />
            </span>
          </div>
        ) : null}
        <PanelSection title={q ? m.panelsTabs.apps.count(apps.length) : m.panelsTabs.apps.builtIn}>
          {apps.length ? (
            <div className="cf-apps__list">
              {apps.map((a) => (
                <DraggableItem key={a.id} label={m.panelsTabs.apps.itemLabel(a.name, a.description)} onInsert={() => open(a.id)} className="cf-apps__item" tooltip={false}>
                  <span className="cf-apps__tile" style={{ "--_from": a.from, "--_to": a.to } as CSSProperties} aria-hidden="true">
                    {a.icon}
                  </span>
                  <span className="cf-apps__text">
                    <strong>{a.name}</strong>
                    <span>{a.description}</span>
                    <Badge tone="neutral">{m.panelsTabs.apps.worksOffline}</Badge>
                  </span>
                </DraggableItem>
              ))}
            </div>
          ) : (
            <EmptyHint icon={<IconSearch />} title={m.panelsTabs.apps.noneTitle} text={m.panelsTabs.apps.noneText(q)} />
          )}
        </PanelSection>
      </PanelScroll>
    </Panel>
  );
}
