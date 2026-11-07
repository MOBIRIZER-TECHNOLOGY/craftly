import type { ReactNode } from "react";
import { PanelHeader } from "../../shared/PanelHeader";
import { PanelSearch } from "../../shared/PanelSearch";
import { PanelTop } from "../../shared/PanelLayout";
import { useElementsNav } from "./nav";

/** Fixed top area of every Elements sub-page: back arrow + title, its own search field, optional extras (tabs, chips). */
export function SubPageTop({ title, placeholder, children, subtitle }: { title: string; placeholder: string; subtitle?: ReactNode; children?: ReactNode }) {
  const query = useElementsNav((s) => s.query);
  const setQuery = useElementsNav((s) => s.setQuery);
  const back = useElementsNav((s) => s.back);
  return (
    <PanelTop>
      <PanelHeader title={title} subtitle={subtitle} onBack={back} backLabel="Back to all elements" />
      <PanelSearch value={query} onChange={setQuery} placeholder={placeholder} />
      {children}
    </PanelTop>
  );
}
