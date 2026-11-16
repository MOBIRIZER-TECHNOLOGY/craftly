import { useMemo, useState } from "react";
import { createText } from "@/core/factory";
import { getActions } from "@/core/store";
import { m } from "@/i18n";
import { IconEmoji, IconSearch } from "@/ui";
import { ChipRow } from "../../shared/ChipRow";
import { DraggableItem } from "../../shared/DraggableItem";
import { EmptyHint } from "../../shared/EmptyHint";
import { useDebounced } from "../../shared/hooks";
import { PanelSection } from "../../shared/PanelLayout";
import { PanelSearch } from "../../shared/PanelSearch";
import { designMin } from "../../shared/panelActions";
import { ALL_EMOJI, EMOJI_CATEGORIES } from "./emojiData";
import { AppPage } from "./appKit";
import "./EmojiApp.css";

const RECENT_KEY = "craftly:recent-emoji";
const RECENT_MAX = 14;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberEmoji(char: string): string[] {
  const next = [char, ...readRecent().filter((c) => c !== char)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage is optional */
  }
  return next;
}

/** Text element holding one emoji, sized relative to the page. */
const emojiElement = (char: string) => createText({ text: char, fontSize: Math.round(designMin() * 0.16) });

/**
 * Emoji: search or browse by category and click one to put it on the page as large text. Recently used emoji stay
 * at the top. Emoji are real text, so they can be resized, rotated and given effects like any other text box.
 */
export function EmojiApp() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [recent, setRecent] = useState<string[]>(readRecent);
  const q = useDebounced(query, 100).trim().toLowerCase();

  const chips = useMemo(() => [{ id: "all", label: m.panelsTabs.shared.all }, ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: `${c.icon} ${c.label}` }))], []);
  const found = useMemo(() => (q ? ALL_EMOJI.filter((e) => q.split(/\s+/).every((w) => e.name.toLowerCase().includes(w))) : []), [q]);

  const insert = (char: string) => {
    getActions().addElement(emojiElement(char));
    setRecent(rememberEmoji(char));
  };

  const cell = (char: string, name: string) => (
    <DraggableItem
      key={`${char}-${name}`}
      label={name.split(" ").slice(0, 4).join(" ")}
      onInsert={() => insert(char)}
      getPayload={() => ({ type: "elements", elements: [emojiElement(char)] })}
      className="cf-emoji__cell"
      tooltip={false}
    >
      <span aria-hidden="true">{char}</span>
    </DraggableItem>
  );

  const shown = category === "all" ? EMOJI_CATEGORIES : EMOJI_CATEGORIES.filter((c) => c.id === category);
  const nameOf = (char: string) => ALL_EMOJI.find((e) => e.char === char)?.name ?? m.panelsTabs.emoji.fallbackName;

  return (
    <AppPage
      title={m.panelsTabs.emoji.title}
      subtitle={m.panelsTabs.emoji.subtitle}
      top={
        <>
          <PanelSearch value={query} onChange={setQuery} placeholder={m.panelsTabs.emoji.search} />
          {q ? null : <ChipRow chips={chips} value={category} onChange={setCategory} aria-label={m.panelsTabs.emoji.categoriesLabel} />}
        </>
      }
    >
      {q ? (
        found.length ? (
          <PanelSection title={m.panelsTabs.emoji.results(found.length)}>
            <div className="cf-emoji__grid">{found.map((e) => cell(e.char, e.name))}</div>
          </PanelSection>
        ) : (
          <EmptyHint icon={<IconSearch />} title={m.panelsTabs.emoji.noneTitle} text={m.panelsTabs.emoji.noneText(q)} />
        )
      ) : (
        <>
          {category === "all" && recent.length ? (
            <PanelSection title={m.panelsTabs.emoji.recent}>
              <div className="cf-emoji__grid">{recent.map((c) => cell(c, nameOf(c)))}</div>
            </PanelSection>
          ) : null}
          {shown.map((c) => (
            <PanelSection key={c.id} title={c.label}>
              <div className="cf-emoji__grid">{c.items.map((e) => cell(e.char, e.name))}</div>
            </PanelSection>
          ))}
          {!shown.length ? <EmptyHint icon={<IconEmoji />} title={m.panelsTabs.emoji.nothingHere} /> : null}
        </>
      )}
    </AppPage>
  );
}
