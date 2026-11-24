import { useMemo } from "react";
import { checkAccessibility, type AccessIssue } from "@/core/accessCheck";
import { useEditor } from "@/core/store";
import { openAltTextDialog } from "@/editor/toolbar/altText";
import { m } from "@/i18n";
import { Button, Modal } from "@/ui";
import "./accessDialog.css";

const words = m.editorChrome.access;

/** What an issue says, in a sentence. */
const sentence = (issue: AccessIssue): string => (issue.kind === "contrast" ? words.contrast(issue.label, String(issue.ratio), String(issue.needed)) : words.alt(issue.label));

/**
 * File > Check accessibility: what `checkAccessibility` (src/core/accessCheck.ts) finds in the open design, page by page. Show
 * goes to the page and selects the element (the group, for an element inside one); a picture can be given its alternative
 * text from here. The dialog says what the check does not look at, so that an empty list is not read as a promise.
 */
export function AccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const design = useEditor((s) => s.design);
  // only while the dialog is shown: the check reads every element of every page
  const issues = useMemo(() => (open && design ? checkAccessibility(design) : []), [open, design]);
  const pages = useMemo(() => {
    const byPage = new Map<number, AccessIssue[]>();
    for (const issue of issues) byPage.set(issue.pageIndex, [...(byPage.get(issue.pageIndex) ?? []), issue]);
    return [...byPage].sort((a, b) => a[0] - b[0]);
  }, [issues]);

  const show = (issue: AccessIssue) => {
    const actions = useEditor.getState().actions;
    actions.setActivePage(issue.pageId);
    actions.select([issue.topId]);
    onClose();
  };
  const describe = (issue: AccessIssue) => {
    show(issue);
    openAltTextDialog(issue.elementId);
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title={words.title} bodyClassName="cf-access">
      <p className="cf-access__intro">{words.intro}</p>
      <p className="cf-access__count" role="status">
        {issues.length ? words.found(issues.length) : words.none}
      </p>
      {pages.map(([pageIndex, list]) => (
        <section key={pageIndex} className="cf-access__page" aria-label={words.page(pageIndex + 1)}>
          <h3 className="cf-access__title">{words.page(pageIndex + 1)}</h3>
          <ul className="cf-access__list">
            {list.map((issue) => {
              const text = sentence(issue);
              return (
                <li key={`${issue.kind}-${issue.elementId}`} className="cf-access__row">
                  {issue.kind === "contrast" ? (
                    <span className="cf-access__sample" aria-hidden="true" style={{ background: issue.background, color: issue.color }}>
                      Aa
                    </span>
                  ) : null}
                  <span className="cf-access__text">{text}</span>
                  <span className="cf-access__actions">
                    {issue.kind === "alt" ? (
                      <Button size="sm" variant="secondary" aria-label={words.addTextFor(text)} onClick={() => describe(issue)}>
                        {words.addText}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" aria-label={words.showFor(text)} onClick={() => show(issue)}>
                      {words.show}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="cf-access__limits">{words.limits}</p>
    </Modal>
  );
}
