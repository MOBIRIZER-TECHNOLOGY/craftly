import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { getActions, useActivePage, useEditor } from "@/core/store";
import type { DesignElement, ID } from "@/core/types";
import { m } from "@/i18n";
import {
  cx,
  IconBringForward,
  IconBringToFront,
  IconButton,
  IconChevronRight,
  IconDuplicate,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconGroup,
  IconLayers,
  IconLock,
  IconMore,
  IconSendBackward,
  IconSendToBack,
  IconTextBox,
  IconTrash,
  IconUngroup,
  IconUnlock,
  MenuPopover,
  type MenuEntry,
} from "@/ui";
import { dropIndex, layerKind, layerName } from "./layerInfo";
import { LayerThumb } from "./LayerThumb";
import { PanelEmpty } from "./PanelShell";
import "./LayersTab.css";

interface Row {
  el: DesignElement;
  depth: number;
  /** id of the group whose child list holds this element, null for the page's own list */
  parentId: ID | null;
  /** top-level element that is, or contains, this one */
  topId: ID;
  /** paint index inside its own list */
  index: number;
}

/** Top-most first (the reverse of paint order); open groups list their children right below them. */
function flattenRows(list: DesignElement[], depth: number, parentId: ID | null, topId: ID | null, expanded: Set<ID>, out: Row[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const el = list[i];
    out.push({ el, depth, parentId, topId: topId ?? el.id, index: i });
    if (el.type === "group" && expanded.has(el.id)) flattenRows(el.children, depth + 1, el.id, topId ?? el.id, expanded, out);
  }
}

type DropEdge = "above" | "below";

export function LayersTab() {
  const page = useActivePage();
  const selection = useEditor((s) => s.selection);
  const selected = useMemo(() => new Set(selection), [selection]);
  const [expanded, setExpanded] = useState<Set<ID>>(() => new Set());
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [menu, setMenu] = useState<{ row: Row; anchor: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ id: ID; parentId: ID | null; index: number } | null>(null);
  const [drop, setDrop] = useState<{ id: ID; edge: DropEdge } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const actions = getActions();

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (page) flattenRows(page.elements, 0, null, null, expanded, out);
    return out;
  }, [page, expanded]);
  const hasGroups = page?.elements.some((e) => e.type === "group") ?? false;

  if (!page || page.elements.length === 0) {
    return <PanelEmpty icon={<IconLayers />} title={m.panelsContext.layers.emptyTitle} text={m.panelsContext.layers.emptyText} />;
  }

  /* ---- selection ---- */

  const select = (row: Row, e: MouseEvent | KeyboardEvent) => {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    // the canvas works on top-level elements: a layer inside a group selects its group
    if (additive) actions.toggleSelect(row.topId);
    else actions.select([row.topId]);
  };

  const ensureSelected = (row: Row) => {
    if (!useEditor.getState().selection.includes(row.topId)) actions.select([row.topId]);
  };

  /* ---- drag to reorder ---- */

  const resetDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const startDrag = (row: Row, e: DragEvent<HTMLElement>) => {
    const item = e.currentTarget.closest("li");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.el.id);
    if (item) e.dataTransfer.setDragImage(item, 24, 20);
    setDrag({ id: row.el.id, parentId: row.parentId, index: row.index });
  };

  const canDropOn = (row: Row) => !!drag && drag.id !== row.el.id && drag.parentId === row.parentId;

  const dragOver = (row: Row, e: DragEvent<HTMLElement>) => {
    if (!canDropOn(row)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const edge: DropEdge = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    if (drop?.id !== row.el.id || drop.edge !== edge) setDrop({ id: row.el.id, edge });
  };

  const dropOn = (row: Row, e: DragEvent<HTMLElement>) => {
    if (!drag || !canDropOn(row)) return;
    e.preventDefault();
    const edge = drop?.id === row.el.id ? drop.edge : "above";
    const to = dropIndex(drag.index, row.index, edge);
    const id = drag.id;
    const from = drag.index;
    resetDrag();
    if (to !== from) actions.moveToIndex(id, to);
  };

  /* ---- keyboard: arrows move between rows, F2 renames ---- */

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const mains = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-layer-main]") ?? []);
    const at = mains.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    mains[Math.min(mains.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  /* ---- item menu ---- */

  const isTopOfList = (row: Row) => {
    const list = row.parentId ? (findGroupChildren(page.elements, row.parentId) ?? []) : page.elements;
    return row.index === list.length - 1;
  };

  const menuItems = (row: Row): MenuEntry[] => {
    const el = row.el;
    const id = el.id;
    const top = row.depth === 0;
    const items: MenuEntry[] = [{ id: "rename", label: m.panelsContext.layers.rename, icon: <IconTextBox />, onSelect: () => setRenaming(id) }];
    if (top) {
      items.push({
        id: "duplicate",
        label: m.panelsContext.layers.duplicate,
        icon: <IconDuplicate />,
        shortcut: "Mod+D",
        onSelect: () => {
          ensureSelected(row);
          actions.duplicateSelection();
        },
      });
      const current = useEditor.getState().selection;
      if (current.length > 1 && current.includes(id)) {
        items.push({ id: "group", label: m.panelsContext.layers.group, icon: <IconGroup />, shortcut: "Mod+G", onSelect: () => actions.groupSelection() });
      }
      if (el.type === "group") {
        items.push({
          id: "ungroup",
          label: m.panelsContext.layers.ungroup,
          icon: <IconUngroup />,
          shortcut: "Mod+Shift+G",
          onSelect: () => {
            actions.select([id]);
            actions.ungroupSelection();
          },
        });
      }
    }
    items.push(
      { type: "divider" },
      { id: "front", label: m.panelsContext.layers.bringToFront, icon: <IconBringToFront />, disabled: isTopOfList(row), onSelect: () => actions.arrange("front", [id]) },
      { id: "forward", label: m.panelsContext.layers.bringForward, icon: <IconBringForward />, disabled: isTopOfList(row), onSelect: () => actions.arrange("forward", [id]) },
      { id: "backward", label: m.panelsContext.layers.sendBackward, icon: <IconSendBackward />, disabled: row.index === 0, onSelect: () => actions.arrange("backward", [id]) },
      { id: "back", label: m.panelsContext.layers.sendToBack, icon: <IconSendToBack />, disabled: row.index === 0, onSelect: () => actions.arrange("back", [id]) },
      { type: "divider" },
      {
        id: "hide",
        label: el.hidden ? m.panelsContext.layers.show : m.panelsContext.layers.hide,
        icon: el.hidden ? <IconEye /> : <IconEyeOff />,
        onSelect: () => actions.setHidden([id], !el.hidden),
      },
      {
        id: "lock",
        label: el.locked ? m.panelsContext.layers.unlock : m.panelsContext.layers.lock,
        icon: el.locked ? <IconUnlock /> : <IconLock />,
        onSelect: () => actions.setLocked([id], !el.locked),
      },
      { type: "divider" },
      { id: "delete", label: m.common.delete, icon: <IconTrash />, danger: true, shortcut: "Delete", disabled: !!el.locked, onSelect: () => actions.deleteElements([id]) },
    );
    return items;
  };

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- list-style: none takes the list semantics away in Safari; the role puts them back */}
      <ul ref={listRef} className="cf-layers" role="list" aria-label={m.panelsContext.layers.listLabel} onKeyDown={onListKeyDown}>
        {rows.map((row) => {
          const el = row.el;
          const isOpen = el.type === "group" && expanded.has(el.id);
          return (
            <LayerRow
              key={el.id}
              row={row}
              chevronSpace={hasGroups}
              selected={selected.has(el.id)}
              open={isOpen}
              renaming={renaming === el.id}
              dragging={drag?.id === el.id}
              dropEdge={drop?.id === el.id ? drop.edge : null}
              onSelect={select}
              onToggleOpen={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(el.id)) next.delete(el.id);
                  else next.add(el.id);
                  return next;
                })
              }
              onRename={() => setRenaming(el.id)}
              onRenameDone={(name) => {
                setRenaming(null);
                if (name !== null && name.trim() !== layerName(el)) actions.renameElement(el.id, name);
              }}
              onToggleHidden={() => actions.setHidden([el.id], !el.hidden)}
              onToggleLocked={() => actions.setLocked([el.id], !el.locked)}
              onMenu={(anchor) => setMenu({ row, anchor })}
              onDragStart={(e) => startDrag(row, e)}
              onDragEnd={resetDrag}
              onDragOver={(e) => dragOver(row, e)}
              onDragLeave={(e) => {
                // moving over the row's own children also fires dragleave: only a real exit clears the indicator
                if (drop?.id === el.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
              }}
              onDrop={(e) => dropOn(row, e)}
            />
          );
        })}
      </ul>
      <MenuPopover
        open={!!menu}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={menu ? menuItems(menu.row) : []}
        placement="bottom-end"
        aria-label={m.panelsContext.layers.actions}
      />
    </>
  );
}

function findGroupChildren(list: DesignElement[], groupId: ID): DesignElement[] | null {
  for (const el of list) {
    if (el.type !== "group") continue;
    if (el.id === groupId) return el.children;
    const inner = findGroupChildren(el.children, groupId);
    if (inner) return inner;
  }
  return null;
}

/* ------------------------------------------------------------------ */

interface LayerRowProps {
  row: Row;
  /** reserve the width of the group chevron so thumbnails line up */
  chevronSpace: boolean;
  selected: boolean;
  open: boolean;
  renaming: boolean;
  dragging: boolean;
  dropEdge: DropEdge | null;
  onSelect: (row: Row, e: MouseEvent | KeyboardEvent) => void;
  onToggleOpen: () => void;
  onRename: () => void;
  onRenameDone: (name: string | null) => void;
  onToggleHidden: () => void;
  onToggleLocked: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

function LayerRow(p: LayerRowProps) {
  const { row, selected } = p;
  const el = row.el;
  const name = layerName(el);
  const isGroup = el.type === "group";

  const onMainKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      p.onSelect(row, e);
    } else if (e.key === "F2") {
      e.preventDefault();
      p.onRename();
    } else if (e.key === "ArrowRight" && isGroup && !p.open) {
      e.preventDefault();
      p.onToggleOpen();
    } else if (e.key === "ArrowLeft" && isGroup && p.open) {
      e.preventDefault();
      p.onToggleOpen();
    }
  };

  return (
    <li
      className={cx(
        "cf-layer",
        selected && "is-selected",
        el.hidden && "is-hidden",
        el.locked && "is-locked",
        p.dragging && "is-dragging",
        p.dropEdge === "above" && "drop-above",
        p.dropEdge === "below" && "drop-below",
      )}
      style={{ paddingLeft: 2 + row.depth * 18 }}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
    >
      <span className="cf-layer__grip" draggable onDragStart={p.onDragStart} onDragEnd={p.onDragEnd} aria-hidden="true" title={m.panelsContext.layers.dragToReorder}>
        <IconGripVertical />
      </span>
      {isGroup ? (
        <button
          type="button"
          className={cx("cf-layer__chev", p.open && "is-open")}
          aria-label={p.open ? m.panelsContext.layers.collapse(name) : m.panelsContext.layers.expand(name)}
          aria-expanded={p.open}
          onClick={p.onToggleOpen}
        >
          <IconChevronRight aria-hidden="true" />
        </button>
      ) : p.chevronSpace ? (
        <span className="cf-layer__chev-space" aria-hidden="true" />
      ) : null}
      {p.renaming ? (
        <div className="cf-layer__main is-renaming">
          <LayerThumb el={el} />
          <RenameInput initial={name} onDone={p.onRenameDone} />
        </div>
      ) : (
        <div
          className="cf-layer__main"
          role="button"
          tabIndex={0}
          data-layer-main
          aria-pressed={selected}
          aria-label={m.panelsContext.layers.rowLabel(layerKind(el), name)}
          title={m.panelsContext.layers.rowTitle(name)}
          onClick={(e) => p.onSelect(row, e)}
          onDoubleClick={p.onRename}
          onKeyDown={onMainKey}
        >
          <LayerThumb el={el} />
          <span className="cf-layer__name">{name}</span>
        </div>
      )}
      <div className="cf-layer__tools">
        <IconButton
          size="sm"
          className={cx("cf-layer__tool", el.hidden && "is-on")}
          label={el.hidden ? m.panelsContext.layers.showLayer : m.panelsContext.layers.hideLayer}
          icon={el.hidden ? <IconEyeOff /> : <IconEye />}
          onClick={p.onToggleHidden}
        />
        <IconButton
          size="sm"
          className={cx("cf-layer__tool", el.locked && "is-on")}
          label={el.locked ? m.panelsContext.layers.unlockLayer : m.panelsContext.layers.lockLayer}
          icon={el.locked ? <IconLock /> : <IconUnlock />}
          onClick={p.onToggleLocked}
        />
        <IconButton size="sm" className="cf-layer__tool cf-layer__more" label={m.panelsContext.layers.actions} icon={<IconMore />} onClick={(e) => p.onMenu(e.currentTarget)} />
      </div>
    </li>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone(commit ? (ref.current?.value ?? initial) : null);
  };
  return (
    <input
      ref={ref}
      className="cf-layer__rename"
      defaultValue={initial}
      maxLength={80}
      aria-label={m.panelsContext.layers.nameLabel}
      spellCheck={false}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          // keep Esc for the field: a second press closes the panel
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
