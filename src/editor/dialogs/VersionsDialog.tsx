import { useCallback, useEffect, useMemo, useState } from "react";
import { PageThumb } from "@/components/PageThumb";
import { getVersion, listVersions, saveVersion, type VersionRecord } from "@/core/library";
import { useEditor } from "@/core/store";
import { describeSize } from "@/data/designTypes";
import { date, locale, m, num } from "@/i18n";
import { Button, IconHistory, IconSave, Modal, Skeleton, cx, confirm, toast } from "@/ui";
import "./versionsDialog.css";

type VersionRow = Omit<VersionRecord, "design">;

const full = (at: number) => date(at, { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

/** "5 minutes ago", "yesterday" */
function ago(at: number): string {
  const seconds = Math.round((at - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return m.editorChrome.versions.justNow;
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86400), "day");
}

/** Saved versions of the open design: save one now, preview one, restore one. */
export function VersionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const designId = useEditor((s) => s.design?.id);
  const readOnly = useEditor((s) => s.mode === "view");
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<VersionRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const refresh = useCallback(async () => {
    if (!designId) return;
    try {
      const list = await listVersions(designId);
      setRows(list);
      setSelected((cur) => (cur && list.some((v) => v.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch {
      setRows([]);
    }
  }, [designId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // load the selected version so its first page can be previewed
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let live = true;
    void getVersion(selected).then((v) => live && setPreview(v));
    return () => {
      live = false;
    };
  }, [selected]);

  const saveNow = async () => {
    const design = useEditor.getState().design;
    if (!design) return;
    setSaving(true);
    try {
      await saveVersion(design, "Saved by you");
      await refresh();
      toast.success(m.editorChrome.versions.savedToast);
    } catch {
      toast.error(m.editorChrome.versions.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!preview || readOnly) return;
    const ok = await confirm({
      title: m.editorChrome.versions.restoreTitle,
      message: m.editorChrome.versions.restoreMessage(full(preview.createdAt)),
      confirmLabel: m.editorChrome.versions.restore,
    });
    if (!ok) return;
    const state = useEditor.getState();
    setRestoring(true);
    try {
      if (state.design) await saveVersion(state.design, "Before restoring");
      state.actions.replaceDesign(preview.design);
      toast.success(m.editorChrome.versions.restored);
      onClose();
    } catch {
      toast.error(m.editorChrome.versions.restoreFailed);
    } finally {
      setRestoring(false);
    }
  };

  const previewSize = useMemo(() => (preview ? { width: preview.design.width, height: preview.design.height } : null), [preview]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={m.editorChrome.versions.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common.close}
          </Button>
          <Button variant="primary" disabled={!preview || readOnly} loading={restoring} onClick={() => void restore()}>
            {m.editorChrome.versions.restoreThis}
          </Button>
        </>
      }
    >
      <div className="cf-versions">
        <div className="cf-versions__list-wrap">
          <Button variant="soft" icon={<IconSave aria-hidden="true" />} block disabled={saving || readOnly} loading={saving} onClick={() => void saveNow()}>
            {m.editorChrome.versions.saveNow}
          </Button>
          {rows === null ? (
            <div className="cf-versions__skeleton" aria-hidden="true">
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : rows.length === 0 ? (
            <div className="cf-versions__empty">
              <IconHistory aria-hidden="true" />
              <p>{m.editorChrome.versions.empty}</p>
              <p className="cf-versions__empty-hint">{m.editorChrome.versions.emptyHint}</p>
            </div>
          ) : (
            <ul className="cf-versions__list" role="listbox" aria-label={m.editorChrome.versions.list}>
              {rows.map((v) => (
                <li key={v.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === v.id}
                    className={cx("cf-versions__item", selected === v.id && "is-selected")}
                    onClick={() => setSelected(v.id)}
                  >
                    <span className="cf-versions__when">{full(v.createdAt)}</span>
                    <span className="cf-versions__meta">
                      {v.label ? m.editorChrome.versions.meta(m.editorChrome.versions.label(v.label), ago(v.createdAt)) : m.editorChrome.versions.autosave(ago(v.createdAt))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cf-versions__preview" aria-live="polite">
          {preview && previewSize ? (
            <>
              <div className="cf-versions__canvas">
                <PageThumb
                  design={previewSize}
                  page={preview.design.pages[0]}
                  width={Math.min(300, Math.round((220 * previewSize.width) / previewSize.height))}
                  className="cf-versions__thumb"
                />
              </div>
              <dl className="cf-versions__facts">
                <div>
                  <dt>{m.editorChrome.versions.saved}</dt>
                  <dd>{full(preview.createdAt)}</dd>
                </div>
                <div>
                  <dt>{m.editorChrome.versions.titleFact}</dt>
                  <dd>{preview.design.title}</dd>
                </div>
                <div>
                  <dt>{m.editorChrome.versions.size}</dt>
                  <dd>{describeSize(preview.design.width, preview.design.height, preview.design.unit)}</dd>
                </div>
                <div>
                  <dt>{m.editorChrome.versions.pages}</dt>
                  <dd>{num(preview.design.pages.length)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="cf-versions__hint">{rows && rows.length ? m.editorChrome.versions.selectHint : m.editorChrome.versions.emptyPreview}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
