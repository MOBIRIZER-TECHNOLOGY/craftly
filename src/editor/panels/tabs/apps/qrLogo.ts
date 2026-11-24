import { svgToDataUrl } from "@/core/svg";

export interface QrLogo {
  url: string;
  width: number;
  height: number;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image could not be read"));
    img.src = url;
  });
}

/** A QR and its optional logo as a PNG. A logo never becomes active markup inside a design. */
export async function rasterizeQrWithLogo(svg: string, logo?: QrLogo): Promise<string> {
  if (!logo) return svgToDataUrl(svg);
  const [qr, mark] = await Promise.all([load(svgToDataUrl(svg)), load(logo.url)]);
  const canvas = document.createElement("canvas");
  canvas.width = qr.naturalWidth;
  canvas.height = qr.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas is unavailable");
  ctx.drawImage(qr, 0, 0, canvas.width, canvas.height);

  const side = Math.round(canvas.width * 0.22);
  const scale = Math.min(side / mark.naturalWidth, side / mark.naturalHeight);
  const width = mark.naturalWidth * scale;
  const height = mark.naturalHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 4, y - 4, width + 8, height + 8);
  ctx.drawImage(mark, x, y, width, height);
  return canvas.toDataURL("image/png");
}
