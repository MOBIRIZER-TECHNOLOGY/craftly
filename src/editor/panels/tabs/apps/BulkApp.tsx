import { useMemo, useState } from "react";
import { pagePlaceholders, placeholderFor } from "@/core/bulk";
import { createText } from "@/core/factory";
import { flatten } from "@/core/ops";
import { getActions, getActivePage, useEditor } from "@/core/store";
import { m } from "@/i18n";
import { designPath, navigate } from "@/router";
import { Button, IconCheck, IconPages, IconPlus, Segmented, Select, toast } from "@/ui";
import { ImportData } from "../../context/ImportData";
// the paste field and its buttons are the Data panel's
import "../../context/DataPanel.css";
import { AppField, AppPage } from "./appKit";
import { createBulkDesigns, createBulkPages, readBulkData, useBulkData } from "./bulkCreate";
import "./BulkApp.css";

/**
 * Bulk create: import a sheet whose first row names its columns, write a name between double braces where its values belong
 * (a button does it for each column), and get a copy of the open page for every row, filled from that row.
 */
export function BulkApp() {
  const data = useBulkData((s) => s.data);
  const setData = useBulkData((s) => s.setData);
  const imageColumns = useBulkData((s) => s.imageColumns);
  const setImageColumn = useBulkData((s) => s.setImageColumn);
  const [creating, setCreating] = useState(false);
  const [output, setOutput] = useState<"pages" | "designs">("pages");
  const page = useEditor((s) => getActivePage(s));
  const onPage = useMemo(() => (page ? pagePlaceholders(page) : []), [page]);
  const pageImages = useMemo(() => (page ? flatten(page.elements).filter((el) => el.type === "image") : []), [page]);

  const fields = data?.fields ?? [];
  const used = fields.filter((f) => onPage.includes(f.key));
  const mapped = pageImages.some((image) => !!imageColumns[image.id]);
  const unknown = data ? onPage.filter((key) => !fields.some((f) => f.key === key)) : [];
  const count = used.length || mapped ? (data?.records.length ?? 0) : 0;
  const status = !data
    ? m.panelsTabs.bulk.noData
    : !used.length && !mapped
      ? m.panelsTabs.bulk.noneOnPage
      : unknown.length
        ? m.panelsTabs.bulk.unknown(unknown.map(placeholderFor).join(", "))
        : "";

  const addColumn = (name: string) => {
    const d = useEditor.getState().design;
    if (!d) return;
    const fontSize = Math.round(Math.min(d.width, d.height) * 0.05);
    // each box a line under the one before, so that two columns do not land on each other
    const y = Math.min(d.height / 2 + onPage.length * fontSize * 1.6, d.height - fontSize);
    getActions().addElement(createText({ text: placeholderFor(name), fontSize }), { at: { x: d.width / 2, y } });
  };

  const create = async () => {
    setCreating(true);
    try {
      if (output === "designs") {
        const made = await createBulkDesigns();
        if (made.length) {
          toast.success(m.panelsTabs.bulk.createdDesigns(made.length), { actionLabel: m.dashboard.shared.open, onAction: () => navigate(designPath(made[0].id)) });
        } else toast.error(m.panelsTabs.bulk.viewOnly);
      } else {
        const made = await createBulkPages();
        if (made) toast.success(m.panelsTabs.bulk.created(made));
        else toast.error(m.panelsTabs.bulk.viewOnly);
      }
    } catch (error) {
      if (output === "designs") toast.error(m.panelsTabs.bulk.designsFailed);
      else throw error;
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppPage
      title={m.panelsTabs.bulk.title}
      subtitle={m.panelsTabs.bulk.subtitle}
      footer={
        <>
          <p className="cf-app__hint cf-bulk__status" role="status">
            {status}
          </p>
          <Button variant="primary" size="lg" block icon={<IconPages />} disabled={!count || creating} onClick={() => void create()}>
            {count ? (output === "designs" ? m.panelsTabs.bulk.createDesigns(count) : m.panelsTabs.bulk.create(count)) : m.panelsTabs.bulk.createNone}
          </Button>
        </>
      }
    >
      <ImportData hint={m.panelsTabs.bulk.dataHint} onImport={readBulkData} />
      <AppField label={m.panelsTabs.bulk.output}>
        <Segmented
          value={output}
          onChange={setOutput}
          aria-label={m.panelsTabs.bulk.output}
          fullWidth
          options={[
            { value: "pages", label: m.panelsTabs.bulk.outputPages },
            { value: "designs", label: m.panelsTabs.bulk.outputDesigns },
          ]}
        />
      </AppField>
      {data ? (
        <AppField label={m.panelsTabs.bulk.columns} hint={m.panelsTabs.bulk.columnsHint} className="cf-bulk__columns">
          <ul className="cf-bulk__fields">
            {fields.map((f) => {
              const braces = placeholderFor(f.name);
              const there = onPage.includes(f.key);
              return (
                <li key={f.key}>
                  <Button
                    size="sm"
                    icon={there ? <IconCheck /> : <IconPlus />}
                    aria-label={there ? m.panelsTabs.bulk.addColumnAgain(braces) : m.panelsTabs.bulk.addColumn(braces)}
                    onClick={() => addColumn(f.name)}
                  >
                    {braces}
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" className="cf-bulk__remove" onClick={() => setData(null)}>
            {m.panelsTabs.bulk.remove}
          </Button>
        </AppField>
      ) : null}
      {data && pageImages.length ? (
        <AppField label={m.panelsTabs.bulk.imageColumns}>
          {pageImages.map((image) => (
            <Select
              key={image.id}
              value={imageColumns[image.id] ?? ""}
              onChange={(field) => setImageColumn(image.id, field)}
              aria-label={m.panelsTabs.bulk.imageColumn(image.name || image.id)}
              options={[{ value: "", label: m.panelsTabs.bulk.noImageColumn }, ...fields.map((field) => ({ value: field.key, label: field.name }))]}
            />
          ))}
        </AppField>
      ) : null}
    </AppPage>
  );
}
