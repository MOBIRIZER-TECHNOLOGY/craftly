import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Button, IconArrowRight, IconCustomSize, IconSearch, SearchField, cx, useOutsideClick } from "@/ui";
import type { DesignSummary, Template } from "@/core/types";
import { TemplateThumb } from "@/components/PageThumb";
import { DESIGN_CATEGORY_LABELS, DESIGN_TYPES, describeSize, type DesignType } from "@/data/designTypes";
import { TEMPLATE_CATEGORY_LABELS, searchTemplates } from "@/data/templates";
import { createBlankAndOpen, createCustomAndOpen, openDesign } from "./actions";
import { openCreateDialog } from "./createDialogState";
import { useDesigns, useNow } from "./data";
import { DesignMock, mockForDesign } from "./DesignMock";
import { formatEdited, matchesWords, parseSizeQuery, searchWords } from "./format";
import { typeIcon } from "./designIcons";
import { shortTypeName } from "./labels";
import { navigate } from "@/router";
import { openTemplatePreview, presetTemplateSearch } from "./templatePreview";
import "./HomeSearch.css";

type Item =
  | { kind: "design"; design: DesignSummary }
  | { kind: "template"; template: Template }
  | { kind: "all-templates"; count: number }
  | { kind: "type"; type: DesignType }
  | { kind: "custom"; width: number; height: number };

const MAX_DESIGNS = 4;
const MAX_TEMPLATES = 5;
const MAX_TYPES = 5;

interface Groups {
  designs: Item[];
  templates: Item[];
  types: Item[];
}

function compute(query: string, designs: DesignSummary[]): Groups {
  const words = searchWords(query);
  if (words.length === 0) return { designs: [], templates: [], types: [] };

  const matchedDesigns = designs
    .filter((design) => matchesWords(`${design.title} ${shortTypeName(design.typeId)}`, words))
    .slice(0, MAX_DESIGNS)
    .map((design): Item => ({ kind: "design", design }));

  const allTemplates = searchTemplates(query);
  const templates: Item[] = allTemplates.slice(0, MAX_TEMPLATES).map((template): Item => ({ kind: "template", template }));
  if (allTemplates.length > MAX_TEMPLATES) templates.push({ kind: "all-templates", count: allTemplates.length });

  const types: Item[] = [];
  const size = parseSizeQuery(query);
  if (size) types.push({ kind: "custom", width: size.width, height: size.height });
  for (const type of DESIGN_TYPES) {
    if (types.length >= MAX_TYPES) break;
    if (matchesWords(`${type.name} ${type.id.replace(/-/g, " ")} ${DESIGN_CATEGORY_LABELS[type.category]}`, words)) types.push({ kind: "type", type });
  }
  return { designs: matchedDesigns, templates, types };
}

/** The big search field of the Home / Templates heroes with a results panel (designs, templates, design types). */
export function HomeSearch({ placeholder = "Search designs and templates" }: { placeholder?: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const { active: designs } = useDesigns();
  const now = useNow();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = useMemo(() => compute(query, designs), [query, designs]);
  const items = useMemo(() => [...groups.designs, ...groups.templates, ...groups.types], [groups]);
  const hasQuery = query.trim().length > 0;
  const showPanel = open && hasQuery;

  useEffect(() => setCursor(0), [query]);
  useOutsideClick([rootRef], () => setOpen(false), open);

  // the field is a combobox: tell assistive tech which result is highlighted
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", String(showPanel));
    input.setAttribute("aria-controls", listId);
    if (showPanel && items[cursor]) input.setAttribute("aria-activedescendant", `${listId}-${cursor}`);
    else input.removeAttribute("aria-activedescendant");
  }, [showPanel, items, cursor, listId]);

  const activate = (item: Item) => {
    setOpen(false);
    setQuery("");
    switch (item.kind) {
      case "design":
        openDesign(item.design);
        break;
      case "template":
        openTemplatePreview(item.template);
        break;
      case "all-templates":
        presetTemplateSearch(query);
        navigate("/templates");
        break;
      case "type":
        void createBlankAndOpen(item.type);
        break;
      case "custom": {
        const width = Math.min(8000, Math.max(40, item.width));
        const height = Math.min(8000, Math.max(40, item.height));
        void createCustomAndOpen(width, height, "px");
        break;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasQuery || items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor((value) => (value + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setCursor((value) => (value - 1 + items.length) % items.length);
    }
  };

  // Enter does what the highlighted result says (the first one until the arrow keys move the highlight)
  const submit = () => {
    const target = items[cursor] ?? items[0];
    if (hasQuery && target) activate(target);
  };

  let index = -1;
  const option = (item: Item, content: ReactNode) => {
    index += 1;
    const i = index;
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the options are chosen with the arrow keys from the search field (aria-activedescendant)
      <div
        key={`${item.kind}-${i}`}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === cursor}
        className={cx("cf-hsearch__item", i === cursor && "is-active")}
        onMouseMove={() => i !== cursor && setCursor(i)}
        onClick={() => activate(item)}
      >
        {content}
      </div>
    );
  };

  return (
    <div
      className="cf-hsearch"
      ref={rootRef}
      onKeyDown={onKeyDown}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <SearchField
        ref={inputRef}
        size="lg"
        value={query}
        onChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        onSubmit={submit}
        placeholder={placeholder}
        aria-label={placeholder}
      />

      {showPanel ? (
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the focus stays in the search field; the options are chosen with aria-activedescendant
        <div className="cf-hsearch__panel" id={listId} role="listbox" aria-label="Search results" onMouseDown={(event) => event.preventDefault()}>
          {items.length === 0 ? (
            <div className="cf-hsearch__empty">
              <IconSearch aria-hidden="true" />
              <p className="cf-hsearch__empty-title">Nothing found for “{query.trim()}”</p>
              <p className="cf-hsearch__empty-text">Try a shorter word, or start from any design type.</p>
              <Button
                size="sm"
                variant="soft"
                onClick={() => {
                  setOpen(false);
                  openCreateDialog({ query: query.trim() });
                }}
              >
                Browse design types
              </Button>
            </div>
          ) : (
            <>
              {groups.designs.length > 0 ? (
                <div className="cf-hsearch__group" role="group" aria-label="Your designs">
                  <p className="cf-hsearch__heading" aria-hidden="true">
                    Your designs
                  </p>
                  {groups.designs.map((item) =>
                    item.kind === "design"
                      ? option(
                          item,
                          <>
                            <span className="cf-hsearch__thumb">
                              {item.design.thumbnail ? <img src={item.design.thumbnail} alt="" draggable={false} /> : <DesignMock spec={mockForDesign(item.design)} height={36} />}
                            </span>
                            <span className="cf-hsearch__text">
                              <span className="cf-hsearch__name">{item.design.title}</span>
                              <span className="cf-hsearch__meta">
                                {shortTypeName(item.design.typeId)} · {formatEdited(item.design.updatedAt, now)}
                              </span>
                            </span>
                          </>,
                        )
                      : null,
                  )}
                </div>
              ) : null}

              {groups.templates.length > 0 ? (
                <div className="cf-hsearch__group" role="group" aria-label="Templates">
                  <p className="cf-hsearch__heading" aria-hidden="true">
                    Templates
                  </p>
                  {groups.templates.map((item) => {
                    if (item.kind === "template") {
                      const aspect = item.template.width / Math.max(1, item.template.height);
                      const width = Math.max(20, Math.min(52, Math.round(38 * aspect)));
                      return option(
                        item,
                        <>
                          <span className="cf-hsearch__thumb">
                            <TemplateThumb template={item.template} width={width} />
                          </span>
                          <span className="cf-hsearch__text">
                            <span className="cf-hsearch__name">{item.template.name}</span>
                            <span className="cf-hsearch__meta">{TEMPLATE_CATEGORY_LABELS[item.template.category] ?? item.template.category}</span>
                          </span>
                        </>,
                      );
                    }
                    if (item.kind === "all-templates") {
                      return option(
                        item,
                        <>
                          <span className="cf-hsearch__thumb cf-hsearch__thumb--icon" aria-hidden="true">
                            <IconArrowRight />
                          </span>
                          <span className="cf-hsearch__text">
                            <span className="cf-hsearch__name">See all {item.count} templates</span>
                            <span className="cf-hsearch__meta">Open the Templates page</span>
                          </span>
                        </>,
                      );
                    }
                    return null;
                  })}
                </div>
              ) : null}

              {groups.types.length > 0 ? (
                <div className="cf-hsearch__group" role="group" aria-label="Design types">
                  <p className="cf-hsearch__heading" aria-hidden="true">
                    Design types
                  </p>
                  {groups.types.map((item) => {
                    if (item.kind === "type") {
                      const Icon = typeIcon(item.type);
                      return option(
                        item,
                        <>
                          <span className="cf-hsearch__thumb cf-hsearch__thumb--type" style={{ "--cf-tile": item.type.color } as CSSProperties} aria-hidden="true">
                            <Icon />
                          </span>
                          <span className="cf-hsearch__text">
                            <span className="cf-hsearch__name">{item.type.name}</span>
                            <span className="cf-hsearch__meta">Create blank · {describeSize(item.type.width, item.type.height, item.type.unit)}</span>
                          </span>
                        </>,
                      );
                    }
                    if (item.kind === "custom") {
                      return option(
                        item,
                        <>
                          <span className="cf-hsearch__thumb cf-hsearch__thumb--icon" aria-hidden="true">
                            <IconCustomSize />
                          </span>
                          <span className="cf-hsearch__text">
                            <span className="cf-hsearch__name">Custom size</span>
                            <span className="cf-hsearch__meta">
                              Create blank · {item.width} × {item.height} px
                            </span>
                          </span>
                        </>,
                      );
                    }
                    return null;
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
