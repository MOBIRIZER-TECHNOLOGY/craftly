/**
 * Portable `.craftly` project files: the design JSON with every uploaded image embedded, so a design can be
 * moved between browsers or shared without a server. The JSON shape, validation and id rewriting live in
 * `projectFormat.ts` (pure, unit tested); this file adds IndexedDB access for the uploaded images. The uploaded fonts
 * a design uses travel in the same file (`projectFonts.ts`).
 */
import { getAsset, prepareAssetFromFile } from "@/core/assets";
import { uid } from "@/core/ids";
import { saveDesign } from "@/core/library";
import type { Asset, Design } from "@/core/types";
import { ExportError } from "./errors";
import { blobToDataUrl } from "./encoding";
import { collectProjectFonts, readProjectFonts, storeProjectFonts } from "./projectFonts";
import {
  buildProjectFile,
  collectAssetIds,
  dataUrlToBytes,
  extensionForMime,
  mimeOfDataUrl,
  parseProjectFile,
  prepareImportedDesign,
  remapAssetSources,
  serializeProjectFile,
  type ProjectAsset,
  ProjectFileError,
  type ImportReport,
} from "./projectFormat";

export { PROJECT_FILE_EXTENSION, projectFileName, ProjectFileError, NOT_A_PROJECT_MESSAGE } from "./projectFormat";

/** A portable .craftly file: design JSON with its uploaded images, and the uploaded fonts it uses, embedded as data URLs. */
export async function exportProjectFile(design: Design): Promise<Blob> {
  const assets: Record<string, ProjectAsset> = {};
  for (const id of collectAssetIds(design)) {
    const asset = await getAsset(id);
    if (!asset) throw new ExportError("invalid-design", "An uploaded image is missing. Replace the missing image before saving a project file.");
    assets[id] = {
      name: asset.name,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      dataUrl: await blobToDataUrl(asset.blob),
    };
  }
  const file = buildProjectFile(design, assets);
  const fonts = await collectProjectFonts(design);
  // the list of fonts is only there when the design uses an uploaded font: every other file is as it always was
  const text = fonts.length ? JSON.stringify({ ...file, fonts }) : serializeProjectFile(file);
  return new Blob([text], { type: "application/json" });
}

/**
 * Reads a .craftly file, stores its images as new assets, saves the design under a new id and returns it. The uploaded
 * fonts the file carries are stored too, each checked as an upload is; one that is refused is left out and the design
 * says which font is missing.
 * Throws `ProjectFileError` ("That does not look like a Craftly project file") for anything else, and for images of the file
 * that cannot be read; any other error is a failure to store the design. `report`, when given, is told what was left out.
 */
export async function importProjectFile(file: File, report?: ImportReport): Promise<Design> {
  const text = await file.text();
  const project = parseProjectFile(text, report);

  const idMap: Record<string, string> = Object.create(null);
  const uploads: Asset[] = [];
  const failed: string[] = [];
  for (const oldId of collectAssetIds(project.design)) {
    const asset = Object.hasOwn(project.assets, oldId) ? project.assets[oldId] : undefined;
    const decoded = asset && dataUrlToBytes(asset.dataUrl);
    if (!asset || !decoded) {
      failed.push(asset?.name ?? "an image missing from the file");
      continue;
    }
    const mime = mimeOfDataUrl(asset.dataUrl) || asset.mime;
    const upload = new File([decoded.bytes as BlobPart], `${asset.name}.${extensionForMime(mime)}`, { type: mime });
    try {
      const prepared = await prepareAssetFromFile(upload);
      uploads.push(prepared);
      idMap[oldId] = prepared.id;
    } catch {
      failed.push(asset.name);
    }
  }
  if (failed.length) {
    const examples = failed
      .slice(0, 3)
      .map((name) => `“${name}”`)
      .join(", ");
    throw new ProjectFileError(`Could not read ${failed.length} embedded image(s): ${examples}. Export a complete project file from the source design and try again.`);
  }

  const design = prepareImportedDesign(remapAssetSources(project.design, idMap), uid("d"));
  await saveDesign(design, undefined, undefined, uploads);
  // after the design: a file that is refused for its pictures leaves no font behind either
  await storeProjectFonts(readProjectFonts(text));
  return design;
}
