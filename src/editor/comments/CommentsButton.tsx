import { useEditor } from "@/core/store";
import { IconButton, IconComment } from "@/ui";
import { openCount, useComments } from "./commentsStore";
import "./comments.css";

/**
 * The Comments button of the top bar: opens and closes the Comments panel, with the number of open comments on it. Its name says
 * the number too ("Comments, 3 open"), so that a screen reader hears what the badge shows.
 */
export function CommentsButton() {
  const count = useEditor((s) => openCount(s.design));
  const open = useComments((s) => s.panelOpen);
  return (
    <IconButton
      label={count ? `Comments, ${count} open` : "Comments"}
      className="cf-comments-button"
      active={open}
      data-cf-comments-button=""
      icon={
        <>
          <IconComment aria-hidden="true" />
          {count ? (
            <span className="cf-comments-button__badge" aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </>
      }
      onClick={() => useComments.setState(open ? { panelOpen: false, highlight: null } : { panelOpen: true })}
    />
  );
}
