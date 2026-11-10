import { useEffect, useState } from "react";
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
    let canLeave = false;
    let pending = 0;
    const on = async () => {
      const next = window.location.hash;
      const request = ++pending;
      if (next === current) return;
      if (!canLeave && current.startsWith("#/design/") && (await settleSaves(6000, true)) !== "saved") {
        if (request !== pending) return;
        window.history.replaceState(null, "", current);
        const { confirm } = await import("@/ui");
        const discard = await confirm({
          title: "Leave with unsaved changes?",
          message: "Stay to retry saving or download a project file. Leaving will discard the unsaved changes in this tab.",
          confirmLabel: "Leave editor",
          cancelLabel: "Stay in editor",
          danger: true,
        });
        if (request !== pending || !discard) return;
        canLeave = true;
        window.location.hash = next;
        return;
      }
      if (request !== pending) return;
      canLeave = false;
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
