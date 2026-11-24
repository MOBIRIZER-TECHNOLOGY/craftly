import { useEffect, useState } from "react";
import { m } from "@/i18n";
import { settleSaves } from "./settleSaves";

export interface Route {
  name: "home" | "projects" | "templates" | "brand" | "trash" | "design" | "sandbox" | string;
  id?: string;
}

/** Hash routes: #/ , #/projects[/folderId], #/templates[/categoryId], #/brand, #/trash, #/design/:id */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [first, second] = path.split("/");
  if (!first) return { name: "home" };
  try {
    return { name: first, id: second ? decodeURIComponent(second) : undefined };
  } catch {
    return { name: "home" };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    let current = window.location.hash;
    let pending = 0;
    const on = async () => {
      const next = window.location.hash;
      const request = ++pending;
      if (next === current) return;
      if (current.startsWith("#/design/") && (await settleSaves(6000, true)) !== "saved") {
        if (request !== pending) return;
        // the address bar shows the design again while the person is asked; the entry the browser went to (a new one for a link,
        // the one before for Back) keeps its place in the history
        window.history.replaceState(null, "", current);
        const { confirm } = await import("@/ui");
        const discard = await confirm({
          title: m.app.leaveEditor.title,
          message: m.app.leaveEditor.message,
          confirmLabel: m.app.leaveEditor.leave,
          cancelLabel: m.app.leaveEditor.stay,
          danger: true,
        });
        if (request !== pending || !discard) return;
        // that entry gets its own address back, in place: setting the hash would push a new entry after it, so that Back from
        // there would open the design again, and Forward from before it would be lost
        window.history.replaceState(null, "", next);
      }
      if (request !== pending) return;
      current = next;
      setRoute(parseRoute(next));
    };
    window.addEventListener("hashchange", on);
    return () => {
      pending++;
      window.removeEventListener("hashchange", on);
    };
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

export const designPath = (id: string) => `/design/${encodeURIComponent(id)}`;
