/**
 * "Your fonts": the fonts a person uploaded, with Upload, Rename and Delete. The Brand page of the dashboard and the
 * Brand tab of the editor both show it, so that an uploaded font is managed in one way and from either place.
 *
 * A family name is shown as text and never as markup; where it styles its own sample it goes through `cssFontFamily`,
 * which writes the name the app registered the family under and escapes the name the person gave.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  FontUploadError,
  addCustomFont,
  customFamilies,
  deleteCustomFamily,
  listCustomFonts,
  renameCustomFamily,
  subscribeCustomFonts,
  type CustomFamily,
} from "@/core/customFonts";
import { FONT_ACCEPT, cleanFamilyName, type FontFormat } from "@/core/fontFile";
import { m, num } from "@/i18n";
import { cssFontFamily, preloadFonts } from "@/render/fonts";
import { Button, IconButton, IconTrash, IconUpload, TextField, confirm, toast } from "@/ui";
import "./CustomFonts.css";

/** The uploaded families by name; null until they were read. Follows uploads, renames and deletions, from here or elsewhere on the page. */
export function useCustomFamilies(): CustomFamily[] | null {
  const [families, setFamilies] = useState<CustomFamily[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      listCustomFonts()
        .then((files) => alive && setFamilies(customFamilies(files)))
        .catch(() => alive && setFamilies([]));
    };
    load();
    const stop = subscribeCustomFonts(load);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return families;
}

/** "Regular, Bold, Regular italic · 3 files" */
function stylesOf(family: CustomFamily): string {
  const names = family.files.map((file) => {
    const weight = file.maxWeight > file.weight ? m.app.customFonts.everyWeight(file.weight, file.maxWeight) : (m.app.customFonts.weights[file.weight] ?? num(file.weight));
    return file.italic ? m.app.customFonts.italic(weight) : weight;
  });
  return m.app.customFonts.styles([...new Set(names)].join(", "), family.files.length);
}

const isCompressed = (format: FontFormat) => format === "woff" || format === "woff2";

export interface CustomFontsProps {
  /** what the row's main button does with a family (the editor applies it to the selection); without it a row is not a button */
  onUse?: (family: string) => void;
}

export function CustomFonts({ onUse }: CustomFontsProps) {
  const families = useCustomFamilies();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (!files.length) return;
    setBusy(true);
    const added: Array<{ family: string; format: FontFormat }> = [];
    for (const file of files) {
      try {
        const stored = await addCustomFont(file);
        added.push({ family: stored.family, format: stored.format });
      } catch (error) {
        // a refusal says why in words for the person; anything else is the storage
        toast.error(error instanceof FontUploadError ? m.app.customFonts.uploadRefused(file.name, error.message) : m.app.customFonts.notStored(file.name));
      }
    }
    setBusy(false);
    if (added.length === 1) {
      const [{ family, format }] = added;
      toast.success(isCompressed(format) ? m.app.customFonts.addedCompressed(family) : m.app.customFonts.added(family));
    } else if (added.length > 1) {
      toast.success(m.app.customFonts.addedMany(added.length));
    }
  };

  const remove = async (family: string) => {
    const yes = await confirm({
      title: m.app.customFonts.deleteTitle(family),
      message: m.app.customFonts.deleteMessage,
      confirmLabel: m.app.customFonts.deleteConfirm,
      danger: true,
    });
    if (!yes) return;
    try {
      await deleteCustomFamily(family);
      toast.info(m.app.customFonts.deleted(family));
    } catch {
      toast.error(m.app.customFonts.deleteFailed(family));
    }
  };

  const rename = async (from: string, wanted: string) => {
    setRenaming(null);
    const asked = cleanFamilyName(wanted);
    if (!asked || asked === from) return;
    try {
      const got = await renameCustomFamily(from, asked);
      if (got !== asked) toast.info(m.app.customFonts.renamedOther(asked, got));
    } catch {
      toast.error(m.app.customFonts.renameFailed(from));
    }
  };

  return (
    <div className="cf-customfonts">
      {families === null ? null : families.length === 0 ? (
        <p className="cf-customfonts__empty">{m.app.customFonts.empty}</p>
      ) : (
        <ul className="cf-customfonts__list">
          {families.map((family) => (
            <li key={family.family} className="cf-customfonts__row">
              {renaming === family.family ? (
                <RenameForm family={family.family} onSave={(name) => void rename(family.family, name)} onCancel={() => setRenaming(null)} />
              ) : (
                <>
                  <FamilyLabel family={family} onUse={onUse} />
                  <Button size="sm" variant="ghost" aria-label={m.app.customFonts.renameLabel(family.family)} onClick={() => setRenaming(family.family)}>
                    {m.app.customFonts.rename}
                  </Button>
                  <IconButton size="sm" label={m.app.customFonts.deleteLabel(family.family)} icon={<IconTrash aria-hidden="true" />} onClick={() => void remove(family.family)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" icon={<IconUpload aria-hidden="true" />} loading={busy} onClick={() => inputRef.current?.click()}>
        {m.app.customFonts.upload}
      </Button>
      <input ref={inputRef} type="file" accept={FONT_ACCEPT} multiple hidden aria-label={m.app.customFonts.uploadInput} onChange={(event) => void upload(event.target.files)} />
      <p className="cf-customfonts__licence">{m.app.customFonts.licence}</p>
    </div>
  );
}

function FamilyLabel({ family, onUse }: { family: CustomFamily; onUse?: (family: string) => void }) {
  // the sample is written in the font itself, so its files are loaded when the row appears
  useEffect(() => {
    void preloadFonts([family.family]);
  }, [family.family, family.files.length]);

  const label = (
    <>
      <span className="cf-customfonts__name" style={{ fontFamily: cssFontFamily(family.family) }}>
        {family.family}
      </span>
      <span className="cf-customfonts__meta">{stylesOf(family)}</span>
    </>
  );
  return onUse ? (
    <button type="button" className="cf-customfonts__main cf-customfonts__main--button" aria-label={m.app.customFonts.use(family.family)} onClick={() => onUse(family.family)}>
      {label}
    </button>
  ) : (
    <div className="cf-customfonts__main">{label}</div>
  );
}

function RenameForm({ family, onSave, onCancel }: { family: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(family);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSave(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="cf-customfonts__rename">
      <TextField
        label={m.app.customFonts.familyName}
        size="sm"
        value={value}
        maxLength={60}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        hint={m.app.customFonts.renameHint(family)}
      />
      <div className="cf-customfonts__rename-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {m.common.cancel}
        </Button>
        <Button size="sm" variant="primary" onClick={() => onSave(value)}>
          {m.common.save}
        </Button>
      </div>
    </div>
  );
}
