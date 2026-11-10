import { useEffect, useState } from "react";
import { getDesign } from "@/core/library";
import { earlierVersions, goBackToVersion, type EarlierVersion } from "@/core/recovery";
import { downloadBlob } from "@/export/download";
import { Button, toast } from "@/ui";
import "./ErrorBoundary.css";

const versionTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props {
  designId: string;
  /** open or folded away: somebody who cannot open the design at all has no use for a folded section */
  open: boolean;
}

/**
 * The ways back for a design that cannot be used (docs/CRASH-RECOVERY.md): the earlier versions to put back, and a copy of the design
 * to save to a file without opening it. It works from the library alone, because the editor is what may not open. The screen that
 * says Craftly stopped shows it, and so does the one that says that the design cannot be opened.
 */
export function RecoveryPanel({ designId, open }: Props) {
  const [versions, setVersions] = useState<EarlierVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void earlierVersions(designId).then(
      (list) => live && setVersions(list),
      () => live && setVersions([]),
    );
    return () => {
      live = false;
    };
  }, [designId]);

  const goBack = async (version: EarlierVersion) => {
    setBusy(version.id);
    try {
      if (await goBackToVersion(designId, version.id)) {
        window.location.reload();
        return;
      }
    } catch {
      /* said below */
    }
    setBusy(null);
    toast.error("That version could not be restored. Try another one.");
  };

  const saveCopy = async () => {
    setBusy("copy");
    try {
      const design = await getDesign(designId);
      if (!design) throw new Error("The design is not stored.");
      const { exportProjectFile, projectFileName } = await import("@/export/projectFile");
      downloadBlob(await exportProjectFile(design), projectFileName(design.title));
      toast.success("Saved a copy of the design");
    } catch {
      toast.error("The copy could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="cf-crash__more" open={open}>
      <summary>Go back to an earlier version</summary>
      {versions === null ? (
        <p>Looking for earlier versions…</p>
      ) : versions.length === 0 ? (
        <p>There are no earlier versions of this design yet.</p>
      ) : (
        <ul className="cf-crash__versions">
          {versions.map((version) => (
            <li key={version.id}>
              <span>
                {versionTime.format(version.at)} · {version.label}
              </span>
              <Button size="sm" loading={busy === version.id} disabled={busy !== null} onClick={() => void goBack(version)}>
                Use this version
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" size="sm" loading={busy === "copy"} disabled={busy !== null} onClick={() => void saveCopy()}>
        Save a copy of the design to a file
      </Button>
    </details>
  );
}
