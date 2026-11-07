/**
 * Putting template pages on the open design: confirmation when content would be replaced, then the store action.
 * Sizing a page for the design lives in `fitTemplate.ts`.
 */
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { Page, Template } from "@/core/types";
import { confirm } from "@/ui";
import { fitTemplatePage } from "./fitTemplate";

export { fitTemplatePage } from "./fitTemplate";

const pageHasContent = (): boolean => {
  const page = getActivePage(useEditor.getState());
  return !!page && page.elements.length > 0;
};

/**
 * Applies one template page to the current page ("replace", after asking when the page has content) or adds it as a
 * new page. Resolves to true when something was applied.
 */
export async function applyTemplatePage(template: Template, page: Page, mode: "replace" | "add"): Promise<boolean> {
  const s = useEditor.getState();
  if (!s.design) return false;
  if (mode === "replace" && pageHasContent()) {
    const ok = await confirm({
      title: "Replace this page?",
      message: "The content on this page will be swapped for the template. You can undo this with Ctrl+Z.",
      confirmLabel: "Replace",
    });
    if (!ok) return false;
  }
  getActions().applyTemplatePage(fitTemplatePage(template, page, s.design), mode);
  return true;
}

/** Replaces the current page with page 1 and adds the remaining pages after it. */
export async function applyAllTemplatePages(template: Template): Promise<boolean> {
  const s = useEditor.getState();
  const design = s.design;
  if (!design || !template.pages.length) return false;
  if (pageHasContent()) {
    const extra = template.pages.length - 1;
    const ok = await confirm({
      title: "Replace this page?",
      message:
        extra > 0
          ? `The first template page replaces the content of this page, and ${extra} more page${extra === 1 ? " is" : "s are"} added after it. You can undo this with Ctrl+Z.`
          : "The content on this page will be swapped for the template. You can undo this with Ctrl+Z.",
      confirmLabel: "Apply all",
    });
    if (!ok) return false;
  }
  const actions = getActions();
  const pages = template.pages.map((p) => fitTemplatePage(template, p, design));
  actions.applyTemplatePage(pages[0], "replace");
  const firstId = useEditor.getState().activePageId;
  for (let i = 1; i < pages.length; i++) actions.applyTemplatePage(pages[i], "add");
  actions.setActivePage(firstId);
  return true;
}
