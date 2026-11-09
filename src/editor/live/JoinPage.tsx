/**
 * The page that a link to a shared design opens (#/join/…): it connects once to fetch the design, keeps a copy in this person's
 * library that carries the link, and goes on to the editor, which connects again and keeps the copy in step. Opening the same link
 * again opens the same copy. A link that does not work says why.
 */
import { useEffect, useState } from "react";
import { designPath } from "@/router";
import "../editor.css";
import { Button, EmptyState, IconHome, IconWarning, Spinner } from "@/ui";
import { joinDesign } from "./connection";
import { findShared, saveJoined } from "./joined";
import { parseJoinToken } from "./links";

/** Opens a design of the library, in place of this page so that Back does not come back to it. */
const open = (id: string) => window.location.replace(`#${designPath(id)}`);

export function JoinPage({ token, onOpen = open }: { token: string; onOpen?: (designId: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const link = parseJoinToken(token);
    if (!link) {
      setProblem("This is not a link that Craftly made. Ask the person who shared the design for a new one.");
      return;
    }
    void (async () => {
      try {
        const known = await findShared(link);
        if (known) return void (!cancelled && onOpen(known));
        const { design, role } = await joinDesign(link);
        if (cancelled) return;
        const id = await saveJoined(design, { ...link, role });
        if (!cancelled) onOpen(id);
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "The shared design could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, onOpen]);

  return (
    <div className="cf-editor-state">
      {problem ? (
        <EmptyState
          icon={<IconWarning />}
          title="This shared design could not be opened"
          text={problem}
          action={
            <Button variant="primary" icon={<IconHome aria-hidden="true" />} onClick={() => (window.location.hash = "#/")}>
              Back to home
            </Button>
          }
        />
      ) : (
        <Spinner size={32} label="Joining the shared design" />
      )}
    </div>
  );
}
