/** Choosing a picture file and swapping it into an image element / frame (toolbar "Replace" and the context menu). */
import { addAssetFromFile, assetSrc, isAcceptedImage } from "@/core/assets";
import { getActions } from "@/core/store";
import type { ID } from "@/core/types";
import { toast } from "@/ui";

/** Stores the file as an asset and puts it into the image element, keeping its box. */
export async function replaceImageWithFile(id: ID, file: File): Promise<boolean> {
  if (!isAcceptedImage(file)) {
    toast.error("That file is not a picture. Choose a PNG, JPG, WebP, GIF or SVG file.");
    return false;
  }
  try {
    const asset = await addAssetFromFile(file);
    getActions().replaceImage(id, assetSrc(asset.id), asset.width, asset.height);
    return true;
  } catch {
    toast.error("Could not read that picture. Try a different file.");
    return false;
  }
}

/** Kept referenced while the system dialog is open so the detached input is not collected early. */
const pending = new Set<HTMLInputElement>();

/** Opens the system file picker (must run inside a click handler) and replaces the image with the choice. */
export function pickImageFor(id: ID): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    pending.delete(input);
    if (file) void replaceImageWithFile(id, file);
  });
  input.addEventListener("cancel", () => pending.delete(input));
  pending.add(input);
  input.click();
}
