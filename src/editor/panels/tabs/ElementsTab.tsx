import type { ReactNode } from "react";
import { IconBackground, IconChart, IconFrame, IconGrid, IconImage, IconShapes, IconSticker, IconTable } from "@/ui";
import { IconSlash } from "../shared/icons";
import { CategoryTile } from "../shared/CategoryTile";
import { ItemGrid } from "../shared/ItemGrid";
import { Panel, PanelScroll, PanelSection, PanelTop } from "../shared/PanelLayout";
import { PanelSearch } from "../shared/PanelSearch";
import { useDebounced } from "../shared/hooks";
import { BackgroundsPage } from "./elements/BackgroundsPage";
import { ChartsPage } from "./elements/ChartsPage";
import { FramesPage, GridsPage } from "./elements/FramesPage";
import { GraphicsPage } from "./elements/GraphicsPage";
import { useElementsNav, type ElementsPage } from "./elements/nav";
import { PhotosPage } from "./elements/PhotosPage";
import { ElementsSearchResults } from "./elements/SearchResults";
import { LinesPage, ShapesPage } from "./elements/ShapesPage";
import { TablesPage } from "./elements/TablesPage";
import "./elements/cells.css";
import "./ElementsTab.css";

interface Category {
  page: ElementsPage;
  label: string;
  icon: ReactNode;
  from: string;
  to: string;
}

/** Glossy "Browse categories" tiles. Colours are data: each tile is a soft two-stop gradient. */
const CATEGORIES: Category[] = [
  { page: "shapes", label: "Shapes", icon: <IconShapes />, from: "#34e0cf", to: "#0891b2" },
  { page: "graphics", label: "Graphics", icon: <IconSticker />, from: "#fcd34d", to: "#f97316" },
  { page: "photos", label: "Photos", icon: <IconImage />, from: "#7dd3fc", to: "#2563eb" },
  { page: "frames", label: "Frames", icon: <IconFrame />, from: "#86efac", to: "#16a34a" },
  { page: "grids", label: "Grids", icon: <IconGrid />, from: "#f0abfc", to: "#a21caf" },
  { page: "charts", label: "Charts", icon: <IconChart />, from: "#c4b5fd", to: "#6d28d9" },
  { page: "tables", label: "Tables", icon: <IconTable />, from: "#fdba74", to: "#e11d48" },
  { page: "lines", label: "Lines", icon: <IconSlash />, from: "#a5b4fc", to: "#4338ca" },
  { page: "backgrounds", label: "Backgrounds", icon: <IconBackground />, from: "#f9a8d4", to: "#be185d" },
];

/**
 * Elements: a search field and "Browse categories". Each category opens a sub-page with its own header, search and
 * content (shapes, graphics and icons, photos, frames, photo grids, charts, tables, lines, page backgrounds).
 * Typing in the overview's search searches shapes, graphics, photos and icons at once.
 */
export default function ElementsTab() {
  const page = useElementsNav((s) => s.page);
  switch (page) {
    case "shapes":
      return <ShapesPage />;
    case "graphics":
      return <GraphicsPage />;
    case "photos":
      return <PhotosPage />;
    case "frames":
      return <FramesPage />;
    case "grids":
      return <GridsPage />;
    case "charts":
      return <ChartsPage />;
    case "tables":
      return <TablesPage />;
    case "lines":
      return <LinesPage />;
    case "backgrounds":
      return <BackgroundsPage />;
    default:
      return <ElementsOverview />;
  }
}

function ElementsOverview() {
  const query = useElementsNav((s) => s.rootQuery);
  const setQuery = useElementsNav((s) => s.setRootQuery);
  const open = useElementsNav((s) => s.open);
  const debounced = useDebounced(query, 140);
  const searching = query.trim().length > 0;

  return (
    <Panel>
      <PanelTop>
        <PanelSearch value={query} onChange={setQuery} placeholder="Search elements" />
      </PanelTop>
      <PanelScroll>
        {searching ? (
          <ElementsSearchResults query={debounced} />
        ) : (
          <PanelSection title="Browse categories">
            <ItemGrid columns={3} minCell={92} gap={4} className="cf-elements__tiles">
              {CATEGORIES.map((c) => (
                <CategoryTile key={c.page} label={c.label} icon={c.icon} from={c.from} to={c.to} description={`Browse ${c.label.toLowerCase()}`} onClick={() => open(c.page)} />
              ))}
            </ItemGrid>
          </PanelSection>
        )}
      </PanelScroll>
    </Panel>
  );
}
