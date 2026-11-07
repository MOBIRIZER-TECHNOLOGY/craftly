import { useMemo, useRef, useState } from "react";
import { createFolder } from "@/core/library";
import { useEditor } from "@/core/store";
import type { DesignSummary, Folder } from "@/core/types";
import { getDesignType } from "@/data/designTypes";
import { designPath, navigate } from "@/router";
import { Badge, Button, IconFolder, IconPlus, IconSearch, IconStar, IconTemplate, Skeleton, Tabs, TextField, cx, toast } from "@/ui";
import { EmptyHint } from "../shared/EmptyHint";
import { useDebounced, useLibraryData } from "../shared/hooks";
import { DraggableItem } from "../shared/DraggableItem";
import { ItemGrid } from "../shared/ItemGrid";
import { Panel, PanelScroll, PanelSection, PanelTop } from "../shared/PanelLayout";
import { PanelHeader } from "../shared/PanelHeader";
import { PanelSearch } from "../shared/PanelSearch";
import "./ProjectsTab.css";

const STARRED = "__starred";
const VIEWS = [
  { id: "all", label: "All" },
  { id: "designs", label: "Designs" },
  { id: "folders", label: "Folders" },
];

/** "Presentation (16:9)" -> "Presentation" */
const typeLabel = (d: DesignSummary) => (getDesignType(d.typeId)?.name ?? "Custom size").replace(/\s*\(.*\)\s*$/, "");

/** Opens another design. The current one is saved first (the autosave listens for this event). */
function openDesign(id: string) {
  window.dispatchEvent(new Event("craftly:save-now"));
  navigate(designPath(id));
}

/** Starts the "Create a design" dialog of the dashboard. */
function createNew() {
  try {
    sessionStorage.setItem("craftly:open-create", "1");
  } catch {
    /* private mode: the dashboard simply opens without the dialog */
  }
  window.dispatchEvent(new Event("craftly:save-now"));
  navigate("/");
}

/**
 * Projects: your saved designs and folders, with search. Click a design to open it (the open one is saved first),
 * make folders and browse them, and start a new design from here.
 */
export default function ProjectsTab() {
  const { designs, folders } = useLibraryData();
  const currentId = useEditor((s) => s.design?.id ?? null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const q = useDebounced(query, 120).trim().toLowerCase();

  const live = useMemo(() => (designs ?? []).filter((d) => d.trashedAt === null), [designs]);
  const folder: Folder | null = openFolder && openFolder !== STARRED ? ((folders ?? []).find((f) => f.id === openFolder) ?? null) : null;

  const matches = (d: DesignSummary) => !q || d.title.toLowerCase().includes(q);
  const visibleDesigns = useMemo(() => {
    let list = live;
    if (openFolder === STARRED) list = list.filter((d) => d.starred);
    else if (openFolder) list = list.filter((d) => d.folderId === openFolder);
    return list.filter(matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, openFolder, q]);
  const visibleFolders = useMemo(() => (folders ?? []).filter((f) => !q || f.name.toLowerCase().includes(q)), [folders, q]);

  const loading = designs === null;
  const inFolder = openFolder !== null;
  const showDesigns = inFolder || view !== "folders";
  const showFolders = !inFolder && view !== "designs";

  return (
    <Panel>
      <PanelTop>
        <PanelSearch value={query} onChange={setQuery} placeholder="Search your content" />
        <Button variant="primary" size="lg" block icon={<IconPlus />} onClick={createNew}>
          Create new design
        </Button>
        {inFolder ? (
          <PanelHeader
            title={openFolder === STARRED ? "Starred" : (folder?.name ?? "Folder")}
            subtitle={`${visibleDesigns.length} design${visibleDesigns.length === 1 ? "" : "s"}`}
            onBack={() => setOpenFolder(null)}
            backLabel="Back to all projects"
          />
        ) : (
          <Tabs tabs={VIEWS} value={view} onChange={setView} fullWidth aria-label="Show" idBase="cf-projects" />
        )}
      </PanelTop>
      {/* the Show tabs control this area (inside a folder they are replaced by its header, and it is no tab panel) */}
      <PanelScroll
        role={inFolder ? undefined : "tabpanel"}
        id={inFolder ? undefined : `cf-projects-panel-${view}`}
        aria-labelledby={inFolder ? undefined : `cf-projects-tab-${view}`}
      >
        {showDesigns ? (
          <PanelSection title={inFolder ? undefined : "Designs"}>
            {loading ? (
              <ItemGrid columns={2} gap={10}>
                <Skeleton height={104} radius={12} />
                <Skeleton height={104} radius={12} />
              </ItemGrid>
            ) : visibleDesigns.length ? (
              <ItemGrid columns={2} gap={12} className="cf-proj__grid">
                {visibleDesigns.map((d) => (
                  <DesignCard key={d.id} design={d} current={d.id === currentId} />
                ))}
              </ItemGrid>
            ) : (
              <EmptyHint
                compact
                icon={q ? <IconSearch /> : <IconTemplate />}
                title={q ? "No designs found" : inFolder ? "Nothing in here yet" : "No saved designs yet"}
                text={
                  q ? `No design title contains "${q}".` : inFolder ? "Move designs into this folder from the dashboard." : "Your designs are saved automatically and show up here."
                }
              />
            )}
          </PanelSection>
        ) : null}
        {showFolders ? (
          <PanelSection title="Folders">
            <FolderList folders={visibleFolders} starredCount={live.filter((d) => d.starred).length} onOpen={setOpenFolder} hideStarred={!!q && !"starred".includes(q)} />
          </PanelSection>
        ) : null}
      </PanelScroll>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* design card                                                          */
/* ------------------------------------------------------------------ */

function DesignCard({ design, current }: { design: DesignSummary; current: boolean }) {
  return (
    <DraggableItem
      label={current ? `${design.title} (open now)` : `Open ${design.title}`}
      onInsert={() => openDesign(design.id)}
      disabled={current}
      className={cx("cf-proj__design", current && "is-current")}
      tooltip={false}
    >
      <div className="cf-proj__thumb" style={{ aspectRatio: `${Math.max(0.6, Math.min(1.8, design.width / design.height))}` }}>
        {design.thumbnail ? <img src={design.thumbnail} alt="" draggable={false} /> : <IconTemplate aria-hidden="true" />}
        {current ? (
          <span className="cf-proj__badge">
            <Badge tone="primary">Open now</Badge>
          </span>
        ) : null}
        {design.starred ? <IconStar className="cf-proj__star" aria-label="Starred" /> : null}
      </div>
      <div className="cf-proj__meta">
        <span className="cf-proj__title">{design.title}</span>
        <span className="cf-proj__sub">
          {typeLabel(design)}
          {design.pageCount > 1 ? ` - ${design.pageCount} pages` : ""}
        </span>
      </div>
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* folders                                                              */
/* ------------------------------------------------------------------ */

function FolderList({ folders, starredCount, onOpen, hideStarred }: { folders: Folder[]; starredCount: number; onOpen: (id: string) => void; hideStarred: boolean }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = async () => {
    const value = name.trim();
    setCreating(false);
    setName("");
    if (!value) return;
    try {
      const f = await createFolder(value);
      toast.success(`Folder "${f.name}" created`);
    } catch {
      toast.error("The folder could not be created.");
    }
  };

  return (
    <div className="cf-proj__folders">
      {creating ? (
        <div className="cf-proj__folder is-form">
          <span className="cf-proj__folder-icon is-create">
            <IconPlus aria-hidden="true" />
          </span>
          <TextField
            ref={inputRef}
            size="sm"
            aria-label="Folder name"
            placeholder="Folder name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") {
                e.stopPropagation();
                setName("");
                setCreating(false);
              }
            }}
          />
        </div>
      ) : (
        <button type="button" className="cf-proj__folder" onClick={() => setCreating(true)}>
          <span className="cf-proj__folder-icon is-create">
            <IconPlus aria-hidden="true" />
          </span>
          <span className="cf-proj__folder-name">Create folder</span>
        </button>
      )}
      {hideStarred ? null : (
        <button type="button" className="cf-proj__folder" onClick={() => onOpen(STARRED)}>
          <span className="cf-proj__folder-icon is-starred">
            <IconStar aria-hidden="true" />
          </span>
          <span className="cf-proj__folder-name">
            Starred
            <span className="cf-proj__folder-count">
              {starredCount} design{starredCount === 1 ? "" : "s"}
            </span>
          </span>
        </button>
      )}
      {folders.map((f) => (
        <button key={f.id} type="button" className="cf-proj__folder" onClick={() => onOpen(f.id)}>
          <span className="cf-proj__folder-icon">
            <IconFolder aria-hidden="true" />
          </span>
          <span className="cf-proj__folder-name">{f.name}</span>
        </button>
      ))}
    </div>
  );
}
