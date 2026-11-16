/**
 * The page that a link to a shared design opens (#/join/…): it connects once to fetch the design, keeps a copy in this person's
 * library that carries the link, and goes on to the editor, which connects again and keeps the copy in step. Opening the same link
 * again opens the same copy. A link that does not work says why.
 *
 * A link names its server, and anybody can make a link. Before it connects to a server that is new on this device the page asks
 * (knownServers.ts says which servers are known and why it matters).
 */
import { useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { designPath } from "@/router";
import "../editor.css";
import { Button, EmptyState, IconHome, IconUsers, IconWarning, Spinner } from "@/ui";
import { joinDesign } from "./connection";
import { findShared, saveJoined } from "./joined";
import { isKnownServer, rememberServer, serverName } from "./knownServers";
import { parseJoinToken } from "./links";
import { NameField } from "./LivePeople";

/** Opens a design of the library, in place of this page so that Back does not come back to it. */
const open = (id: string) => window.location.replace(`#${designPath(id)}`);
const home = () => (window.location.hash = "#/");

export function JoinPage({ token, onOpen = open }: { token: string; onOpen?: (designId: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  /** the server of the link, while the person is asked whether to connect to it */
  const [asking, setAsking] = useState<string | null>(null);
  /** the link that the person has said yes for: a yes is for one link and not for the next one that is opened in this tab */
  const [agreed, setAgreed] = useState<string | null>(null);
  const yes = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Another link in the same tab only changes the token, and the page stays: what was said about the link before is not about this one.
    setProblem(null);
    setAsking(null);
    const link = parseJoinToken(token);
    if (!link) {
      setProblem(m.editor.live.join.notCraftly);
      return;
    }
    void (async () => {
      try {
        // a design that was joined before is opened from the library: nothing is asked of any server here
        const known = await findShared(link);
        if (known) return void (!cancelled && onOpen(known));
        if (agreed !== token && !isKnownServer(link.server)) return void (!cancelled && setAsking(link.server));
        const { design, role } = await joinDesign(link);
        if (cancelled) return;
        const id = await saveJoined(design, { ...link, role });
        if (!cancelled) onOpen(id);
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : m.editor.live.join.openFailed);
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
    setAgreed(token);
  };

  return (
    <div className="cf-editor-state">
      {problem ? (
        <EmptyState
          icon={<IconWarning />}
          title={m.editor.live.join.problemTitle}
          text={problem}
          action={
            <Button variant="primary" icon={<IconHome aria-hidden="true" />} onClick={home}>
              {m.editor.shell.backHome}
            </Button>
          }
        />
      ) : asking ? (
        <EmptyState
          icon={<IconUsers />}
          title={m.editor.live.join.askTitle}
          text={m.editor.live.join.askText(serverName(asking))}
          action={
            // the name the others will see is asked for here, once; it has a default, and can be changed later in the Share panel
            <div className="cf-live-join">
              <NameField />
              <div className="cf-editor-state__actions">
                <Button ref={yes} variant="secondary" icon={<IconHome aria-hidden="true" />} onClick={home}>
                  {m.editor.shell.backHome}
                </Button>
                <Button variant="primary" onClick={join}>
                  {m.editor.live.join.join}
                </Button>
              </div>
            </div>
          }
        />
      ) : (
        <Spinner size={32} label={m.editor.live.join.joining} />
      )}
    </div>
  );
}
