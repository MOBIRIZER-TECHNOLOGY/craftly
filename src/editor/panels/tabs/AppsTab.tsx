import { useMemo, type CSSProperties, type ReactNode } from "react";
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
    name: "QR code",
    description: "Make a scannable code for a link, Wi-Fi or text",
    keywords: "qr code scan barcode link wifi url",
    icon: <IconQrCode />,
    from: "#a78bfa",
    to: "#6d28d9",
  },
  {
    id: "emoji",
    name: "Emoji",
    description: "Search and drop emoji onto your design",
    keywords: "emoji smiley emoticon sticker reaction",
    icon: <IconEmoji />,
    from: "#fcd34d",
    to: "#f97316",
  },
  {
    id: "lorem",
    name: "Lorem ipsum",
    description: "Placeholder text by the paragraph, sentence or word",
    keywords: "lorem ipsum dummy filler placeholder text copy",
    icon: <IconText />,
    from: "#5eead4",
    to: "#0d9488",
  },
  {
    id: "placeholder",
    name: "Placeholder image",
    description: "A coloured stand-in picture at any size",
    keywords: "placeholder image picture frame mock dummy",
    icon: <IconImage />,
    from: "#7dd3fc",
    to: "#2563eb",
  },
  {
    id: "palette",
    name: "Colour palette from image",
    description: "Pull the main colours out of a picture",
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
        <PanelSearch value={query} onChange={setQuery} placeholder="Search apps" />
      </PanelTop>
      <PanelScroll>
        {!q ? (
          <div className="cf-apps__banner">
            <div className="cf-apps__banner-text">
              <strong>Tools that run right here</strong>
              <span>Nothing leaves your browser, and every app works offline.</span>
            </div>
            <span className="cf-apps__banner-art" aria-hidden="true">
              <IconSparkle />
            </span>
          </div>
        ) : null}
        <PanelSection title={q ? `${apps.length} app${apps.length === 1 ? "" : "s"}` : "Built into Craftly"}>
          {apps.length ? (
            <div className="cf-apps__list">
              {apps.map((a) => (
                <DraggableItem key={a.id} label={`${a.name}. ${a.description}`} onInsert={() => open(a.id)} className="cf-apps__item" tooltip={false}>
                  <span className="cf-apps__tile" style={{ "--_from": a.from, "--_to": a.to } as CSSProperties} aria-hidden="true">
                    {a.icon}
                  </span>
                  <span className="cf-apps__text">
                    <strong>{a.name}</strong>
                    <span>{a.description}</span>
                    <Badge tone="neutral">Works offline</Badge>
                  </span>
                </DraggableItem>
              ))}
            </div>
          ) : (
            <EmptyHint icon={<IconSearch />} title="No apps found" text={`Nothing matches "${q}". Try "qr", "emoji" or "palette".`} />
          )}
        </PanelSection>
      </PanelScroll>
    </Panel>
  );
}
