/** Small contextual toolbars: group, table / chart, mixed selection, locked selection and the page itself. */
import { getActions } from "@/core/store";
import type { ChartElement, DesignElement, Fill, GroupElement, ID, TableElement } from "@/core/types";
import { m } from "@/i18n";
import { Divider, IconChart, IconTable, IconUngroup, IconUnlock } from "@/ui";
import { AnimateButton, MoreButton, MultiActions, PositionButton, Swatch, TransparencyButton, type BarProps } from "../common";
import { TBText, toggleContext, useContextActive } from "../kit";
import { fillCss } from "../selection";

export function GroupBar({ els, ids }: BarProps<GroupElement>) {
  return (
    <>
      <TBText icon={<IconUngroup />} tip={m.editor.miscBars.ungroupTip} shortcut="Ctrl+Shift+G" onClick={() => getActions().ungroupSelection()}>
        {m.editor.actions.ungroup}
      </TBText>
      <Divider vertical className="cf-tb__div" />
      <TransparencyButton els={els} ids={ids} />
      <AnimateButton />
      <PositionButton />
      <MoreButton />
    </>
  );
}

/** Tables and charts: the data editor is a context panel. */
export function DataBar({ els, ids }: BarProps<TableElement | ChartElement>) {
  const open = useContextActive({ kind: "data" });
  const chart = els[0]?.type === "chart";
  return (
    <>
      <TBText
        icon={chart ? <IconChart /> : <IconTable />}
        tip={chart ? m.editor.miscBars.editChartTip : m.editor.miscBars.editTableTip}
        active={open}
        onClick={() => toggleContext({ kind: "data" })}
      >
        {m.editor.miscBars.editData}
      </TBText>
      <Divider vertical className="cf-tb__div" />
      <TransparencyButton els={els} ids={ids} />
      <AnimateButton />
      <PositionButton />
      <MoreButton />
    </>
  );
}

/** Several elements of different kinds. */
export function MultiBar({ els, ids }: BarProps<DesignElement>) {
  return (
    <>
      <MultiActions ids={ids} />
      <Divider vertical className="cf-tb__div" />
      <TransparencyButton els={els} ids={ids} />
      <AnimateButton />
      <PositionButton />
      <MoreButton />
    </>
  );
}

/** Only unlocking is possible while the selection is locked. */
export function LockedBar({ ids }: { ids: ID[] }) {
  return (
    <>
      <TBText icon={<IconUnlock />} tip={m.editor.miscBars.unlockTip} shortcut="Alt+Shift+L" onClick={() => getActions().setLocked(ids, false)}>
        {m.editor.actions.unlock}
      </TBText>
      <Divider vertical className="cf-tb__div" />
      <MoreButton />
    </>
  );
}

/** Nothing selected: page level controls. */
export function PageBar({ background }: { background: Fill }) {
  const open = useContextActive({ kind: "background" });
  return (
    <>
      <TBText
        icon={<Swatch large css={fillCss(background)} />}
        label={m.editor.miscBars.backgroundColor}
        tip={m.editor.miscBars.pageBackground}
        active={open}
        onClick={() => toggleContext({ kind: "background" })}
      >
        {m.editor.miscBars.background}
      </TBText>
      <AnimateButton tab="page" />
    </>
  );
}
