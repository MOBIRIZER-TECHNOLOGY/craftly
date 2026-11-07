/**
 * The dashboard: app shell (rail / tab bar) plus the page for the hash route -
 * `#/` Home, `#/projects[/folderId]`, `#/templates[/categoryId]`, `#/brand`, `#/trash` - and the dialogs they share
 * (Create, template preview, name prompt).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useRoute } from "@/router";
import { BrandPage } from "./BrandPage";
import { CreateDialog } from "./CreateDialog";
import { closeCreateDialog, consumeOpenCreateRequest } from "./createDialogState";
import { useDesigns } from "./data";
import { Home } from "./Home";
import { PromptHost } from "./prompt";
import { ProjectsPage } from "./ProjectsPage";
import { Shell } from "./Shell";
import { StorageNotice } from "./StorageNotice";
import { TemplatePreviewHost } from "./TemplatePreviewModal";
import { closeTemplatePreview } from "./templatePreview";
import { TemplatesPage } from "./TemplatesPage";
import { TrashPage } from "./TrashPage";

const TITLES: Record<string, string> = {
  projects: "Projects - Craftly",
  templates: "Templates - Craftly",
  brand: "Brand kit - Craftly",
  trash: "Trash - Craftly",
};
const HOME_TITLE = "Craftly - Design anything";

export function Dashboard() {
  const route = useRoute();
  const { error } = useDesigns();

  // tab title follows the page, and the original title returns when the dashboard goes away (the editor sets its own)
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title = TITLES[route.name] ?? HOME_TITLE;
  }, [route.name]);

  // another screen (the editor's "Create new design") may ask for the Create dialog on arrival
  useEffect(() => {
    consumeOpenCreateRequest();
  }, []);

  // dialogs belong to the page that opened them
  const routeKey = `${route.name}/${route.id ?? ""}`;
  const lastRoute = useRef(routeKey);
  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    closeCreateDialog();
    closeTemplatePreview();
  }, [routeKey]);

  let page: ReactNode;
  switch (route.name) {
    case "projects":
      page = <ProjectsPage folderId={route.id} />;
      break;
    case "templates":
      page = <TemplatesPage category={route.id} />;
      break;
    case "brand":
      page = <BrandPage />;
      break;
    case "trash":
      page = <TrashPage />;
      break;
    default:
      page = <Home />;
  }

  return (
    <>
      <Shell route={route}>
        {error ? <StorageNotice detail={error} /> : null}
        {page}
      </Shell>
      <CreateDialog />
      <TemplatePreviewHost />
      <PromptHost />
    </>
  );
}
