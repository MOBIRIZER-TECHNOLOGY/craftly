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
import { useActiveTeam } from "@/cloud/state";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { IMAGE_ACCEPT, createFolderAction, deleteFolderAction, moveDesignAction, renameFolderAction, uploadImageFiles } from "./actions";
import { openCreateDialog } from "./createDialogState";
import { useAssets, useDesigns, useFolders, useNow } from "./data";
import { DESIGN_DRAG_TYPE, DesignCard, DesignCardSkeleton } from "./DesignCard";
import { pickFiles } from "./files";
import { matchesWords, searchWords } from "./format";
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
  { value: "recent", label: m.dashboard.projects.mostRecent },
  { value: "oldest", label: m.dashboard.projects.oldest },
  { value: "az", label: m.dashboard.projects.az },
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
  // what a team's space holds is synced to the team's server, not kept on this device only: the words say where it is
  const team = useActiveTeam();
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
    return [{ value: "all", label: m.dashboard.projects.allTypes }, ...options];
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
        { id: "all", label: m.dashboard.shared.all },
        { id: "designs", label: m.dashboard.projects.designs },
      ]
    : [
        { id: "all", label: m.dashboard.shared.all },
        { id: "designs", label: m.dashboard.projects.designs },
        { id: "folders", label: m.dashboard.projects.folders },
        { id: "images", label: m.dashboard.projects.images },
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
        title={foldersReady ? m.dashboard.projects.folderNotFound : <Skeleton width={200} height={30} radius={8} />}
        above={<Breadcrumb folderName={null} onDropDesign={() => undefined} />}
      />
    );
  } else if (folder) {
    header = (
      <PageHeader
        above={<Breadcrumb folderName={folder.name} onDropDesign={(id) => moveDropped(id, null)} />}
        title={folder.name}
        subtitle={m.dashboard.counts.designs(folderCounts.get(folder.id) ?? 0)}
        actions={
          <>
            <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog({ folderId: folder.id })}>
              {m.dashboard.shared.createDesignShort}
            </Button>
            <IconButton
              label={m.dashboard.projects.folderOptions}
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
              aria-label={m.dashboard.projects.folderOptions}
              items={[
                { id: "rename", label: m.dashboard.actions.renameFolder, icon: <IconPen aria-hidden="true" />, onSelect: () => void renameFolderAction(folder) },
                {
                  id: "delete",
                  label: m.dashboard.shared.deleteFolder,
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
        title={m.dashboard.shell.nav.projects}
        subtitle={team ? m.dashboard.projects.teamSubtitle(team.name) : m.dashboard.projects.subtitle}
        actions={
          <>
            <Button variant="secondary" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
              {m.dashboard.shared.createFolder}
            </Button>
            <Button variant="secondary" icon={<IconUpload aria-hidden="true" />} onClick={upload}>
              {m.dashboard.shared.upload}
            </Button>
            <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
              {m.dashboard.shared.createDesignShort}
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
        title={m.dashboard.projects.missingTitle}
        text={m.dashboard.projects.missingText}
        action={
          <Button variant="primary" onClick={() => navigate("/projects")}>
            {m.dashboard.projects.backToProjects}
          </Button>
        }
      />
    );
  } else if (!ready) {
    body = (
      <div className="cf-projects__grid" aria-busy="true" aria-label={m.dashboard.projects.loading}>
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
        title={m.dashboard.projects.firstTitle}
        text={team ? m.dashboard.projects.teamFirstText : m.dashboard.projects.firstText}
        action={
          <div className="cf-projects__cta">
            <Button variant="primary" size="lg" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
              {m.dashboard.shared.createDesign}
            </Button>
            <Button variant="secondary" size="lg" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
              {m.dashboard.shared.createFolder}
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
        title={m.dashboard.projects.emptyFolderTitle}
        text={m.dashboard.projects.emptyFolderText}
        action={
          <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog({ folderId: folder?.id ?? null })}>
            {m.dashboard.shared.createDesignShort}
          </Button>
        }
      />
    ) : filtering || words.length > 0 ? (
      <EmptyState
        headingLevel={2}
        icon={<IconSearch />}
        title={words.length > 0 ? m.dashboard.projects.noMatch(query.trim()) : m.dashboard.projects.noFilterMatch}
        text={m.dashboard.projects.noMatchText}
        action={
          <Button variant="primary" onClick={clearFilters}>
            {m.dashboard.projects.clearFilters}
          </Button>
        }
      />
    ) : activeTab === "images" ? (
      <EmptyState
        headingLevel={2}
        icon={<IconImages />}
        title={m.dashboard.projects.noUploads}
        text={m.dashboard.projects.noUploadsText}
        action={
          <Button variant="primary" icon={<IconUpload aria-hidden="true" />} onClick={upload}>
            {m.dashboard.projects.uploadImages}
          </Button>
        }
      />
    ) : activeTab === "folders" ? (
      <EmptyState
        headingLevel={2}
        icon={<IconFolderPlus />}
        title={m.dashboard.projects.noFolders}
        text={m.dashboard.projects.noFoldersText}
        action={
          <Button variant="primary" icon={<IconFolderPlus aria-hidden="true" />} onClick={() => void createFolderAction()}>
            {m.dashboard.shared.createFolder}
          </Button>
        }
      />
    ) : (
      <EmptyState
        headingLevel={2}
        icon={<IconFolder />}
        title={m.dashboard.projects.noDesigns}
        text={team ? m.dashboard.projects.teamNoDesignsText : m.dashboard.projects.noDesignsText}
        action={
          <Button variant="primary" icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
            {m.dashboard.shared.createDesign}
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
            <span>{m.dashboard.projects.name}</span>
            <span>{m.dashboard.projects.type}</span>
            <span>{m.dashboard.projects.modified}</span>
            <span />
          </div>
        ) : null}
        {parts.folders.length > 0 ? (
          <section className="cf-projects__group" aria-label={m.dashboard.projects.folders}>
            {title(m.dashboard.projects.folders)}
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
          <section className="cf-projects__group" aria-label={m.dashboard.projects.designs}>
            {title(m.dashboard.projects.designs)}
            <div className={grid ? "cf-projects__grid" : "cf-projects__list"}>
              {parts.designs.map((design) => (
                <DesignCard key={design.id} design={design} folders={folders} now={now} layout={cardLayout} draggable />
              ))}
            </div>
          </section>
        ) : null}
        {parts.images.length > 0 ? (
          <section className="cf-projects__group" aria-label={m.dashboard.projects.images}>
            {title(m.dashboard.projects.images)}
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
          <Tabs variant="underline" aria-label={m.dashboard.projects.content} className="cf-projects__tabs" value={activeTab} onChange={(id) => setTab(id as Tab)} tabs={tabs} />

          <div className="cf-projects__toolbar" role="group" aria-label={m.dashboard.projects.toolbar}>
            <SearchField className="cf-projects__search" value={query} onChange={setQuery} placeholder={m.dashboard.projects.searchPlaceholder} />
            <Select<SortKey> className="cf-projects__select" value={sort} onChange={setSort} options={SORT_OPTIONS} aria-label={m.dashboard.projects.sortBy} width={158} />
            {designTab ? (
              <>
                <Select<string>
                  className="cf-projects__select"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={typeOptions}
                  aria-label={m.dashboard.projects.filterType}
                  width={190}
                />
                <Button
                  variant={starredOnly ? "soft" : "secondary"}
                  icon={<IconStar aria-hidden="true" className={starredOnly ? "cf-projects__star is-on" : "cf-projects__star"} />}
                  aria-pressed={starredOnly}
                  onClick={() => setStarredOnly((value) => !value)}
                >
                  {m.dashboard.projects.starred}
                </Button>
              </>
            ) : null}
            <Segmented<View>
              className="cf-projects__view"
              aria-label={m.dashboard.projects.view}
              value={view}
              onChange={changeView}
              options={[
                { value: "grid", icon: <IconGridView aria-hidden="true" />, title: m.dashboard.projects.gridView },
                { value: "list", icon: <IconListView aria-hidden="true" />, title: m.dashboard.projects.listView },
              ]}
            />
          </div>
        </>
      ) : null}

      <div className="cf-projects__body">{body}</div>
      <p className="cf-sr-only" aria-live="polite">
        {ready && total > 0 ? m.dashboard.projects.itemsShown(total) : ""}
      </p>
    </Page>
  );
}

/** "Projects > Folder name". Dropping a design on "Projects" moves it back out of the folder. */
function Breadcrumb({ folderName, onDropDesign }: { folderName: string | null; onDropDesign: (designId: string) => void }) {
  const [over, setOver] = useState(false);
  const carries = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DESIGN_DRAG_TYPE);
  return (
    <nav className="cf-projects__crumbs" aria-label={m.dashboard.projects.breadcrumb}>
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
            {m.dashboard.shell.nav.projects}
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
