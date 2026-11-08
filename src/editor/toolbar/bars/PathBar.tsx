/** The toolbar while the points of a path are edited (it takes the place of the shape toolbar, as the crop bar does for a picture). */
import { useMemo } from "react";
import { closePath, nodeKindOf } from "@/core/pen";
import { elementPath } from "@/core/penShape";
import type { ShapeElement } from "@/core/types";
import { closeEditedPath, deleteSelectedNodes, setSelectedKind } from "@/editor/canvas/pathEditActions";
import { stopPathEdit, usePathEdit } from "@/editor/canvas/pathEditStore";
import { Divider, IconTrash } from "@/ui";
import { TBText } from "../kit";

export function PathBar({ el }: { el: ShapeElement }) {
  const path = useMemo(() => elementPath(el), [el]);
  const chosen = usePathEdit((s) => s.selected);
  if (!path) return null;
  const selected = chosen.filter((i) => i < path.nodes.length);
  const none = selected.length === 0;
  const caption = none
    ? "Select a point to edit it"
    : selected.length === 1
      ? `Point ${selected[0] + 1} of ${path.nodes.length}, ${nodeKindOf(path, selected[0])}`
      : `${selected.length} points selected`;
  return (
    <>
      <span className="cf-tb__caption" aria-live="polite">
        {caption}
      </span>
      <Divider vertical className="cf-tb__div" />
      <TBText tip="Make the selected points corners" disabled={none} onClick={() => setSelectedKind("corner")}>
        Corner
      </TBText>
      <TBText tip="Make the selected points smooth" disabled={none} onClick={() => setSelectedKind("smooth")}>
        Smooth
      </TBText>
      <TBText icon={<IconTrash />} tip="Delete the selected points" shortcut="Delete" disabled={none} onClick={() => deleteSelectedNodes()}>
        Delete point
      </TBText>
      {!path.closed && closePath(path) !== path && (
        <TBText tip="Join the last point to the first" onClick={() => closeEditedPath()}>
          Close path
        </TBText>
      )}
      <Divider vertical className="cf-tb__div" />
      <TBText variant="primary" tip="Finish editing points" shortcut="Enter" onClick={() => stopPathEdit()}>
        Done
      </TBText>
    </>
  );
}
