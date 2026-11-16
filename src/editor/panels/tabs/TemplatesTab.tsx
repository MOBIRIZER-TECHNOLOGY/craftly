import { useMemo, useRef, useState } from "react";
import { PageThumb, TemplateThumb } from "@/components/PageThumb";
import { useEditor } from "@/core/store";
import type { Template, TemplateCategory } from "@/core/types";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, searchTemplates } from "@/data/templates";
import { describeSize, getDesignType } from "@/data/designTypes";
import { m } from "@/i18n";
import { Button, IconButton, IconFilterList, IconPages, IconPlus, IconTemplate, MenuPopover, Skeleton } from "@/ui";
import { ChipRow } from "../shared/ChipRow";
import { DraggableItem } from "../shared/DraggableItem";
import { EmptyHint } from "../shared/EmptyHint";
import { useDebounced, useElementWidth } from "../shared/hooks";
import { Masonry } from "../shared/ItemGrid";
import { Panel, PanelScroll, PanelTop } from "../shared/PanelLayout";
import { PanelHeader } from "../shared/PanelHeader";
import { PanelSearch } from "../shared/PanelSearch";
import { applyAllTemplatePages, applyTemplatePage, fitTemplatePage } from "./templates/applyTemplate";
import "./TemplatesTab.css";

const GAP = 8;

/** "Presentation (16:9)" -> "Presentation" */
const shortTypeName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

const sameShape = (t: Template, w: number, h: number) => Math.abs(t.width / t.height - w / h) < 0.02;

/**
 * Templates: search + category chips + a two-column wall of template previews. A click puts a single-page template
 * on the current page (asking first when the page has content); a multi-page template opens a detail view where
 * the whole set - or any single page - can be applied or added.
 */
export default function TemplatesTab() {
  const design = useEditor((s) => s.design);
  const type = design ? getDesignType(design.typeId) : undefined;
  const available = useMemo(() => new Set(TEMPLATES.map((t) => t.category)), []);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(() => (type && available.has(type.templates) ? type.templates : "all"));
  const [onlyShape, setOnlyShape] = useState(false);
  const [detail, setDetail] = useState<Template | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);
  const debounced = useDebounced(query, 140);
  const [wallRef, wallWidth] = useElementWidth<HTMLDivElement>();

  const chips = useMemo(() => {
    const present = (Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).filter((c) => available.has(c));
    // the design's own category comes first, right after "All"
    const first = type && present.includes(type.templates) ? type.templates : null;
    const ordered = first ? [first, ...present.filter((c) => c !== first)] : present;
    return [{ id: "all", label: m.panelsTabs.shared.all }, ...ordered.map((c) => ({ id: c, label: TEMPLATE_CATEGORY_LABELS[c] }))];
  }, [available, type]);

  const results = useMemo(() => {
    const list = searchTemplates(debounced, category === "all" ? null : (category as TemplateCategory));
    return design && onlyShape ? list.filter((t) => sameShape(t, design.width, design.height)) : list;
  }, [debounced, category, onlyShape, design]);

  if (!design) return null;

  if (detail) return <TemplateDetail template={detail} onBack={() => setDetail(null)} />;

  const placeholder = type && type.id !== "custom" ? m.panelsTabs.templates.searchType(shortTypeName(type.name)) : m.panelsTabs.templates.search;
  const colWidth = wallWidth > 0 ? Math.floor((wallWidth - GAP) / 2) : 0;

  const choose = (t: Template) => {
    if (t.pages.length > 1) setDetail(t);
    else void applyTemplatePage(t, t.pages[0], "replace");
  };

  return (
    <Panel>
      <PanelTop>
        <PanelSearch
          value={query}
          onChange={setQuery}
          placeholder={placeholder}
          trailing={
            <IconButton
              ref={filterRef}
              label={m.panelsTabs.templates.filter}
              icon={<IconFilterList />}
              size="sm"
              active={onlyShape}
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
            />
          }
        />
        <MenuPopover
          open={filterOpen}
          anchor={filterRef.current}
          onClose={() => setFilterOpen(false)}
          placement="bottom-end"
          aria-label={m.panelsTabs.templates.filters}
          items={[
            { type: "label", label: m.panelsTabs.templates.show },
            { id: "all", label: m.panelsTabs.templates.allTemplates, checked: !onlyShape, onSelect: () => setOnlyShape(false) },
            { id: "shape", label: m.panelsTabs.templates.sameShape, checked: onlyShape, onSelect: () => setOnlyShape(true) },
            { type: "label", label: m.panelsTabs.templates.designIs(describeSize(design.width, design.height, design.unit)) },
          ]}
        />
        {chips.length > 1 ? <ChipRow chips={chips} value={category} onChange={setCategory} aria-label={m.panelsTabs.templates.categories} /> : null}
      </PanelTop>
      <PanelScroll>
        <div ref={wallRef} className="cf-tpl__wall">
          {TEMPLATES.length === 0 ? (
            <>
              <EmptyHint icon={<IconTemplate />} title={m.panelsTabs.templates.onTheirWay} text={m.panelsTabs.templates.onTheirWayText} compact />
              <TemplateSkeletons width={colWidth} />
            </>
          ) : results.length === 0 ? (
            <EmptyHint
              icon={<IconTemplate />}
              title={m.panelsTabs.templates.noneTitle}
              text={debounced.trim() ? m.panelsTabs.templates.noneText(debounced.trim()) : m.panelsTabs.templates.emptyCategory}
              action={
                category !== "all" || onlyShape || query ? (
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() => {
                      setCategory("all");
                      setOnlyShape(false);
                      setQuery("");
                    }}
                  >
                    {m.panelsTabs.templates.showAll}
                  </Button>
                ) : undefined
              }
            />
          ) : colWidth > 0 ? (
            <Masonry
              items={results}
              columns={2}
              gap={GAP}
              aspectOf={(t) => t.height / t.width}
              keyOf={(t) => t.id}
              renderItem={(t) => <TemplateCard template={t} width={colWidth} onChoose={choose} />}
            />
          ) : null}
        </div>
      </PanelScroll>
    </Panel>
  );
}

function TemplateSkeletons({ width }: { width: number }) {
  const w = width || 150;
  return (
    <div className="cf-tpl__skeletons" aria-hidden="true">
      {[0.5625, 0.72, 0.5625, 0.5625, 0.72, 0.5625].map((a, i) => (
        <Skeleton key={i} width={w} height={Math.round(w * a)} radius={12} />
      ))}
    </div>
  );
}

function TemplateCard({ template, width, onChoose }: { template: Template; width: number; onChoose: (t: Template) => void }) {
  const pages = template.pages.length;
  return (
    <DraggableItem label={m.panelsTabs.templates.card(template.name, pages)} onInsert={() => onChoose(template)} className="cf-tpl__card" tooltip={false}>
      <TemplateThumb template={template} width={width} className="cf-tpl__thumb" />
      {pages > 1 ? (
        <span className="cf-tpl__pages">
          <IconPages aria-hidden="true" />
          {pages}
        </span>
      ) : null}
      <span className="cf-tpl__name">{template.name}</span>
    </DraggableItem>
  );
}

/* ------------------------------------------------------------------ */
/* multi-page template detail                                           */
/* ------------------------------------------------------------------ */

function TemplateDetail({ template, onBack }: { template: Template; onBack: () => void }) {
  const design = useEditor((s) => s.design);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [busy, setBusy] = useState(false);
  const n = template.pages.length;

  // the previews show the pages as they will land on this design
  const fitted = useMemo(() => (design ? template.pages.map((p) => fitTemplatePage(template, p, design)) : template.pages), [template, design]);
  if (!design) return null;

  const applyAll = async () => {
    setBusy(true);
    try {
      await applyAllTemplatePages(template);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelTop>
        <PanelHeader
          title={template.name}
          subtitle={m.panelsTabs.templates.detailSubtitle(n, describeSize(template.width, template.height, "px"))}
          onBack={onBack}
          backLabel={m.panelsTabs.templates.back}
        />
        <Button variant="primary" size="lg" block icon={<IconPages />} loading={busy} onClick={() => void applyAll()}>
          {m.panelsTabs.templates.applyAll(n)}
        </Button>
      </PanelTop>
      <PanelScroll>
        <div ref={ref} className="cf-tpl__pages-list">
          {width > 0
            ? fitted.map((page, i) => (
                <div key={page.id} className="cf-tpl__page">
                  <div className="cf-tpl__page-head">
                    <span className="cf-tpl__page-no">{m.panelsTabs.templates.page(i + 1)}</span>
                    <Button variant="ghost" size="sm" icon={<IconPlus />} onClick={() => void applyTemplatePage(template, template.pages[i], "add")} className="cf-tpl__add">
                      {m.panelsTabs.templates.addAsNew}
                    </Button>
                  </div>
                  <DraggableItem
                    label={m.panelsTabs.templates.usePage(i + 1)}
                    onInsert={() => void applyTemplatePage(template, template.pages[i], "replace")}
                    className="cf-tpl__page-card"
                    tooltip={false}
                  >
                    <PageThumb design={design} page={fitted[i]} width={width} className="cf-tpl__thumb" placeholder={template.accent} />
                  </DraggableItem>
                </div>
              ))
            : null}
        </div>
      </PanelScroll>
    </Panel>
  );
}
