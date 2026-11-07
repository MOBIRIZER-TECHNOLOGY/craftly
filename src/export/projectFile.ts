/**
 * Portable `.craftly` project files: the design JSON with every uploaded image embedded, so a design can be
 * moved between browsers or shared without a server. The JSON shape, validation and id rewriting live in
 * `projectFormat.ts` (pure, unit tested); this file adds IndexedDB access for the uploaded images.
 */
import { addAssetFromFile, getAsset } from "@/core/assets";
import { uid } from "@/core/ids";
import { saveDesign } from "@/core/library";
import type { Design } from "@/core/types";
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
    if (!asset) continue; // deleted from the library: the design keeps showing its placeholder
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

  const idMap: Record<string, string> = {};
  for (const [oldId, asset] of Object.entries(project.assets)) {
    const decoded = dataUrlToBytes(asset.dataUrl);
    if (!decoded) continue;
    const mime = mimeOfDataUrl(asset.dataUrl) || asset.mime; // (`decoded.mime` defaults to text/plain, which would hide the recorded type)
    const upload = new File([decoded.bytes as BlobPart], `${asset.name}.${extensionForMime(mime)}`, { type: mime });
    try {
      idMap[oldId] = (await addAssetFromFile(upload)).id;
    } catch (error) {
      console.warn(`Could not import the image "${asset.name}".`, error);
    }
  }

  const design = prepareImportedDesign(remapAssetSources(project.design, idMap), uid("d"));
  await saveDesign(design);
  return design;
}
