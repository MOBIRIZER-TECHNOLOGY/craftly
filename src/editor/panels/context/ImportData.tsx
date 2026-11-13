import { useEffect, useRef, useState } from "react";
import { MAX_INPUT_CHARS } from "@/core/delimited";
import { Button, IconUpload, cx } from "@/ui";
import { MAX_FILE_BYTES, tellImport, type ImportReport } from "./dataImport";
import { Section } from "./PanelShell";

/** What the file dialog offers. A spreadsheet program may give a .csv file a type of its own, so the name counts too. */
const ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";
const TEXT_NAME = /\.(csv|tsv|txt)$/i;
const TEXT_TYPES = ["text/csv", "text/tab-separated-values", "text/plain"];

const refused = (message: string): ImportReport => ({ ok: false, clean: false, message });

/** The text of a chosen file, or why it is not read. Only text files, and none over the size cap, are opened at all. */
async function readDataFile(file: File): Promise<string | ImportReport> {
  if (!TEXT_NAME.test(file.name) && !TEXT_TYPES.includes(file.type)) return refused("Choose a text file: .csv, .tsv or .txt.");
  if (file.size > MAX_FILE_BYTES) return refused("This file is larger than 2 MB. Import a smaller part of it.");
  let text: string;
  try {
    text = await file.text();
  } catch {
    return refused("The file could not be read.");
  }
  // text has no zero bytes; a picture or a workbook under a text name has plenty
  return text.includes("\u0000") ? refused("This file is not plain text.") : text;
}

/**
 * "Import data" of the Data panel: a field to paste rows into (from a spreadsheet, or CSV text) and a button to choose a
 * text file. `onImport` puts the text into the table or chart and answers with what happened; that is shown as a toast and
 * stays under the buttons, where it can be read again.
 */
export function ImportData({ hint, onImport }: { hint: string; onImport: (text: string) => ImportReport }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<ImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // a file is read in the background: when the panel has gone meanwhile (another element was selected), nothing is imported
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => void (here.current = false);
  }, []);

  const tell = (result: ImportReport) => {
    tellImport(result);
    setNote(result);
  };

  const importText = () => {
    const result = onImport(text);
    tell(result);
    if (result.ok) setText("");
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const read = await readDataFile(file);
    if (!here.current) return;
    tell(typeof read === "string" ? onImport(read) : read);
  };

  return (
    <Section title="Import data">
      <textarea
        className="cf-data__paste"
        aria-label="Data to import"
        placeholder="Paste cells copied from a spreadsheet, or CSV text"
        rows={3}
        autoComplete="off"
        spellCheck={false}
        value={text}
        // one character more than is read, so that the import can say the text was too long
        onChange={(e) => setText(e.target.value.slice(0, MAX_INPUT_CHARS + 1))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
      <div className="cf-data__actions">
        <Button block variant="secondary" disabled={!text.trim()} onClick={importText}>
          Import
        </Button>
        <Button block variant="secondary" icon={<IconUpload />} onClick={() => fileRef.current?.click()}>
          Choose a file
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void importFile(file);
        }}
      />
      <p className={cx("cf-ctx__hint", note && !note.ok && "cf-data__refused")}>{note ? note.message : hint}</p>
    </Section>
  );
}
