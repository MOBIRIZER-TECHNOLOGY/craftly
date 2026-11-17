/**
 * Opening a file from the dashboard: a `.craftly` project file (Import project file in the account menu) or a picture to start a
 * design around (the welcome panel's "Open a file" takes either).
 */
import { importProjectFile } from "@/export/projectFile";
import { ProjectFileError, type ImportReport } from "@/export/projectFormat";
import { m } from "@/i18n";
import { designPath, navigate } from "@/router";
import { toast } from "@/ui";
import { createFromImageFile, IMAGE_ACCEPT } from "./actions";
import { pickFiles } from "./files";

export const PROJECT_ACCEPT = ".craftly,.json,application/json";

/** A project file by its name or type; anything else is taken for a picture. */
export const isProjectFile = (file: File) => /\.(craftly|json)$/i.test(file.name) || file.type === "application/json";

/** Imports a .craftly file and opens the design it holds; what goes wrong is said in a toast. */
export async function importProjectAndOpen(file: File): Promise<void> {
  try {
    const report: ImportReport = { skipped: 0 };
    const design = await importProjectFile(file, report);
    // what could not be read, and what was taken out, is said: nothing is left out without a word
    const notes: string[] = [];
    if (report.skipped) notes.push(m.dashboard.imported.skipped(report.skipped));
    if (report.remote) notes.push(m.dashboard.imported.remote(report.remote));
    if (report.comments) notes.push(m.dashboard.imported.comments(report.comments));
    if (notes.length) toast.info(m.dashboard.imported.withNotes(design.title, notes.join(" ")));
    else toast.success(m.dashboard.imported.done(design.title));
    navigate(designPath(design.id));
  } catch (error) {
    // a project file's own problems come with words for a person; anything else is the browser failing to store the design,
    // and its own text ("Failed to execute 'put' on 'IDBObjectStore'...") is no use to them
    const detail = error instanceof ProjectFileError ? error.message : m.dashboard.importFailed.notStored;
    toast.error(m.dashboard.importFailed.toast(detail));
  }
}

/** Import project file: choose a .craftly file and open the design in it. Call straight from a click handler. */
export function pickProjectAndOpen(): Promise<void> {
  return pickFiles({ accept: PROJECT_ACCEPT }).then(([file]) => (file ? importProjectAndOpen(file) : undefined));
}

/** Open a file: a project file opens its design, a picture starts a design of its own size. Call straight from a click handler. */
export function pickAnyFileAndOpen(): Promise<void> {
  return pickFiles({ accept: `${PROJECT_ACCEPT},${IMAGE_ACCEPT}` }).then(async ([file]) => {
    if (!file) return;
    if (isProjectFile(file)) return importProjectAndOpen(file);
    const problem = await createFromImageFile(file);
    if (problem) toast.error(problem);
  });
}
