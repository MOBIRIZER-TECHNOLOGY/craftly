import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import type { Support } from "@/ml/device";
import { asMlError } from "@/ml/errors";
import { INSTALL_TEXT } from "@/ml/labels";
import { formatBytes, MODELS } from "@/ml/registry";
import { importModelFile, installModel, refreshModels, removeModel } from "@/ml/service";
import { modelStatus, useMlStore, type ModelStatus } from "@/ml/state";
import type { ModelSpec } from "@/ml/types";
import { useSupport } from "@/ml/useSupport";
import { Badge, Button, confirm, IconAlert, IconDownload, IconTrash, IconUpload, Modal, Progress, toast, type BadgeTone } from "@/ui";
import "./modelsDialog.css";

const BADGES: Record<ModelStatus, { tone: BadgeTone; text: string }> = {
  unknown: { tone: "neutral", text: m.editorChrome.models.badge.unknown },
  missing: { tone: "neutral", text: m.editorChrome.models.badge.missing },
  installing: { tone: "info", text: m.editorChrome.models.badge.installing },
  ready: { tone: "success", text: m.editorChrome.models.badge.ready },
  outdated: { tone: "warning", text: m.editorChrome.models.badge.outdated },
};

/** What is installed, what it is, who made it under which licence, and how to add or remove it. */
export function ModelsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const storage = useMlStore((s) => s.storage);
  // the browser as such (background tasks, storage, WebGPU) holds for every model; a missing graphics-card feature only for the model that needs it
  const support = useSupport([], open);

  useEffect(() => {
    if (open) void refreshModels().catch(() => undefined);
  }, [open]);

  const unsupported = support && !support.ok ? support : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={m.editorChrome.models.title}
      footer={
        <Button variant="primary" onClick={onClose}>
          {m.common.done}
        </Button>
      }
    >
      <div className="cf-models">
        <p className="cf-models__lede">{m.editorChrome.models.lede}</p>
        {unsupported ? (
          <p className="cf-models__warn">
            <IconAlert aria-hidden="true" />
            <span>{unsupported.message}</span>
          </p>
        ) : null}
        <ul className="cf-models__list">
          {MODELS.map((spec) => (
            <ModelRow key={spec.id} spec={spec} browser={support} />
          ))}
        </ul>
        {storage.usage !== undefined && storage.quota !== undefined ? (
          <p className="cf-models__storage">
            {m.editorChrome.models.storageUsed(formatBytes(storage.usage), formatBytes(storage.quota))}{" "}
            {storage.persisted === true ? m.editorChrome.models.kept : storage.persisted === false ? m.editorChrome.models.mayRemove : null}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** `browser` is the answer for the browser as such, null until it is in: a model's own needs are asked only once that is good. */
function ModelRow({ spec, browser }: { spec: ModelSpec; browser: Support | null }) {
  const status = useMlStore((s) => modelStatus(spec, s));
  const install = useMlStore((s) => s.installing[spec.id]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const own = useSupport(spec.gpuFeatures, browser?.ok === true && spec.gpuFeatures.length > 0);
  const lacking = own && !own.ok ? own : null;
  const blocked = browser?.ok === false || !!lacking;
  const badge = BADGES[status];
  const size = formatBytes(spec.bytes);

  const download = async () => {
    try {
      const { warmError } = await installModel(spec.id);
      if (warmError) toast.error(m.editorChrome.models.downloadedButFailed(spec.name, warmError.message));
      else toast.success(m.editorChrome.models.ready(spec.name));
    } catch (error) {
      const known = asMlError(error, "network");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  const remove = async () => {
    const agreed = await confirm({
      title: m.editorChrome.models.removeTitle,
      message: m.editorChrome.models.removeMessage(spec.name, size),
      confirmLabel: m.common.remove,
      cancelLabel: m.editorChrome.models.keep,
      danger: true,
    });
    if (!agreed) return;
    try {
      await removeModel(spec.id);
      toast.success(m.editorChrome.models.removed(spec.name));
    } catch (error) {
      toast.error(asMlError(error, "storage").message);
    }
  };

  const addFromFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const { warmError } = await importModelFile(spec.id, file);
      if (warmError) toast.error(m.editorChrome.models.addedButFailed(spec.name, warmError.message));
      else toast.success(m.editorChrome.models.added(spec.name));
    } catch (error) {
      toast.error(asMlError(error, "storage").message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <li className="cf-models__item">
      <div className="cf-models__head">
        <strong className="cf-models__name">{spec.name}</strong>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <p className="cf-models__text">
        {spec.summary} {m.editorChrome.models.usedBy(spec.tool)}
      </p>
      <p className="cf-models__meta">
        {m.editorChrome.models.licenceLine(size, spec.licence.name, spec.licence.notice)}{" "}
        <a href={spec.licence.url} target="_blank" rel="noopener noreferrer">
          {m.editorChrome.models.licence}
        </a>{" "}
        <a href={spec.credit.url} target="_blank" rel="noopener noreferrer">
          {m.editorChrome.models.source}
        </a>
      </p>
      <p className="cf-models__meta">{spec.credit.text}.</p>
      {lacking ? (
        <p className="cf-models__warn">
          <IconAlert aria-hidden="true" />
          <span>{lacking.message}</span>
        </p>
      ) : null}

      {install ? (
        // Only the step is announced ("Downloading the model"); the sizes change constantly and stay out of the announcement.
        // Cancel takes the keyboard, because the button that started this is gone.
        <div className="cf-models__work">
          <div className="cf-models__work-row">
            <span role="status">{INSTALL_TEXT[install.phase]}</span>
            {install.phase === "downloading" ? (
              <span className="cf-models__sizes">{m.editorChrome.models.sizeOf(formatBytes(install.received), formatBytes(install.total))}</span>
            ) : null}
            {install.phase !== "saving" ? (
              <Button size="sm" variant="secondary" autoFocus onClick={() => install.cancel()}>
                {m.common.cancel}
              </Button>
            ) : null}
          </div>
          <Progress label={m.editorChrome.models.downloading(spec.name)} value={install.phase === "downloading" ? install.received / install.total : undefined} />
        </div>
      ) : (
        <div className="cf-models__actions">
          {status === "ready" ? (
            <Button size="sm" variant="secondary" icon={<IconTrash />} aria-label={m.editorChrome.models.removeName(spec.name)} onClick={() => void remove()}>
              {m.common.remove}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<IconDownload />} disabled={blocked} onClick={() => void download()}>
              {m.editorChrome.models.downloadSize(size)}
            </Button>
          )}
          {status !== "ready" ? (
            <Button size="sm" variant="ghost" icon={<IconUpload />} disabled={blocked} loading={importing} onClick={() => fileInput.current?.click()}>
              {importing ? m.editorChrome.models.adding : m.editorChrome.models.addFromFile}
            </Button>
          ) : null}
          <input
            ref={fileInput}
            className="cf-sr-only"
            type="file"
            accept=".onnx"
            tabIndex={-1}
            aria-label={m.editorChrome.models.chooseFile(spec.name)}
            disabled={blocked || importing}
            onChange={(e) => {
              void addFromFile(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </div>
      )}
    </li>
  );
}
