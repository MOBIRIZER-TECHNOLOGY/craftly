/** QR code to SVG for the QR app (pure: no React). */
import qrcode from "qrcode-generator";

// QR payloads are UTF-8, so accents, symbols and emoji scan correctly
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

export type QrLevel = "L" | "M" | "Q" | "H";

/** Empty border around the code, in modules. */
export const QR_QUIET_ZONE = 3;

/**
 * Draws the code as one recolourable path (runs of dark modules per row) on a coloured background. Throws when the
 * text does not fit in a QR code at this error-correction level.
 */
export function qrSvg(text: string, level: QrLevel, fg: string, bg: string): string {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QR_QUIET_ZONE * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${start + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h${c - start}v1h-${c - start}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
