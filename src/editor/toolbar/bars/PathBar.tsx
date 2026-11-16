/** The toolbar while the points of a path are edited (it takes the place of the shape toolbar, as the crop bar does for a picture). */
import { useMemo } from "react";
import { closePath, nodeKindOf } from "@/core/pen";
import { elementPath } from "@/core/penShape";
import type { ShapeElement } from "@/core/types";
import { closeEditedPath, deleteSelectedNodes, setSelectedKind } from "@/editor/canvas/pathEditActions";
import { stopPathEdit, usePathEdit } from "@/editor/canvas/pathEditStore";
import { m } from "@/i18n";
import { Divider, IconTrash } from "@/ui";
import { TBText } from "../kit";

export function PathBar({ el }: { el: ShapeElement }) {
  const path = useMemo(() => elementPath(el), [el]);
  const chosen = usePathEdit((s) => s.selected);
  if (!path) return null;
  const selected = chosen.filter((i) => i < path.nodes.length);
  const none = selected.length === 0;
  const caption = none
    ? m.editor.pathBar.selectPoint
    : selected.length === 1
      ? m.editor.pathBar.point(selected[0] + 1, path.nodes.length, nodeKindOf(path, selected[0]))
      : m.editor.pathBar.pointsSelected(selected.length);
  return (
    <>
      <span className="cf-tb__caption" aria-live="polite">
        {caption}
      </span>
      <Divider vertical className="cf-tb__div" />
      <TBText tip={m.editor.pathBar.cornerTip} disabled={none} onClick={() => setSelectedKind("corner")}>
        {m.editor.pathBar.corner}
      </TBText>
      <TBText tip={m.editor.pathBar.smoothTip} disabled={none} onClick={() => setSelectedKind("smooth")}>
        {m.editor.pathBar.smooth}
      </TBText>
      <TBText icon={<IconTrash />} tip={m.editor.pathBar.deletePointTip} shortcut="Delete" disabled={none} onClick={() => deleteSelectedNodes()}>
        {m.editor.pathBar.deletePoint}
      </TBText>
      {!path.closed && closePath(path) !== path && (
        <TBText tip={m.editor.pathBar.closePathTip} onClick={() => closeEditedPath()}>
          {m.editor.pathBar.closePath}
        </TBText>
      )}
      <Divider vertical className="cf-tb__div" />
      <TBText variant="primary" tip={m.editor.pathBar.finishTip} shortcut="Enter" onClick={() => stopPathEdit()}>
        {m.common.done}
      </TBText>
    </>
  );
}
