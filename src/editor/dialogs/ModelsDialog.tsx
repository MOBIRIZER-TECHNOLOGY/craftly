import { useEffect, useRef, useState } from "react";
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
  unknown: { tone: "neutral", text: "Checking…" },
  missing: { tone: "neutral", text: "Not downloaded" },
  installing: { tone: "info", text: "Downloading" },
  ready: { tone: "success", text: "Installed" },
  outdated: { tone: "warning", text: "Needs update" },
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
      title="On-device models"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="cf-models">
        <p className="cf-models__lede">Some photo tools use AI models that run on this device. A model downloads once and then works offline. Your photos are never uploaded.</p>
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
            {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used by Craftly in this browser.{" "}
            {storage.persisted === true
              ? "Downloaded models are kept until you remove them."
              : storage.persisted === false
                ? "The browser may remove downloaded models when space runs low."
                : null}
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
      if (warmError) toast.error(`${spec.name} was downloaded, but it could not run on this device. ${warmError.message}`);
      else toast.success(`${spec.name} is ready.`);
    } catch (error) {
      const known = asMlError(error, "network");
      if (known.code !== "aborted") toast.error(known.message);
    }
  };

  const remove = async () => {
    const agreed = await confirm({
      title: "Remove the model?",
      message: `${spec.name} (${size}) will be deleted from this device. You can download it again later.`,
      confirmLabel: "Remove",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!agreed) return;
    try {
      await removeModel(spec.id);
      toast.success(`${spec.name} was removed.`);
    } catch (error) {
      toast.error(asMlError(error, "storage").message);
    }
  };

  const addFromFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const { warmError } = await importModelFile(spec.id, file);
      if (warmError) toast.error(`${spec.name} was added from the file, but it could not be tried out. ${warmError.message}`);
      else toast.success(`${spec.name} was added from the file.`);
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
        {spec.summary} Used by the {spec.tool}.
      </p>
      <p className="cf-models__meta">
        {size}, {spec.licence.name} licence. {spec.licence.notice}.{" "}
        <a href={spec.licence.url} target="_blank" rel="noopener noreferrer">
          Licence
        </a>{" "}
        <a href={spec.credit.url} target="_blank" rel="noopener noreferrer">
          Source
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
              <span className="cf-models__sizes">
                {formatBytes(install.received)} of {formatBytes(install.total)}
              </span>
            ) : null}
            {install.phase !== "saving" ? (
              <Button size="sm" variant="secondary" autoFocus onClick={() => install.cancel()}>
                Cancel
              </Button>
            ) : null}
          </div>
          <Progress label={`Downloading ${spec.name}`} value={install.phase === "downloading" ? install.received / install.total : undefined} />
        </div>
      ) : (
        <div className="cf-models__actions">
          {status === "ready" ? (
            <Button size="sm" variant="secondary" icon={<IconTrash />} aria-label={`Remove ${spec.name}`} onClick={() => void remove()}>
              Remove
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<IconDownload />} disabled={blocked} onClick={() => void download()}>
              {`Download ${size}`}
            </Button>
          )}
          {status !== "ready" ? (
            <Button size="sm" variant="ghost" icon={<IconUpload />} disabled={blocked} loading={importing} onClick={() => fileInput.current?.click()}>
              {importing ? "Adding…" : "Add from a file"}
            </Button>
          ) : null}
          <input
            ref={fileInput}
            className="cf-sr-only"
            type="file"
            accept=".onnx"
            tabIndex={-1}
            aria-label={`Choose a model file for ${spec.name}`}
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
