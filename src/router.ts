import { useEffect, useState } from "react";

export interface Route {
  name: "home" | "projects" | "templates" | "brand" | "trash" | "design" | "sandbox" | string;
  id?: string;
}

/** Hash routes: #/ , #/projects[/folderId], #/templates[/categoryId], #/brand, #/trash, #/design/:id */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [first, second] = path.split("/");
  if (!first) return { name: "home" };
  return { name: first, id: second ? decodeURIComponent(second) : undefined };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path}`;
}

export const designPath = (id: string) => `/design/${encodeURIComponent(id)}`;
