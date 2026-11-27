import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { m } from "@/i18n";
import { MODELS, modelHost } from "@/ml/registry";
import { BrandMark, Button, Modal } from "@/ui";
import { formatBytes } from "./format";
import "./AboutDialog.css";

/** The licences of the open-source packages and models, written by `npm run notices` and published beside the app (vite.config.ts). */
const NOTICES_URL = `${import.meta.env.BASE_URL}third-party-notices.txt`;

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
    <Modal open={open} onClose={onClose} size="sm" title={m.dashboard.account.about} className="cf-about">
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
          <p className="cf-about__tag">{m.dashboard.about.tagline}</p>
        </div>
      </div>

      <p className="cf-about__text">{m.dashboard.about.stored}</p>
      <p className="cf-about__text">{m.dashboard.about.aiTools(modelHost(MODELS[0]!))}</p>
      <p className="cf-about__text">{m.dashboard.about.keepCopy}</p>
      <p className="cf-about__text">
        <a href={NOTICES_URL} target="_blank" rel="noopener noreferrer">
          {m.dashboard.about.licences}
        </a>
      </p>

      <div className="cf-about__storage">
        <span className="cf-about__storage-icon" aria-hidden="true">
          <HardDrive />
        </span>
        <div className="cf-about__storage-text">
          <p className="cf-about__storage-title">{info?.used != null ? m.dashboard.about.storedSize(formatBytes(info.used)) : m.dashboard.about.storedHere}</p>
          <p className="cf-about__storage-sub">
            {info?.persisted === true ? m.dashboard.about.protected : info?.persisted === false ? m.dashboard.shared.mayClear : m.dashboard.about.localStorage}
          </p>
        </div>
        {info?.persisted === false ? (
          <Button size="sm" variant="soft" loading={asking} onClick={() => void protect()}>
            {m.dashboard.shared.protect}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
