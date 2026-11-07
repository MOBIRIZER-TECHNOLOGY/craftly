/**
 * Which page of the Elements tab is open. Kept outside the component so the sub-page (and the text typed into its
 * search field) survives switching to another tab and back, like the editor this mirrors.
 */
import { create } from "zustand";

export type ElementsPage = "shapes" | "graphics" | "photos" | "frames" | "grids" | "charts" | "tables" | "lines" | "backgrounds";

export type GraphicsPane = "illustrations" | "icons";

interface ElementsNav {
  /** `null` = the "Browse categories" overview */
  page: ElementsPage | null;
  /** search text of the overview */
  rootQuery: string;
  /** search text of the open sub-page */
  query: string;
  graphicsPane: GraphicsPane;
  open(page: ElementsPage, query?: string, pane?: GraphicsPane): void;
  back(): void;
  setRootQuery(q: string): void;
  setQuery(q: string): void;
  setGraphicsPane(p: GraphicsPane): void;
}

export const useElementsNav = create<ElementsNav>()((set) => ({
  page: null,
  rootQuery: "",
  query: "",
  graphicsPane: "illustrations",
  open: (page, query = "", pane) => set((s) => ({ page, query, graphicsPane: pane ?? s.graphicsPane })),
  back: () => set({ page: null, query: "" }),
  setRootQuery: (rootQuery) => set({ rootQuery }),
  setQuery: (query) => set({ query }),
  setGraphicsPane: (graphicsPane) => set({ graphicsPane }),
}));
