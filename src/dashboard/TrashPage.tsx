import { memo, useId } from "react";
import { Button, EmptyState, IconTrash, IconUndo, openContextMenu } from "@/ui";
import type { DesignSummary } from "@/core/types";
import { useActiveTeam } from "@/cloud/state";
import { deleteForeverAction, emptyTrashAction, restoreDesignAction } from "./actions";
import { useDesigns, useNow } from "./data";
import { DesignCardSkeleton } from "./DesignCard";
import { DesignMock, mockForDesign } from "./DesignMock";
import { m } from "@/i18n";
import { formatDeleted } from "./format";
import { shortTypeName } from "./labels";
import { trashMenuItems } from "./menus";
import { Page, PageHeader } from "./Page";
import "./TrashPage.css";

/** Trash: deleted designs with "Deleted 3 days ago", Restore, Delete forever and Empty trash. */
export function TrashPage() {
  const { trashed, ready } = useDesigns();
  const now = useNow();
  // a team's trash is synced to the team's server like the rest of its designs
  const team = useActiveTeam();

  return (
    <Page className="cf-trash">
      <PageHeader
        title={m.dashboard.shell.nav.trash}
        subtitle={team ? m.dashboard.trash.teamSubtitle : m.dashboard.trash.subtitle}
        actions={
          trashed.length > 0 ? (
            <Button variant="secondary" className="cf-trash__empty-btn" icon={<IconTrash aria-hidden="true" />} onClick={() => void emptyTrashAction(trashed.length)}>
              {m.dashboard.actions.emptyTrash}
            </Button>
          ) : null
        }
      />

      {!ready ? (
        <div className="cf-trash__grid" aria-busy="true" aria-label={m.dashboard.trash.loading}>
          {Array.from({ length: 4 }, (_unused, index) => (
            <DesignCardSkeleton key={index} />
          ))}
        </div>
      ) : trashed.length === 0 ? (
        <EmptyState headingLevel={2} icon={<IconTrash />} title={m.dashboard.trash.emptyTitle} text={m.dashboard.trash.emptyText} />
      ) : (
        <>
          <p className="cf-trash__count" aria-live="polite">
            {m.dashboard.trash.count(trashed.length)}
          </p>
          <div className="cf-trash__grid">
            {trashed.map((design) => (
              <TrashCard key={design.id} design={design} now={now} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

const TrashCard = memo(function TrashCard({ design, now }: { design: DesignSummary; now: number }) {
  const titleId = useId();
  return (
    <article
      className="cf-trash__card"
      aria-labelledby={titleId}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({ x: event.clientX, y: event.clientY, items: trashMenuItems(design) });
      }}
    >
      <div className="cf-trash__stage">
        {design.thumbnail ? (
          <img src={design.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <DesignMock spec={mockForDesign(design)} height={150} className="cf-trash__mock" />
        )}
      </div>
      <div className="cf-trash__body">
        <p id={titleId} className="cf-trash__title" title={design.title}>
          {design.title}
        </p>
        <p className="cf-trash__sub">
          {shortTypeName(design.typeId)} · {formatDeleted(design.trashedAt ?? now, now)}
        </p>
      </div>
      <div className="cf-trash__actions">
        <Button size="sm" variant="soft" icon={<IconUndo aria-hidden="true" />} onClick={() => void restoreDesignAction(design)}>
          {m.dashboard.shared.restore}
        </Button>
        <Button size="sm" variant="ghost" className="cf-trash__delete" onClick={() => void deleteForeverAction(design)}>
          {m.dashboard.shared.deleteForever}
        </Button>
      </div>
    </article>
  );
});
