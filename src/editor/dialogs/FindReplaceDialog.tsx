import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { locate } from "@/core/ops";
import { getActivePage, useEditor } from "@/core/store";
import { designToScreen, useView } from "@/editor/canvas/viewStore";
import { Button, Checkbox, IconButton, IconChevronDown, IconChevronUp, IconClose, Popover, SearchField, TextField, toast, useLatest } from "@/ui";
import { findMatches, isAfter, replaceInParagraphs, type TextMatch } from "./findReplace";
import "./findReplaceDialog.css";

/** Selects the match on its page and, when it would be off screen at the current zoom, fits the page. */
function reveal(match: TextMatch): void {
  const actions = useEditor.getState().actions;
  actions.setActivePage(match.pageId);
  actions.select([match.topId]);
  const s = useEditor.getState();
  const page = getActivePage(s);
  const el = page ? locate(page.elements, match.topId)?.el : null;
  if (!el) return;
  const c = designToScreen(useView.getState(), el.x + el.width / 2, el.y + el.height / 2);
  if (c.x < 0 || c.y < 0 || c.x > s.viewport.w || c.y > s.viewport.h) actions.setZoomMode("fit");
}

/** The anchor of the floating panel: just under the top bar, against the right edge. */
const panelAnchor = () => ({ x: window.innerWidth - 16, y: 64 });

/**
 * Find and replace across every text box on every page. It floats beside the canvas (no backdrop) so the
 * match that is selected on the page stays visible while you step through the results.
 */
export function FindReplaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const design = useEditor((s) => s.design);
  const readOnly = useEditor((s) => s.mode === "view");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState(panelAnchor);
  const findRef = useRef<HTMLInputElement>(null);

  // the popover focuses its own panel first; the search field takes over right after
  useEffect(() => {
    if (!open) return;
    findRef.current?.focus();
    findRef.current?.select();
  }, [open]);

  useEffect(() => {
    const onResize = () => setAnchor(panelAnchor());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const matches = useMemo(() => (design ? findMatches(design, query, caseSensitive) : []), [design, query, caseSensitive]);
  const matchesRef = useLatest(matches);
  const index = matches.length ? Math.min(cursor, matches.length - 1) : -1;

  // a new search starts at the first match on (or after) the page being edited
  useEffect(() => {
    if (!query) return;
    const list = matchesRef.current;
    if (!list.length) return;
    const s = useEditor.getState();
    const activeIndex = Math.max(0, s.design?.pages.findIndex((p) => p.id === s.activePageId) ?? 0);
    const first = list.findIndex((m) => m.pageIndex >= activeIndex);
    const at = first < 0 ? 0 : first;
    setCursor(at);
    reveal(list[at]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive]);

  const jump = (to: number) => {
    const list = matchesRef.current;
    if (!list.length) return;
    const at = ((to % list.length) + list.length) % list.length;
    setCursor(at);
    reveal(list[at]);
  };

  /** Rewrites the given matches; returns how many were replaced (locked text boxes are left alone). */
  const apply = (list: TextMatch[]): number => {
    const actions = useEditor.getState().actions;
    const groups = new Map<string, { pageId: string; elementId: string; ranges: TextMatch[] }>();
    let skipped = 0;
    for (const m of list) {
      if (m.locked) {
        skipped++;
        continue;
      }
      const key = `${m.pageId}\u0000${m.elementId}`;
      const g = groups.get(key) ?? { pageId: m.pageId, elementId: m.elementId, ranges: [] };
      g.ranges.push(m);
      groups.set(key, g);
    }
    if (skipped) toast.info(skipped === 1 ? "One match is in a locked element and was left alone." : `${skipped} matches are in locked elements and were left alone.`);
    if (!groups.size) return 0;
    const home = useEditor.getState().activePageId;
    const batch = groups.size > 1;
    if (batch) actions.beginTransaction();
    let done = 0;
    try {
      for (const g of groups.values()) {
        const s = useEditor.getState();
        const page = s.design?.pages.find((p) => p.id === g.pageId);
        const el = page ? locate(page.elements, g.elementId)?.el : null;
        if (!el || el.type !== "text") continue;
        if (s.activePageId !== g.pageId) actions.setActivePage(g.pageId);
        actions.setTextParagraphs(g.elementId, replaceInParagraphs(el.paragraphs, g.ranges, replacement));
        done += g.ranges.length;
      }
    } finally {
      if (batch) actions.endTransaction();
    }
    if (batch && useEditor.getState().activePageId !== home) useEditor.getState().actions.setActivePage(home);
    return done;
  };

  const replaceOne = () => {
    if (readOnly || index < 0) return;
    const m = matches[index];
    if (apply([m]) === 0) return;
    // the list shrinks by one; continue with the first match after the replaced text
    const s = useEditor.getState();
    const next = s.design ? findMatches(s.design, query, caseSensitive) : [];
    const at = next.findIndex((x) => isAfter(x, m, replacement.length));
    if (next.length) {
      const to = at < 0 ? 0 : at;
      setCursor(to);
      reveal(next[to]);
    }
  };

  const replaceAll = () => {
    if (readOnly || !matches.length) return;
    const n = apply(matches);
    setCursor(0);
    if (n > 0) toast.success(`Replaced ${n} ${n === 1 ? "match" : "matches"}`);
  };

  const onFindKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && e.target === findRef.current) {
      e.preventDefault();
      jump(e.shiftKey ? index - 1 : index + 1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      // keep the browser's own find box closed; Ctrl+F while the panel is open re-selects the search text
      e.preventDefault();
      findRef.current?.select();
    }
  };

  const counter = !query ? "" : matches.length ? `${index + 1} of ${matches.length}` : "No results";

  return (
    <Popover
      open={open}
      anchor={anchor}
      onClose={onClose}
      placement="bottom-end"
      offset={0}
      trapFocus={false}
      closeOnOutsidePress={false}
      className="cf-find-pop"
      aria-label="Find and replace"
    >
      <div className="cf-find">
        {/* a div, not a header: inside a floating dialog a header would count as a second banner landmark of the page */}
        <div className="cf-find__head">
          <h2 className="cf-find__title">Find and replace</h2>
          <IconButton size="sm" label="Close" shortcut="Esc" icon={<IconClose aria-hidden="true" />} onClick={onClose} />
        </div>
        <div className="cf-find__row" onKeyDown={onFindKey}>
          <SearchField
            ref={findRef}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setCursor(0);
            }}
            placeholder="Find"
            aria-label="Find text"
            trailing={counter ? <span className="cf-find__count">{counter}</span> : undefined}
          />
          <IconButton
            size="sm"
            label="Previous match"
            shortcut="Shift+Enter"
            icon={<IconChevronUp aria-hidden="true" />}
            disabled={!matches.length}
            onClick={() => jump(index - 1)}
          />
          <IconButton size="sm" label="Next match" shortcut="Enter" icon={<IconChevronDown aria-hidden="true" />} disabled={!matches.length} onClick={() => jump(index + 1)} />
        </div>
        <TextField
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replace with"
          aria-label="Replacement text"
          disabled={readOnly}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              replaceOne();
            }
          }}
        />
        <Checkbox checked={caseSensitive} onChange={setCaseSensitive} label="Match case" />
        <div className="cf-find__actions">
          <Button variant="secondary" size="sm" disabled={readOnly || index < 0} onClick={replaceOne}>
            Replace
          </Button>
          <Button variant="primary" size="sm" disabled={readOnly || !matches.length} onClick={replaceAll}>
            {matches.length > 1 ? `Replace all (${matches.length})` : "Replace all"}
          </Button>
        </div>
        {readOnly ? <p className="cf-find__note">Switch to Editing to replace text.</p> : null}
      </div>
    </Popover>
  );
}
