import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { PageThumb } from "@/components/PageThumb";
import { pageHasAnimation } from "@/core/animation";
import { useEditor } from "@/core/store";
import type { Page } from "@/core/types";
import { Button, IconButton, IconChevronDown, IconDuplicate, IconMore, IconPlus, IconSparkle, MenuPopover, cx, type MenuEntry, type PopoverAnchor } from "@/ui";
import { PageCaption, deletePageWithUndo, pageMenuItems, usePageReorder, useThrottled, type ReorderItemProps } from "./pageParts";
import "./pageStrip.css";

/** Thumbnails are fitted into a 168 x 64 box so landscape, portrait and square designs all fit the strip. */
const BOX_W = 168;
const BOX_H = 64;

export function thumbWidth(designW: number, designH: number): number {
  const scale = Math.min(BOX_W / designW, BOX_H / designH);
  return Math.max(28, Math.round(designW * scale));
}

interface CellProps {
  page: Page;
  index: number;
  count: number;
  active: boolean;
  width: number;
  size: { width: number; height: number };
  renaming: boolean;
  menuOpen: boolean;
  readOnly: boolean;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  reorder: ReorderItemProps;
  onSelect: () => void;
  onMenu: (anchor: PopoverAnchor) => void;
  onRenameDone: () => void;
}

const Cell = memo(function Cell({
  page,
  index,
  count,
  active,
  width,
  size,
  renaming,
  menuOpen,
  readOnly,
  dragging,
  dropBefore,
  dropAfter,
  reorder,
  onSelect,
  onMenu,
  onRenameDone,
}: CellProps) {
  // while a gesture is running the page object changes every frame; the thumbnail only needs to follow a few times a second
  const shown = useThrottled(page, 400);
  const moves = pageHasAnimation(page) || !!page.transition;
  const label = `Page ${index + 1} of ${count}${page.name ? `, ${page.name}` : ""}${moves ? ", animated" : ""}`;
  return (
    <li
      className={cx("cf-strip__cell", active && "is-active", dragging && "is-dragging", dropBefore && "is-drop-before", dropAfter && "is-drop-after", menuOpen && "is-menu-open")}
      data-page-id={page.id}
      {...reorder}
    >
      <button
        type="button"
        className="cf-strip__thumb"
        aria-label={label}
        aria-current={active ? "true" : undefined}
        tabIndex={active ? 0 : -1}
        onClick={onSelect}
        onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          onSelect();
          onMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <PageThumb design={size} page={shown} width={width} className="cf-strip__canvas" />
        <span className="cf-strip__num" aria-hidden="true">
          {index + 1}
        </span>
        {moves ? (
          <span className="cf-strip__anim" aria-hidden="true" title="This page has animation">
            <IconSparkle />
          </span>
        ) : null}
      </button>
      <IconButton
        className="cf-strip__more"
        size="sm"
        label={`Page ${index + 1} options`}
        icon={<IconMore aria-hidden="true" />}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
      />
      <PageCaption page={page} index={index} editing={renaming && !readOnly} onDone={onRenameDone} />
    </li>
  );
});

/** Thumbnails of every page above the bottom bar: select, reorder by dragging, add, duplicate, rename, delete. */
export function PageStrip() {
  const pages = useEditor((s) => s.design?.pages);
  const dw = useEditor((s) => s.design?.width ?? 1);
  const dh = useEditor((s) => s.design?.height ?? 1);
  const activeId = useEditor((s) => s.activePageId);
  const readOnly = useEditor((s) => s.mode === "view");
  const actions = useEditor.getState().actions;

  const size = useMemo(() => ({ width: dw, height: dh }), [dw, dh]);
  const width = thumbWidth(dw, dh);
  const thumbHeight = Math.round((width * dh) / dw);
  const ids = useMemo(() => (pages ?? []).map((p) => p.id), [pages]);
  const count = ids.length;

  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor } | null>(null);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reorder = usePageReorder(ids, (id, to) => actions.movePage(id, to), !readOnly);

  // keep the selected thumbnail in view when the page changes from elsewhere (grid view, arrows, adding a page)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, count]);

  const focusPage = (id: string) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(id)}"] .cf-strip__thumb`)?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // events from the portalled page menu bubble through React; only keys inside the strip belong here
    if (!(e.target instanceof HTMLElement) || !e.currentTarget.contains(e.target) || e.target.tagName === "INPUT") return;
    const cell = e.target.closest<HTMLElement>("[data-page-id]");
    const id = cell?.dataset.pageId;
    if (!id) return;
    const index = ids.indexOf(id);
    const go = (to: number) => {
      const next = ids[Math.max(0, Math.min(count - 1, to))];
      if (next && next !== id) {
        actions.setActivePage(next);
        focusPage(next);
      }
    };
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        if (e.altKey && !readOnly) {
          const to = index + delta;
          if (to >= 0 && to < count) {
            actions.movePage(id, to);
            focusPage(id);
          }
        } else go(index + delta);
        break;
      }
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(count - 1);
        break;
      case "Delete":
      case "Backspace":
        // keep the editor's own Delete (selected elements) from firing as well
        e.preventDefault();
        e.stopPropagation();
        deletePageWithUndo(id);
        break;
      default:
        break;
    }
  };

  const menuPage = menu ? pages?.find((p) => p.id === menu.id) : undefined;
  const menuIndex = menu ? ids.indexOf(menu.id) : -1;
  const menuItems: MenuEntry[] = menuPage
    ? pageMenuItems({ pageId: menuPage.id, index: menuIndex, count, hasName: !!menuPage.name, readOnly, onRename: () => setRenaming(menuPage.id) })
    : [];

  const addItems: MenuEntry[] = [
    { id: "add", label: "Add page", icon: <IconPlus aria-hidden="true" />, disabled: readOnly, onSelect: () => actions.addPage() },
    { id: "duplicate", label: "Duplicate this page", icon: <IconDuplicate aria-hidden="true" />, disabled: readOnly, onSelect: () => actions.duplicatePage() },
  ];

  if (!pages) return null;

  return (
    <section className="cf-strip" aria-label="Pages">
      <div className="cf-strip__scroll" onKeyDown={onKeyDown}>
        <ul ref={listRef} className="cf-strip__track">
          {pages.map((page, index) => (
            <Cell
              key={page.id}
              page={page}
              index={index}
              count={count}
              active={page.id === activeId}
              width={width}
              size={size}
              renaming={renaming === page.id}
              menuOpen={menu?.id === page.id}
              readOnly={readOnly}
              dragging={reorder.dragId === page.id}
              dropBefore={reorder.slot === index && reorder.dragId !== null}
              dropAfter={reorder.slot === count && index === count - 1 && reorder.dragId !== null}
              reorder={reorder.item(page.id, index)}
              onSelect={() => actions.setActivePage(page.id)}
              onMenu={(anchor) => setMenu({ id: page.id, anchor })}
              onRenameDone={() => setRenaming(null)}
            />
          ))}
          <li className="cf-strip__cell cf-strip__cell--add" {...reorder.tail()}>
            <div className="cf-strip__add" style={{ height: thumbHeight, minWidth: Math.max(112, width) }}>
              <Button
                variant="ghost"
                className="cf-strip__add-main"
                icon={<IconPlus aria-hidden="true" />}
                aria-label="Add page"
                disabled={readOnly}
                onClick={() => actions.addPage()}
              />
              <Button
                variant="ghost"
                className="cf-strip__add-caret"
                icon={<IconChevronDown aria-hidden="true" />}
                aria-label="Add page options"
                aria-haspopup="menu"
                aria-expanded={addMenu !== null}
                disabled={readOnly}
                onClick={(e) => setAddMenu(addMenu ? null : e.currentTarget)}
              />
            </div>
            {/* same caption row as the page cells, so the tile lines up with the thumbnails */}
            <span className="cf-pagecap" aria-hidden="true" />
          </li>
        </ul>
      </div>

      <MenuPopover
        open={menu !== null && !!menuPage}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={menuItems}
        placement="top-start"
        aria-label={menuIndex >= 0 ? `Page ${menuIndex + 1} options` : "Page options"}
      />
      <MenuPopover open={addMenu !== null} anchor={addMenu} onClose={() => setAddMenu(null)} items={addItems} placement="top-end" aria-label="Add page options" />
    </section>
  );
}
