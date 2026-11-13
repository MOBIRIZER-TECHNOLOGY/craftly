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

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

/** "Regular, Bold, Regular italic · 3 files" */
function stylesOf(family: CustomFamily): string {
  const names = family.files.map((file) => {
    const weight = file.maxWeight > file.weight ? `Every weight from ${file.weight} to ${file.maxWeight}` : (WEIGHT_NAMES[file.weight] ?? String(file.weight));
    return file.italic ? `${weight} italic` : weight;
  });
  return `${[...new Set(names)].join(", ")} · ${family.files.length} ${family.files.length === 1 ? "file" : "files"}`;
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
        toast.error(error instanceof FontUploadError ? `${file.name}: ${error.message}` : `${file.name} could not be saved on this device.`);
      }
    }
    setBusy(false);
    if (added.length === 1) {
      const [{ family, format }] = added;
      toast.success(`${family} was added to your fonts.${isCompressed(format) ? " The name comes from the file name; rename it if it is not the font's name." : ""}`);
    } else if (added.length > 1) {
      toast.success(`${added.length} font files were added to your fonts.`);
    }
  };

  const remove = async (family: string) => {
    const yes = await confirm({
      title: `Delete ${family}?`,
      message:
        "The font is removed from this device. Text that uses it, in any design, is then shown in a substitute font. The designs themselves are not changed: upload the font again under the same name and they look as before.",
      confirmLabel: "Delete font",
      danger: true,
    });
    if (!yes) return;
    try {
      await deleteCustomFamily(family);
      toast.info(`${family} was deleted.`);
    } catch {
      toast.error(`${family} could not be deleted.`);
    }
  };

  const rename = async (from: string, wanted: string) => {
    setRenaming(null);
    const asked = cleanFamilyName(wanted);
    if (!asked || asked === from) return;
    try {
      const got = await renameCustomFamily(from, asked);
      if (got !== asked) toast.info(`Craftly already has a font called ${asked}, so yours is called ${got}.`);
    } catch {
      toast.error(`${from} could not be renamed.`);
    }
  };

  return (
    <div className="cf-customfonts">
      {families === null ? null : families.length === 0 ? (
        <p className="cf-customfonts__empty">No uploaded fonts yet.</p>
      ) : (
        <ul className="cf-customfonts__list">
          {families.map((family) => (
            <li key={family.family} className="cf-customfonts__row">
              {renaming === family.family ? (
                <RenameForm family={family.family} onSave={(name) => void rename(family.family, name)} onCancel={() => setRenaming(null)} />
              ) : (
                <>
                  <FamilyLabel family={family} onUse={onUse} />
                  <Button size="sm" variant="ghost" aria-label={`Rename ${family.family}`} onClick={() => setRenaming(family.family)}>
                    Rename
                  </Button>
                  <IconButton size="sm" label={`Delete ${family.family}`} icon={<IconTrash aria-hidden="true" />} onClick={() => void remove(family.family)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" icon={<IconUpload aria-hidden="true" />} loading={busy} onClick={() => inputRef.current?.click()}>
        Upload a font
      </Button>
      <input ref={inputRef} type="file" accept={FONT_ACCEPT} multiple hidden aria-label="Font files to upload" onChange={(event) => void upload(event.target.files)} />
      <p className="cf-customfonts__licence">Upload only fonts you have the right to use. TTF, OTF, WOFF or WOFF2 files, up to 10 MB each. They stay on this device.</p>
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
    <button type="button" className="cf-customfonts__main cf-customfonts__main--button" aria-label={`Use ${family.family}`} onClick={() => onUse(family.family)}>
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
        label="Family name"
        size="sm"
        value={value}
        maxLength={60}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        hint={`Designs that already use ${family} keep that name and show a substitute font until you choose the font again.`}
      />
      <div className="cf-customfonts__rename-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => onSave(value)}>
          Save
        </Button>
      </div>
    </div>
  );
}
