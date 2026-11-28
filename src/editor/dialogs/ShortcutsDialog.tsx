import { useMemo, useState } from "react";
import { m } from "@/i18n";
import { Kbd, Modal, SearchField, formatShortcut } from "@/ui";
import "./shortcutsDialog.css";

interface Shortcut {
  label: string;
  /** one entry per alternative; "Ctrl+Z" renders as key caps. A leading "+" in `then` shows plain text after the caps. */
  keys: string[];
  /** plain text shown after the key caps ("drag", "click" ...) */
  then?: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

const s = m.editorChrome.shortcuts;
const then = s.then;

/** Everything in src/editor/hotkeys.ts, the canvas controller, the page strip and the presenter. The key names stay as they are. */
const GROUPS: Group[] = [
  {
    title: s.general.title,
    items: [
      { label: s.general.undo, keys: ["Ctrl+Z"] },
      { label: s.general.redo, keys: ["Ctrl+Shift+Z", "Ctrl+Y"] },
      { label: s.general.saveNow, keys: ["Ctrl+S"] },
      { label: s.general.find, keys: ["Ctrl+F"] },
      { label: s.general.print, keys: ["Ctrl+P"] },
      { label: s.general.showShortcuts, keys: ["?"] },
      { label: s.general.escape, keys: ["Esc"] },
    ],
  },
  {
    title: s.edit.title,
    items: [
      { label: s.edit.copy, keys: ["Ctrl+C"] },
      { label: s.edit.cut, keys: ["Ctrl+X"] },
      { label: s.edit.paste, keys: ["Ctrl+V"] },
      { label: s.edit.duplicate, keys: ["Ctrl+D"] },
      { label: s.edit.deleteSelection, keys: ["Delete", "Backspace"] },
      { label: s.edit.selectAll, keys: ["Ctrl+A"] },
      { label: s.edit.selectNext, keys: ["Tab", "Shift+Tab"] },
      { label: s.edit.copyStyle, keys: ["Ctrl+Alt+C"] },
      { label: s.edit.pasteStyle, keys: ["Ctrl+Alt+V"] },
      { label: s.edit.link, keys: ["Ctrl+K"] },
      { label: s.edit.enter, keys: ["Enter"] },
      { label: s.edit.bold, keys: ["Ctrl+B"] },
      { label: s.edit.italic, keys: ["Ctrl+I"] },
      { label: s.edit.underline, keys: ["Ctrl+U"] },
      { label: s.edit.nudge, keys: ["Arrow Keys"] },
      { label: s.edit.nudgeMore, keys: ["Shift+Arrow Keys"] },
    ],
  },
  {
    title: s.arrange.title,
    items: [
      { label: s.arrange.group, keys: ["Ctrl+G"] },
      { label: s.arrange.ungroup, keys: ["Ctrl+Shift+G"] },
      { label: s.arrange.forward, keys: ["Ctrl+]"] },
      { label: s.arrange.backward, keys: ["Ctrl+["] },
      { label: s.arrange.front, keys: ["Ctrl+Alt+]", "Ctrl+Shift+]"] },
      { label: s.arrange.back, keys: ["Ctrl+Alt+[", "Ctrl+Shift+["] },
      { label: s.arrange.lock, keys: ["Alt+Shift+L"] },
    ],
  },
  {
    title: s.add.title,
    items: [
      { label: s.add.text, keys: ["T"] },
      { label: s.add.rectangle, keys: ["R"] },
      { label: s.add.circle, keys: ["C"] },
      { label: s.add.line, keys: ["L"] },
      { label: s.add.pen, keys: ["P"] },
      { label: s.add.comment, keys: ["M"] },
    ],
  },
  {
    title: s.pen.title,
    items: [
      { label: s.pen.corner, keys: [], then: then.click },
      { label: s.pen.smooth, keys: [], then: then.clickDrag },
      { label: s.pen.angle, keys: ["Shift"], then: then.click },
      { label: s.pen.close, keys: [], then: then.clickFirst },
      { label: s.pen.finish, keys: ["Enter", "Esc"], then: then.orClickLast },
      { label: s.pen.takeBack, keys: ["Backspace", "Ctrl+Z"] },
      { label: s.pen.moveKeyboardPoint, keys: ["Arrow Keys", "Shift+Arrow Keys"] },
      { label: s.pen.cornerAtKeyboard, keys: ["Enter"] },
      { label: s.pen.smoothAtKeyboard, keys: ["Shift+Enter"] },
      { label: s.pen.pullCurve, keys: ["Alt+Arrow Keys", "Alt+Shift+Arrow Keys"] },
      { label: s.pen.firstPoint, keys: ["Home"] },
      { label: s.pen.addPoint, keys: [], then: then.clickPath },
      { label: s.pen.switchPoint, keys: [], then: then.doubleClickIt },
      { label: s.pen.moveHandle, keys: ["Alt"], then: then.dragHandle },
      { label: s.pen.selectPoint, keys: ["Tab", "Shift+Tab"] },
      { label: s.pen.movePoints, keys: ["Arrow Keys", "Shift+Arrow Keys"] },
      { label: s.pen.deletePoints, keys: ["Delete", "Backspace"] },
      { label: s.pen.finishPoints, keys: ["Enter", "Esc"] },
    ],
  },
  {
    title: s.view.title,
    items: [
      { label: s.view.zoomIn, keys: ["Ctrl+="] },
      { label: s.view.zoomOut, keys: ["Ctrl+-"] },
      { label: s.view.fit, keys: ["Ctrl+0"] },
      { label: s.view.rulers, keys: ["Shift+R"] },
      { label: s.view.zoomPointer, keys: ["Ctrl"], then: then.scrollWheel },
      { label: s.view.pan, keys: ["Space"], then: then.drag },
      { label: s.view.pan, keys: ["Middle mouse button"], then: then.drag },
    ],
  },
  {
    title: s.mouse.title,
    items: [
      { label: s.mouse.axis, keys: ["Shift"], then: then.dragElement },
      { label: s.mouse.proportions, keys: ["Shift"], then: then.dragCorner },
      { label: s.mouse.fromCentre, keys: ["Alt"], then: then.dragHandle },
      { label: s.mouse.rotate, keys: ["Shift"], then: then.dragRotate },
      { label: s.mouse.noSnap, keys: ["Ctrl"], then: then.drag },
      { label: s.mouse.addRemove, keys: ["Shift", "Ctrl"], then: then.click },
      { label: s.mouse.marquee, keys: [], then: then.dragEmpty },
      { label: s.mouse.doubleClick, keys: [], then: then.doubleClick },
      { label: s.mouse.contextMenu, keys: [], then: then.rightClick },
    ],
  },
  {
    title: s.pages.title,
    items: [
      { label: s.pages.select, keys: ["Left", "Right"] },
      { label: s.pages.move, keys: ["Alt+Left", "Alt+Right"] },
      { label: s.pages.delete, keys: ["Delete"] },
      { label: s.pages.open, keys: ["Enter"] },
      { label: s.pages.leaveGrid, keys: ["Esc"] },
      { label: s.pages.reorder, keys: [], then: then.dragThumbnail },
    ],
  },
  {
    title: s.presenting.title,
    items: [
      { label: s.presenting.next, keys: ["Right", "Space", "Page Down"], then: then.orClick },
      { label: s.presenting.previous, keys: ["Left", "Page Up"] },
      { label: s.presenting.firstLast, keys: ["Home", "End"] },
      { label: s.presenting.autoplay, keys: ["P"] },
      { label: s.presenting.notes, keys: ["N"] },
      { label: s.presenting.pointer, keys: ["L"] },
      { label: s.presenting.fullscreen, keys: ["F"] },
      { label: s.presenting.exit, keys: ["Esc"] },
    ],
  },
];

/** Two balanced columns (CSS columns cannot scroll vertically inside a fixed height). */
function splitColumns(groups: Group[]): Group[][] {
  const columns: Group[][] = [[], []];
  const heights = [0, 0];
  for (const g of groups) {
    const at = heights[0] <= heights[1] ? 0 : 1;
    columns[at].push(g);
    heights[at] += g.items.length + 2;
  }
  return columns;
}

function Keys({ item }: { item: Shortcut }) {
  return (
    <span className="cf-shortcuts__keys">
      {item.keys.map((k, i) => (
        <span key={k} className="cf-shortcuts__alt">
          {i > 0 ? <span className="cf-shortcuts__or">{m.editorChrome.shortcuts.or}</span> : null}
          <Kbd keys={k} />
        </span>
      ))}
      {item.then ? <span className="cf-shortcuts__then">{item.then}</span> : null}
    </span>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const haystack = [g.title, item.label, item.then ?? "", ...item.keys.map((k) => `${k} ${formatShortcut(k)}`)].join(" ").toLowerCase();
        return q.split(/\s+/).every((word) => haystack.includes(word));
      }),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <Modal open={open} onClose={onClose} size="lg" title={m.editorChrome.shortcuts.title} bodyClassName="cf-shortcuts__body">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={m.editorChrome.shortcuts.search}
        aria-label={m.editorChrome.shortcuts.search}
        autoFocus
        className="cf-shortcuts__search"
      />
      {/* the list scrolls: focusable (and named), so that a keyboard can scroll it */}
      <div className="cf-shortcuts" role="region" aria-label={m.editorChrome.shortcuts.region} tabIndex={0}>
        {groups.length === 0 ? <p className="cf-shortcuts__empty">{m.editorChrome.shortcuts.noMatch(query)}</p> : null}
        {splitColumns(groups).map((column, c) => (
          <div key={c} className="cf-shortcuts__col">
            {column.map((g) => (
              <div key={g.title} className="cf-shortcuts__group" role="group" aria-label={g.title}>
                <h3 className="cf-shortcuts__title">{g.title}</h3>
                <ul className="cf-shortcuts__list">
                  {g.items.map((item, i) => (
                    <li key={`${item.label}-${i}`} className="cf-shortcuts__row">
                      <span className="cf-shortcuts__label">{item.label}</span>
                      <Keys item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
