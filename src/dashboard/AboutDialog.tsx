import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { MODELS, modelHost } from "@/ml/registry";
import { BrandMark, Button, Modal } from "@/ui";
import { formatBytes } from "./format";
import "./AboutDialog.css";

interface StorageInfo {
  used: number | null;
  quota: number | null;
  persisted: boolean | null;
}

async function readStorage(): Promise<StorageInfo> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage) return { used: null, quota: null, persisted: null };
  const [estimate, persisted] = await Promise.all([storage.estimate?.().catch(() => undefined), storage.persisted?.().catch(() => undefined)]);
  return { used: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted: persisted ?? null };
}

/** "About Craftly": where things are stored (this device), how much, and a button to protect it from automatic cleanup. */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title="About Craftly" className="cf-about">
      <AboutBody />
    </Modal>
  );
}

function AboutBody() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    void readStorage().then((value) => {
      if (live) setInfo(value);
    });
    return () => {
      live = false;
    };
  }, []);

  const protect = async () => {
    setAsking(true);
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* the browser decides; the status below shows the outcome */
    }
    setInfo(await readStorage());
    setAsking(false);
  };

  return (
    <div className="cf-about__body">
      <div className="cf-about__brand">
        <BrandMark size={44} />
        <div>
          <p className="cf-about__name">Craftly</p>
          <p className="cf-about__tag">Design anything, right in your browser.</p>
        </div>
      </div>

      <p className="cf-about__text">
        Everything you make here is stored on this device. Your designs, uploaded images and brand kit live in your browser's local storage, and nothing is sent to a server or an
        account. Craftly keeps working offline.
      </p>
      <p className="cf-about__text">
        The AI photo tools are the one exception: with your permission they download each model once, from {modelHost(MODELS[0]!)}, and then work offline. Your designs and photos
        are never sent.
      </p>
      <p className="cf-about__text">Clearing your browser's site data removes them, so download the designs you care about from the editor to keep a copy.</p>

      <div className="cf-about__storage">
        <span className="cf-about__storage-icon" aria-hidden="true">
          <HardDrive />
        </span>
        <div className="cf-about__storage-text">
          <p className="cf-about__storage-title">{info?.used != null ? `${formatBytes(info.used)} stored on this device` : "Stored on this device"}</p>
          <p className="cf-about__storage-sub">
            {info?.persisted === true
              ? "Protected: your browser will not clear it automatically."
              : info?.persisted === false
                ? "Your browser may clear it when the device is low on space."
                : "Local browser storage"}
          </p>
        </div>
        {info?.persisted === false ? (
          <Button size="sm" variant="soft" loading={asking} onClick={() => void protect()}>
            Protect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
