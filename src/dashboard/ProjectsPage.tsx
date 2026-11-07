import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import {
  Button,
  EmptyState,
  IconButton,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconGridView,
  IconImages,
  IconListView,
  IconMore,
  IconPen,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
  IconUpload,
  MenuPopover,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Tabs,
  cx,
  type SelectOption,
} from "@/ui";
import type { Asset, DesignSummary, Folder } from "@/core/types";
import { navigate } from "@/router";
import { IMAGE_ACCEPT, createFolderAction, deleteFolderAction, moveDesignAction, renameFolderAction, uploadImageFiles } from "./actions";
import { openCreateDialog } from "./createDialogState";
import { useAssets, useDesigns, useFolders, useNow } from "./data";
import { DESIGN_DRAG_TYPE, DesignCard, DesignCardSkeleton } from "./DesignCard";
import { pickFiles } from "./files";
import { matchesWords, plural, searchWords } from "./format";
import { FolderCard } from "./FolderCard";
import { ImageCard } from "./ImageCard";
import { fullTypeName, shortTypeName } from "./labels";
import { Page, PageHeader } from "./Page";
import "./ProjectsPage.css";

type Tab = "all" | "designs" | "folders" | "images";
type SortKey = "recent" | "oldest" | "az";
type View = "grid" | "list";

const VIEW_KEY = "craftly:projects-view";

const SORT_OPTIONS: SelectOption<SortKey>[] = [
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A-Z" },
];

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

function sortDesigns(list: DesignSummary[], sort: SortKey): DesignSummary[] {
  const copy = [...list];
  if (sort === "recent") copy.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (sort === "oldest") copy.sort((a, b) => a.updatedAt - b.updatedAt);
  else copy.sort((a, b) => byName(a.title, b.title));
  return copy;
}

function sortFolders(list: Folder[], sort: SortKey): Folder[] {
  const copy = [...list];
  if (sort === "recent") copy.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === "oldest") copy.sort((a, b) => a.createdAt - b.createdAt);
  else copy.sort((a, b) => byName(a.name, b.name));
  return copy;
}

function sortAssets(list: Asset[], sort: SortKey): Asset[] {
  const copy = [...list];
  if (sort === "recent") copy.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === "oldest") copy.sort((a, b) => a.createdAt - b.createdAt);
  else copy.sort((a, b) => byName(a.name, b.name));
  return copy;
}

/** Projects: all designs, folders and uploads with search, sort, filters, grid / list and drag to move. */
export function ProjectsPage({ folderId }: { folderId?: string }) {
  const { active: designs, ready: designsReady } = useDesigns();
  const { folders, ready: foldersReady } = useFolders();
  const { assets, ready: assetsReady } = useAssets();
  const now = useNow();

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [typeFilter, setTypeFilter] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [folderMenu, setFolderMenu] = useState<HTMLElement | null>(null);

  const folder = folderId ? folders.find((item) => item.id === folderId) : undefined;
  const inFolder = folderId !== undefined;
  const missingFolder = inFolder && foldersReady && !folder;
  const ready = designsReady && foldersReady && assetsReady;

  // a fresh folder starts with fresh filters
  useEffect(() => {
    setTab("all");
    setQuery("");
    setTypeFilter("all");
    setStarredOnly(false);
  }, [folderId]);

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* not remembered */
    }
  };

  const words = useMemo(() => searchWords(query), [query]);
  const folderIds = useMemo(() => new Set(folders.map((item) => item.id)), [folders]);

  // design types that exist in the library (for the Type filter)
  const typeOptions = useMemo<SelectOption<string>[]>(() => {
    const ids = [...new Set(designs.map((design) => design.typeId))];
    const options = ids.map((id) => ({ value: id, label: fullTypeName(id) })).sort((a, b) => byName(a.label, b.label));
    return [{ value: "all", label: "All types" }, ...options];
  }, [designs]);

  useEffect(() => {
    if (typeFilter !== "all" && !typeOptions.some((option) => option.value === typeFilter)) setTypeFilter("all");
  }, [typeFilter, typeOptions]);

  const designFilterActive = words.length > 0 || starredOnly || typeFilter !== "all";

  const visibleDesigns = useMemo(() => {
    // at the top level a search / filter looks through every folder; otherwise only what is in this place
    const scope = folder
      ? designs.filter((design) => design.folderId === folder.id)
      : designFilterActive
        ? designs
        : designs.filter((design) => !design.folderId || !folderIds.has(design.folderId));
    const matching = scope.filter(
      (design) =>
        (!starredOnly || design.starred) && (typeFilter === "all" || design.typeId === typeFilter) && matchesWords(`${design.title} ${shortTypeName(design.typeId)}`, words),
    );
    return sortDesigns(matching, sort);
  }, [designs, folder, folderIds, designFilterActive, starredOnly, typeFilter, words, sort]);

  const visibleFolders = useMemo(() => {
    if (starredOnly || typeFilter !== "all") return [];
    const parent = folder ? folder.id : null;
    return sortFolders(
      folders.filter((item) => (item.parentId ?? null) === parent && matchesWords(item.name, words)),
      sort,
    );
  }, [folders, folder, starredOnly, typeFilter, words, sort]);

  const visibleImages = useMemo(() => {
    if (folder) return [];
    return sortAssets(
      assets.filter((asset) => matchesWords(asset.name, words)),
      sort,
    );
  }, [assets, folder, words, sort]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const design of designs) if (design.folderId) counts.set(design.folderId, (counts.get(design.folderId) ?? 0) + 1);
    return counts;
  }, [designs]);

  // a folder has no sub-folders and no uploads, so its tab strip is shorter
  const activeTab: Tab = folder && (tab === "folders" || tab === "images") ? "all" : tab;
  const designTab = activeTab === "all" || activeTab === "designs";

  const showImagesInAll = !folder && !starredOnly && typeFilter === "all";
  const parts = {
    folders: activeTab === "all" || activeTab === "folders" ? visibleFolders : [],
    designs: activeTab === "all" || activeTab === "designs" ? visibleDesigns : [],
    images: activeTab === "images" || (activeTab === "all" && showImagesInAll) ? visibleImages : [],
  };
  const total = parts.folders.length + parts.designs.length + parts.images.length;
  const groupsShown = [parts.folders.length, parts.designs.length, parts.images.length].filter((n) => n > 0).length;
  const nothingAtAll = ready && designs.length === 0 && folders.length === 0 && assets.length === 0;
  const grid = view === "grid";

  const tabs = folder
    ? [
        { id: "all", label: "All" },
        { id: "designs", label: "Designs" },
      ]
    : [
        { id: "all", label: "All" },
        { id: "designs", label: "Designs" },
        { id: "folders", label: "Folders" },
        { id: "images", label: "Images" },
      ];

  const upload = () => {
    void pickFiles({ accept: IMAGE_ACCEPT, multiple: true }).then(async (files) => {
      if (files.length === 0) return;
      const stored = await uploadImageFiles(files);
      if (stored.length > 0) setTab("images");
    });
  };

  const clearFilters = () => {
    setQuery("");
    setStarredOnly(false);
    setTypeFilter("all");
  };

  const moveDropped = (designId: string, target: Folder | null) => {
    const design = designs.find((item) => item.id === designId);
    if (design) void moveDesignAction(design, target);
  };

  /* ---- header ---- */

  let header: ReactNode;
  if (inFolder && !folder) {
    // the folder list is still loading, or the id is unknown: never flash the top-level header
    header = (
      <PageHeader
        title={foldersReady ? "Folder not found" : <Skeleton width={200} height={30} radius={8} />}
        above={<Breadcrumb folderName={null} onDropDesign={() => undefined} />}
      />
    );
  } else if (folder) {
    header = (
      <PageHeader
        above={<Breadcrumb folderName={folder.name} onDropDesign={(id) => moveDropped(id, null)} />}
        title={folder.name}
        subtitle={plural(folderCounts.get(folder.id) ?? 0, "design")}
        actions={
          <>
            <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog({ folderId: folder.id })}>
              Create design
            </Button>
            <IconButton
              label="Folder options"
              icon={<IconMore aria-hidden="true" />}
              aria-haspopup="menu"
              aria-expanded={folderMenu !== null}
              onClick={(event) => setFolderMenu(event.currentTarget)}
            />
            <MenuPopover
              open={folderMenu !== null}
              anchor={folderMenu}
              onClose={() => setFolderMenu(null)}
              placement="bottom-end"
              aria-label="Folder options"
              items={[
                { id: "rename", label: "Rename folder", icon: <IconPen aria-hidden="true" />, onSelect: () => void renameFolderAction(folder) },
                {
                  id: "delete",
                  label: "Delete folder",
                  icon: <IconTrash aria-hidden="true" />,
                  danger: true,
                  onSelect: () => {
                    void deleteFolderAction(folder, folderCounts.get(folder.id) ?? 0).then((deleted) => {
                      if (deleted) navigate("/projects");
                    });
                  },
                },
              ]}
            />
          </>
        }
      />
    );
  } else {
    header = (
      <PageHeader
        title="Projects"
        subtitle="Your designs, folders and uploads, saved on this device."
        actions={
          <>
            <Button variant="secondary" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
              Create folder
            </Button>
            <Button variant="secondary" icon={<IconUpload aria-hidden="true" />} onClick={upload}>
              Upload
            </Button>
            <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
              Create design
            </Button>
          </>
        }
      />
    );
  }

  /* ---- body ---- */

  let body: ReactNode;
  if (missingFolder) {
    body = (
      <EmptyState
        headingLevel={2}
        icon={<IconFolder />}
        title="This folder doesn't exist"
        text="It may have been deleted. Your designs are safe in Projects."
        action={
          <Button variant="primary" onClick={() => navigate("/projects")}>
            Back to Projects
          </Button>
        }
      />
    );
  } else if (!ready) {
    body = (
      <div className="cf-projects__grid" aria-busy="true" aria-label="Loading your projects">
        {Array.from({ length: 8 }, (_unused, index) => (
          <DesignCardSkeleton key={index} />
        ))}
      </div>
    );
  } else if (nothingAtAll) {
    body = (
      <EmptyState
        headingLevel={2}
        icon={<IconFolder />}
        title="Start your first project"
        text="Designs you create are saved here on this device. Pick a size, start from a template or upload a photo."
        action={
          <div className="cf-projects__cta">
            <Button variant="primary" size="lg" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
              Create a design
            </Button>
            <Button variant="secondary" size="lg" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
              Create folder
            </Button>
          </div>
        }
      />
    );
  } else if (total === 0) {
    const filtering = designFilterActive;
    const emptyFolder = folder && !filtering && activeTab !== "images";
    body = emptyFolder ? (
      <EmptyState
        headingLevel={2}
        icon={<IconFolder />}
        title="This folder is empty"
        text="Drag designs here from Projects, or create a new design in this folder."
        action={
          <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog({ folderId: folder?.id ?? null })}>
            Create design
          </Button>
        }
      />
    ) : filtering || words.length > 0 ? (
      <EmptyState
        headingLevel={2}
        icon={<IconSearch />}
        title={words.length > 0 ? `Nothing matches “${query.trim()}”` : "Nothing matches your filters"}
        text="Try a different word, or clear the filters to see everything again."
        action={
          <Button variant="primary" onClick={clearFilters}>
            Clear search and filters
          </Button>
        }
      />
    ) : activeTab === "images" ? (
      <EmptyState
        headingLevel={2}
        icon={<IconImages />}
        title="No uploads yet"
        text="Upload photos and logos to use them in your designs, or to start a design from a picture."
        action={
          <Button variant="primary" icon={<IconUpload aria-hidden="true" />} onClick={upload}>
            Upload images
          </Button>
        }
      />
    ) : activeTab === "folders" ? (
      <EmptyState
        headingLevel={2}
        icon={<IconFolderPlus />}
        title="No folders yet"
        text="Folders keep related designs together. Drag a design onto a folder to file it."
        action={
          <Button variant="primary" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
            Create folder
          </Button>
        }
      />
    ) : (
      <EmptyState
        headingLevel={2}
        icon={<IconFolder />}
        title="No designs here yet"
        text="Designs you create appear here. Everything is saved on this device."
        action={
          <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
            Create a design
          </Button>
        }
      />
    );
  } else {
    const cardLayout = grid ? "grid" : "row";
    const title = (text: string) => (groupsShown > 1 ? <h2 className="cf-projects__group-title">{text}</h2> : null);
    body = (
      <>
        {!grid ? (
          <div className="cf-projects__listhead" aria-hidden="true">
            <span />
            <span>Name</span>
            <span>Type</span>
            <span>Modified</span>
            <span />
          </div>
        ) : null}
        {parts.folders.length > 0 ? (
          <section className="cf-projects__group" aria-label="Folders">
            {title("Folders")}
            <div className={grid ? "cf-projects__folders" : "cf-projects__list"}>
              {parts.folders.map((item) => (
                <FolderCard
                  key={item.id}
                  folder={item}
                  count={folderCounts.get(item.id) ?? 0}
                  now={now}
                  layout={grid ? "grid" : "row"}
                  onDropDesign={(id) => moveDropped(id, item)}
                />
              ))}
            </div>
          </section>
        ) : null}
        {parts.designs.length > 0 ? (
          <section className="cf-projects__group" aria-label="Designs">
            {title("Designs")}
            <div className={grid ? "cf-projects__grid" : "cf-projects__list"}>
              {parts.designs.map((design) => (
                <DesignCard key={design.id} design={design} folders={folders} now={now} layout={cardLayout} draggable />
              ))}
            </div>
          </section>
        ) : null}
        {parts.images.length > 0 ? (
          <section className="cf-projects__group" aria-label="Images">
            {title("Images")}
            <div className={grid ? "cf-projects__grid" : "cf-projects__list"}>
              {parts.images.map((asset) => (
                <ImageCard key={asset.id} asset={asset} now={now} layout={cardLayout} />
              ))}
            </div>
          </section>
        ) : null}
      </>
    );
  }

  const showToolbar = !missingFolder && !nothingAtAll;

  return (
    <Page className="cf-projects">
      {header}

      {showToolbar ? (
        <>
          <Tabs variant="underline" aria-label="Project content" className="cf-projects__tabs" value={activeTab} onChange={(id) => setTab(id as Tab)} tabs={tabs} />

          <div className="cf-projects__toolbar" role="group" aria-label="Search, sort and filter">
            <SearchField className="cf-projects__search" value={query} onChange={setQuery} placeholder="Search your content" />
            <Select<SortKey> className="cf-projects__select" value={sort} onChange={setSort} options={SORT_OPTIONS} aria-label="Sort by" width={158} />
            {designTab ? (
              <>
                <Select<string> className="cf-projects__select" value={typeFilter} onChange={setTypeFilter} options={typeOptions} aria-label="Filter by design type" width={190} />
                <Button
                  variant={starredOnly ? "soft" : "secondary"}
                  icon={<IconStar aria-hidden="true" className={starredOnly ? "cf-projects__star is-on" : "cf-projects__star"} />}
                  aria-pressed={starredOnly}
                  onClick={() => setStarredOnly((value) => !value)}
                >
                  Starred
                </Button>
              </>
            ) : null}
            <Segmented<View>
              className="cf-projects__view"
              aria-label="View"
              value={view}
              onChange={changeView}
              options={[
                { value: "grid", icon: <IconGridView aria-hidden="true" />, title: "Grid view" },
                { value: "list", icon: <IconListView aria-hidden="true" />, title: "List view" },
              ]}
            />
          </div>
        </>
      ) : null}

      <div className="cf-projects__body">{body}</div>
      <p className="cf-sr-only" aria-live="polite">
        {ready && total > 0 ? `${total} items shown` : ""}
      </p>
    </Page>
  );
}

/** "Projects > Folder name". Dropping a design on "Projects" moves it back out of the folder. */
function Breadcrumb({ folderName, onDropDesign }: { folderName: string | null; onDropDesign: (designId: string) => void }) {
  const [over, setOver] = useState(false);
  const carries = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DESIGN_DRAG_TYPE);
  return (
    <nav className="cf-projects__crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <a
            href="#/projects"
            className={cx("cf-projects__crumb", over && "is-drop-target")}
            onDragOver={(event) => {
              if (!carries(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              if (!carries(event)) return;
              event.preventDefault();
              setOver(false);
              const id = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
              if (id) onDropDesign(id);
            }}
          >
            Projects
          </a>
        </li>
        {folderName !== null ? (
          <>
            <li aria-hidden="true" className="cf-projects__crumb-sep">
              <IconChevronRight />
            </li>
            <li aria-current="page" className="cf-projects__crumb-current">
              {folderName}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
