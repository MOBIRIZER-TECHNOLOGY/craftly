/**
 * Portable `.craftly` project files: the design JSON with every uploaded image embedded, so a design can be
 * moved between browsers or shared without a server. The JSON shape, validation and id rewriting live in
 * `projectFormat.ts` (pure, unit tested); this file adds IndexedDB access for the uploaded images.
 */
import { getAsset, prepareAssetFromFile } from "@/core/assets";
import { uid } from "@/core/ids";
import { saveDesign } from "@/core/library";
import type { Asset, Design } from "@/core/types";
import { ExportError } from "./errors";
import { blobToDataUrl } from "./encoding";
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
} from "./projectFormat";

export { PROJECT_FILE_EXTENSION, projectFileName, ProjectFileError, NOT_A_PROJECT_MESSAGE } from "./projectFormat";

/** A portable .craftly file: design JSON with its uploaded images embedded as data URLs. */
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
  return new Blob([serializeProjectFile(file)], { type: "application/json" });
}

/**
 * Reads a .craftly file, stores its images as new assets, saves the design under a new id and returns it.
 * Throws `ProjectFileError` ("That does not look like a Craftly project file") for anything else.
 */
export async function importProjectFile(file: File): Promise<Design> {
  const project = parseProjectFile(await file.text());

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
    throw new Error(`Could not read ${failed.length} embedded image(s): ${examples}. Export a complete project file from the source design and try again.`);
  }

  const design = prepareImportedDesign(remapAssetSources(project.design, idMap), uid("d"));
  await saveDesign(design, undefined, undefined, uploads);
  return design;
}
