import { useMemo, useState } from "react";
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

/** Everything in src/editor/hotkeys.ts, the canvas controller, the page strip and the presenter. */
const GROUPS: Group[] = [
  {
    title: "General",
    items: [
      { label: "Undo", keys: ["Ctrl+Z"] },
      { label: "Redo", keys: ["Ctrl+Shift+Z", "Ctrl+Y"] },
      { label: "Save now", keys: ["Ctrl+S"] },
      { label: "Find and replace text", keys: ["Ctrl+F"] },
      { label: "Print the pages", keys: ["Ctrl+P"] },
      { label: "Show keyboard shortcuts", keys: ["?"] },
      { label: "Close a menu or dialog, stop editing text, deselect", keys: ["Esc"] },
    ],
  },
  {
    title: "Edit and select",
    items: [
      { label: "Copy", keys: ["Ctrl+C"] },
      { label: "Cut", keys: ["Ctrl+X"] },
      { label: "Paste (elements, images or plain text)", keys: ["Ctrl+V"] },
      { label: "Duplicate", keys: ["Ctrl+D"] },
      { label: "Delete the selection", keys: ["Delete", "Backspace"] },
      { label: "Select everything on the page", keys: ["Ctrl+A"] },
      { label: "Select the next or previous element", keys: ["Tab", "Shift+Tab"] },
      { label: "Copy style", keys: ["Ctrl+Alt+C"] },
      { label: "Paste style", keys: ["Ctrl+Alt+V"] },
      { label: "Edit the selected text, or crop the selected image", keys: ["Enter"] },
      { label: "Bold the selected text", keys: ["Ctrl+B"] },
      { label: "Italic the selected text", keys: ["Ctrl+I"] },
      { label: "Underline the selected text", keys: ["Ctrl+U"] },
      { label: "Nudge the selection by 1 px", keys: ["Arrow Keys"] },
      { label: "Nudge the selection by 10 px", keys: ["Shift+Arrow Keys"] },
    ],
  },
  {
    title: "Arrange",
    items: [
      { label: "Group", keys: ["Ctrl+G"] },
      { label: "Ungroup", keys: ["Ctrl+Shift+G"] },
      { label: "Bring forward", keys: ["Ctrl+]"] },
      { label: "Send backward", keys: ["Ctrl+["] },
      { label: "Bring to front", keys: ["Ctrl+Alt+]", "Ctrl+Shift+]"] },
      { label: "Send to back", keys: ["Ctrl+Alt+[", "Ctrl+Shift+["] },
      { label: "Lock or unlock", keys: ["Alt+Shift+L"] },
    ],
  },
  {
    title: "Add to the page",
    items: [
      { label: "Text box", keys: ["T"] },
      { label: "Rectangle", keys: ["R"] },
      { label: "Circle", keys: ["C"] },
      { label: "Line", keys: ["L"] },
    ],
  },
  {
    title: "View",
    items: [
      { label: "Zoom in", keys: ["Ctrl+="] },
      { label: "Zoom out", keys: ["Ctrl+-"] },
      { label: "Fit the page in the window", keys: ["Ctrl+0"] },
      { label: "Show or hide rulers", keys: ["Shift+R"] },
      { label: "Zoom around the pointer", keys: ["Ctrl"], then: "scroll wheel" },
      { label: "Pan the canvas", keys: ["Space"], then: "drag" },
      { label: "Pan the canvas", keys: ["Middle mouse button"], then: "drag" },
    ],
  },
  {
    title: "Mouse and canvas gestures",
    items: [
      { label: "Keep a move on one axis", keys: ["Shift"], then: "drag an element" },
      { label: "Toggle keeping proportions while resizing", keys: ["Shift"], then: "drag a corner handle" },
      { label: "Resize from the centre", keys: ["Alt"], then: "drag a handle" },
      { label: "Rotate in 15 degree steps", keys: ["Shift"], then: "drag the rotate handle" },
      { label: "Turn off snapping", keys: ["Ctrl"], then: "drag" },
      { label: "Add to or remove from the selection", keys: ["Shift", "Ctrl"], then: "click" },
      { label: "Select several elements", keys: [], then: "drag on an empty part of the page" },
      { label: "Edit text, crop an image or open a group", keys: [], then: "double-click" },
      { label: "Open the context menu", keys: [], then: "right-click" },
    ],
  },
  {
    title: "Pages",
    items: [
      { label: "Select the previous or next page (page strip)", keys: ["Left", "Right"] },
      { label: "Move the page (page strip)", keys: ["Alt+Left", "Alt+Right"] },
      { label: "Delete the page (page strip)", keys: ["Delete"] },
      { label: "Open the page (grid view)", keys: ["Enter"] },
      { label: "Leave grid view", keys: ["Esc"] },
      { label: "Reorder pages", keys: [], then: "drag a thumbnail" },
    ],
  },
  {
    title: "Presenting",
    items: [
      { label: "Next page", keys: ["Right", "Space", "Page Down"], then: "or click" },
      { label: "Previous page", keys: ["Left", "Page Up"] },
      { label: "First or last page", keys: ["Home", "End"] },
      { label: "Play the show on its own, on or off", keys: ["P"] },
      { label: "Show or hide speaker notes", keys: ["N"] },
      { label: "Full screen on or off", keys: ["F"] },
      { label: "Exit", keys: ["Esc"] },
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
          {i > 0 ? <span className="cf-shortcuts__or">or</span> : null}
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
    <Modal open={open} onClose={onClose} size="lg" title="Keyboard shortcuts" bodyClassName="cf-shortcuts__body">
      <SearchField value={query} onChange={setQuery} placeholder="Search shortcuts" aria-label="Search shortcuts" autoFocus className="cf-shortcuts__search" />
      {/* the list scrolls: focusable (and named), so that a keyboard can scroll it */}
      <div className="cf-shortcuts" role="region" aria-label="Shortcuts" tabIndex={0}>
        {groups.length === 0 ? <p className="cf-shortcuts__empty">No shortcuts match &quot;{query}&quot;.</p> : null}
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
