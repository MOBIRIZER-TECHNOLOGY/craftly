/** Small browser-side encoders shared by the SVG exporter and the project file. */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read an image."));
    reader.readAsDataURL(blob);
  });
}

/** Base64 of raw bytes without building one giant argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(binary);
}
