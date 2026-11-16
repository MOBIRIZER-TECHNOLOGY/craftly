import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { PageThumb } from "@/components/PageThumb";
import { useEditor } from "@/core/store";
import type { Page } from "@/core/types";
import { m } from "@/i18n";
import {
  Button,
  IconButton,
  IconChevronDown,
  IconDuplicate,
  IconFilePlus,
  IconMore,
  IconPlus,
  IconTrash,
  MenuPopover,
  cx,
  useResizeObserver,
  type MenuEntry,
  type PopoverAnchor,
} from "@/ui";
import { PageCaption, deletePageWithUndo, pageMenuItems, usePageReorder, useThrottled, type ReorderItemProps } from "./pageParts";
import "./gridView.css";

const PAD = 32;
const GAP = 24;
const TARGET = 208;
const MAX_THUMB_H = 320;

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
  onOpen: () => void;
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
  onOpen,
  onMenu,
  onRenameDone,
}: CellProps) {
  const shown = useThrottled(page, 400);
  return (
    <li
      className={cx("cf-gridcell", active && "is-active", dragging && "is-dragging", dropBefore && "is-drop-before", dropAfter && "is-drop-after", menuOpen && "is-menu-open")}
      data-page-id={page.id}
      style={{ width }}
      {...reorder}
    >
      <button
        type="button"
        className="cf-gridcell__thumb"
        aria-label={m.editorChrome.pages.gridCell(index + 1, count, page.name ?? "")}
        aria-current={active ? "true" : undefined}
        tabIndex={active ? 0 : -1}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          onSelect();
          onMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <PageThumb design={size} page={shown} width={width} className="cf-gridcell__canvas" />
      </button>
      <IconButton
        className="cf-gridcell__more"
        size="sm"
        label={m.editorChrome.pages.options(index + 1)}
        icon={<IconMore aria-hidden="true" />}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
      />
      <PageCaption page={page} index={index} editing={renaming && !readOnly} onDone={onRenameDone} showNumber />
    </li>
  );
});

/** Every page as a large thumbnail on the workspace background. Click selects, double-click opens, drag reorders. */
export function GridView() {
  const pages = useEditor((s) => s.design?.pages);
  const dw = useEditor((s) => s.design?.width ?? 1);
  const dh = useEditor((s) => s.design?.height ?? 1);
  const activeId = useEditor((s) => s.activePageId);
  const readOnly = useEditor((s) => s.mode === "view");
  const actions = useEditor.getState().actions;

  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [boxW, setBoxW] = useState(1000);
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor } | null>(null);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const [moreBtn, setMoreBtn] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  useResizeObserver(hostRef, (entry) => setBoxW(Math.round(entry.contentRect.width)));

  const size = useMemo(() => ({ width: dw, height: dh }), [dw, dh]);
  const ids = useMemo(() => (pages ?? []).map((p) => p.id), [pages]);
  const count = ids.length;
  const reorder = usePageReorder(ids, (id, to) => actions.movePage(id, to), !readOnly);

  const avail = Math.max(120, boxW - PAD * 2);
  const cols = Math.max(1, Math.floor((avail + GAP) / (TARGET + GAP)));
  const fitted = Math.floor((avail - GAP * (cols - 1)) / cols);
  const width = Math.max(96, Math.min(fitted, Math.round((MAX_THUMB_H * dw) / dh)));
  const height = Math.round((width * dh) / dw);

  const exit = () => {
    if (useEditor.getState().gridView) actions.toggle("gridView");
  };
  const open = (id: string) => {
    actions.setActivePage(id);
    exit();
  };

  // Esc leaves the grid (popovers and the rename field consume their own Esc first)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || useEditor.getState().dialog) return;
      e.preventDefault();
      exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, count]);

  const focusPage = (id: string) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(id)}"] .cf-gridcell__thumb`)?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
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
        e.preventDefault();
        go(index - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        go(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(index - cols);
        break;
      case "ArrowDown":
        e.preventDefault();
        go(index + cols);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(count - 1);
        break;
      case "Enter":
        e.preventDefault();
        open(id);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        e.stopPropagation();
        deletePageWithUndo(id);
        break;
      default:
        break;
    }
  };

  const menuPage = menu ? pages?.find((p) => p.id === menu.id) : undefined;
  const menuIndex = menuPage ? ids.indexOf(menuPage.id) : -1;
  const menuItems: MenuEntry[] = menuPage
    ? pageMenuItems({ pageId: menuPage.id, index: menuIndex, count, hasName: !!menuPage.name, readOnly, onRename: () => setRenaming(menuPage.id) })
    : [];
  const addItems: MenuEntry[] = [
    { id: "add", label: m.editorChrome.pages.addPage, icon: <IconPlus aria-hidden="true" />, disabled: readOnly, onSelect: () => actions.addPage() },
    { id: "duplicate", label: m.editorChrome.pages.duplicateThis, icon: <IconDuplicate aria-hidden="true" />, disabled: readOnly, onSelect: () => actions.duplicatePage() },
  ];

  if (!pages) return null;

  return (
    <div ref={hostRef} className="cf-grid" onKeyDown={onKeyDown}>
      <div className="cf-grid__barwrap">
        <div className="cf-grid__bar" role="toolbar" aria-label={m.editorChrome.pages.pageActions}>
          <IconButton label={m.editorChrome.pages.addPage} icon={<IconFilePlus aria-hidden="true" />} disabled={readOnly} onClick={() => actions.addPage()} />
          <IconButton label={m.editorChrome.pages.duplicatePage} icon={<IconDuplicate aria-hidden="true" />} disabled={readOnly} onClick={() => actions.duplicatePage()} />
          <IconButton
            label={m.editorChrome.pages.deletePage}
            icon={<IconTrash aria-hidden="true" />}
            disabled={readOnly || count <= 1}
            onClick={() => deletePageWithUndo(activeId)}
          />
          <IconButton
            ref={setMoreBtn}
            label={m.editorChrome.pages.morePageOptions}
            icon={<IconMore aria-hidden="true" />}
            aria-haspopup="menu"
            aria-expanded={menu !== null && menu.anchor === moreBtn}
            onClick={(e) => setMenu(menu ? null : { id: activeId, anchor: e.currentTarget })}
          />
        </div>
      </div>
      <ul
        ref={listRef}
        className="cf-grid__list"
        aria-label={m.editorChrome.pages.allPages}
        style={{ gridTemplateColumns: `repeat(${cols}, ${width}px)`, padding: `8px ${PAD}px ${PAD * 2}px`, gap: `${GAP}px` }}
      >
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
            onOpen={() => open(page.id)}
            onMenu={(anchor) => setMenu({ id: page.id, anchor })}
            onRenameDone={() => setRenaming(null)}
          />
        ))}
        <li className="cf-gridcell cf-gridcell--add" style={{ width }} {...reorder.tail()}>
          <div className="cf-gridcell__add" style={{ height }}>
            <Button
              variant="ghost"
              className="cf-gridcell__add-main"
              icon={<IconPlus aria-hidden="true" />}
              aria-label={m.editorChrome.pages.addPage}
              disabled={readOnly}
              onClick={() => actions.addPage()}
            />
            <Button
              variant="ghost"
              className="cf-gridcell__add-caret"
              icon={<IconChevronDown aria-hidden="true" />}
              aria-label={m.editorChrome.pages.addPageOptions}
              aria-haspopup="menu"
              aria-expanded={addMenu !== null}
              disabled={readOnly}
              onClick={(e) => setAddMenu(addMenu ? null : e.currentTarget)}
            />
          </div>
        </li>
      </ul>

      <MenuPopover
        open={menu !== null && !!menuPage}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={menuItems}
        placement="bottom-start"
        aria-label={menuIndex >= 0 ? m.editorChrome.pages.options(menuIndex + 1) : m.editorChrome.pages.pageOptions}
      />
      <MenuPopover
        open={addMenu !== null}
        anchor={addMenu}
        onClose={() => setAddMenu(null)}
        items={addItems}
        placement="bottom-end"
        aria-label={m.editorChrome.pages.addPageOptions}
      />
    </div>
  );
}
