/**
 * Which addresses of pictures Craftly loads. A picture of a design is an upload ("asset:"), a stock picture ("builtin:") or the
 * picture itself ("data:", "blob:"); nothing in the editor makes one that points to the web. A design that comes from outside
 * (a project file, a backup, the clipboard, the server of a shared design) could carry one, and opening it would then ask a
 * server of somebody's choosing for the picture: that tells them who opened the design, from where and when. Such addresses are
 * taken out where a design comes in, and the loader does not fetch one that got through.
 */
import type { DesignElement, Fill, Page } from "./types";

/** Is this the address of a picture somewhere else: http:, https:, or "//host/..." which means the same? */
export function isRemoteImage(src: unknown): boolean {
  return typeof src === "string" && /^\s*(https?:)?\/\//i.test(src);
}

/** What stands in for a fill or a background whose picture was on the web. */
const PLAIN: Fill = { type: "solid", color: "#e5e7eb" };

const remoteFill = (fill: unknown): boolean =>
  typeof fill === "object" && fill !== null && (fill as { type?: unknown }).type === "image" && isRemoteImage((fill as { src?: unknown }).src);

/**
 * The element without pictures from the web: a photo becomes an empty frame, a fill becomes a plain grey, and the elements of a
 * group are gone through as well. Returns the element itself when it had none, and adds what it took out to `count`.
 */
export function withoutRemoteImages<T extends DesignElement>(el: T, count: { remote: number } = { remote: 0 }): T {
  let out: T = el;
  const change = (patch: Partial<DesignElement>) => {
    out = { ...out, ...patch } as T;
    count.remote++;
  };
  if (el.type === "image") {
    if (isRemoteImage(el.src)) change({ src: null } as Partial<DesignElement>);
    if (isRemoteImage((el as { originalSrc?: unknown }).originalSrc)) {
      const { originalSrc: _dropped, ...rest } = out as T & { originalSrc?: string };
      out = rest as unknown as T;
    }
  }
  if (remoteFill((el as { fill?: unknown }).fill)) change({ fill: PLAIN } as Partial<DesignElement>);
  if (el.type === "group") {
    const children = el.children.map((child) => withoutRemoteImages(child, count));
    if (children.some((child, i) => child !== el.children[i])) out = { ...out, children } as T;
  }
  return out;
}

/** The background of a page without a picture from the web (plain white in its place). */
export function backgroundWithoutRemoteImage(background: Page["background"], count: { remote: number } = { remote: 0 }): Page["background"] {
  if (!remoteFill(background)) return background;
  count.remote++;
  return { type: "solid", color: "#ffffff" };
}
