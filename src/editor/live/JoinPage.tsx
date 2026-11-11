/**
 * The page that a link to a shared design opens (#/join/…): it connects once to fetch the design, keeps a copy in this person's
 * library that carries the link, and goes on to the editor, which connects again and keeps the copy in step. Opening the same link
 * again opens the same copy. A link that does not work says why.
 *
 * A link names its server, and anybody can make a link. Before it connects to a server that is new on this device the page asks
 * (knownServers.ts says which servers are known and why it matters).
 */
import { useEffect, useRef, useState } from "react";
import { designPath } from "@/router";
import "../editor.css";
import { Button, EmptyState, IconHome, IconUsers, IconWarning, Spinner } from "@/ui";
import { joinDesign } from "./connection";
import { findShared, saveJoined } from "./joined";
import { isKnownServer, rememberServer, serverName } from "./knownServers";
import { parseJoinToken } from "./links";

/** Opens a design of the library, in place of this page so that Back does not come back to it. */
const open = (id: string) => window.location.replace(`#${designPath(id)}`);
const home = () => (window.location.hash = "#/");

export function JoinPage({ token, onOpen = open }: { token: string; onOpen?: (designId: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  /** the server of the link, while the person is asked whether to connect to it */
  const [asking, setAsking] = useState<string | null>(null);
  /** set once the person has said yes for the link that is open */
  const [agreed, setAgreed] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const link = parseJoinToken(token);
    if (!link) {
      setProblem("This is not a link that Craftly made. Ask the person who shared the design for a new one.");
      return;
    }
    void (async () => {
      try {
        // a design that was joined before is opened from the library: nothing is asked of any server here
        const known = await findShared(link);
        if (known) return void (!cancelled && onOpen(known));
        if (!agreed && !isKnownServer(link.server)) return void (!cancelled && setAsking(link.server));
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
  }, [token, onOpen, agreed]);

  // the question starts on its answer that changes nothing
  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);

  const join = () => {
    if (!asking) return;
    rememberServer(asking);
    setAsking(null);
    setAgreed(true);
  };

  return (
    <div className="cf-editor-state">
      {problem ? (
        <EmptyState
          icon={<IconWarning />}
          title="This shared design could not be opened"
          text={problem}
          action={
            <Button variant="primary" icon={<IconHome aria-hidden="true" />} onClick={home}>
              Back to home
            </Button>
          }
        />
      ) : asking ? (
        <EmptyState
          icon={<IconUsers />}
          title="Join this shared design?"
          text={`This link connects to ${serverName(asking)}, a server this device has not used before. That server will see your network address, and the design it sends is saved in your library. Join only if you trust whoever gave you the link.`}
          action={
            <div className="cf-editor-state__actions">
              <Button ref={yes} variant="secondary" icon={<IconHome aria-hidden="true" />} onClick={home}>
                Back to home
              </Button>
              <Button variant="primary" onClick={join}>
                Join
              </Button>
            </div>
          }
        />
      ) : (
        <Spinner size={32} label="Joining the shared design" />
      )}
    </div>
  );
}
