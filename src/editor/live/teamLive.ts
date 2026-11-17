/**
 * A design of a team, open live with the team without any link (docs/ACCOUNTS.md, "Team designs live"): "Edit live with your
 * team" asks the account server for the room bound to the design (`POST /api/spaces/:s/designs/:id/live`), and the editor joins it
 * with the member's session in place of a key (connection.ts). The member's role in the team decides: an owner or editor edits,
 * a viewer looks (the read-only mode of a view link). When the server sends the member away (a role lowered, a removal) or the
 * room went away before the join, the room is asked for again, a few times.
 *
 * While the design is open in the editor, sync leaves it alone (the editor holds its lock); the room writes the design back to the
 * space when everybody has left it, so what was done live is not sent again by sync: the copy here is marked as in step when the
 * live editing stops.
 */
import { create } from "zustand";
import type { DeniedReason } from "@/collab/protocol";
import { getSummary } from "@/core/library";
import type { LiveLink } from "@/core/types";
import { useEditor } from "@/core/store";
import { connectLive } from "./connection";

export interface TeamLiveState {
  /** the design the team's room is for */
  designId: string | null;
  link: LiveLink | null;
  /** the session it joins with */
  session: string | null;
  joining: boolean;
  error: string | null;
}

export const useTeamLive = create<TeamLiveState>(() => ({ designId: null, link: null, session: null, joining: false, error: null }));

const MAX_ASKS = 3;
let asks = 0;

/** The team (space) of a design and the member's role in it; null for a design that is not a team's, or nobody signed in. */
export async function teamOf(designId: string): Promise<{ space: string; role: "owner" | "editor" | "viewer" } | null> {
  const { useCloud, roleIn } = await import("@/cloud/state");
  const session = useCloud.getState().session;
  const summary = await getSummary(designId);
  if (!session || !summary?.space || summary.space === session.user.id) return null;
  const role = roleIn(summary.space, session);
  return role ? { space: summary.space, role } : null;
}

/** Asks the server for the design's room and makes it the one the editor joins. Rejects with words for the person. */
export async function startTeamLive(designId: string, again = false): Promise<void> {
  if (!again) asks = 0;
  const [{ useCloud }, api, { m }] = await Promise.all([import("@/cloud/state"), import("@/cloud/api"), import("@/i18n")]);
  const session = useCloud.getState().session;
  const team = await teamOf(designId);
  if (!session || !team) throw new Error(m.cloud.errors.forbidden);
  useTeamLive.setState({ designId, joining: true, error: null });
  try {
    // what was edited here and not sent yet goes to the server first: the room is made from the server's design
    if (!again && team.role !== "viewer") {
      const [{ settleSaves }, sync] = await Promise.all([import("@/settleSaves"), import("@/cloud/sync")]);
      await settleSaves(3000);
      await sync.sendOne(designId);
    }
    const room = await api.openLive({ server: session.server, token: session.token }, team.space, designId);
    useTeamLive.setState({ designId, link: { server: session.server, room: room.room, key: "", role: room.role }, session: session.token, joining: false, error: null });
  } catch (error) {
    const words = error instanceof api.CloudError && error.code === "offline" ? m.cloud.live.offline : api.cloudErrorText(error);
    useTeamLive.setState({ joining: false, error: words, link: null });
    throw new Error(words, { cause: error });
  }
}

/** Stops editing live: the editor leaves the room and the design here is what the room has, which it writes back itself. */
export function stopTeamLive(): void {
  useTeamLive.setState({ designId: null, link: null, session: null, joining: false, error: null });
}

/** Joins the team's room for as long as the returned function has not been called (the editor calls it while the design is open). */
export function connectTeamLive(designId: string, link: LiveLink, session: string): () => void {
  const onDenied = (reason: DeniedReason | null) => {
    // sent away (a role changed, a removal) or the room was gone: ask for the room again, which says what the member may do now
    if (asks >= MAX_ASKS || (reason !== "no-access" && reason !== "not-found")) return;
    asks++;
    setTimeout(() => {
      if (useTeamLive.getState().link !== link) return;
      void startTeamLive(designId, true).catch(() => undefined);
    }, 300);
  };
  const stop = connectLive(link, { session, onDenied });
  return () => {
    stop();
    // what was done live is the room's, which writes it back: the copy here is in step, not something to send again
    void import("@/cloud/sync").then((sync) => sync.markInStep(designId)).catch(() => undefined);
  };
}

/** A viewer of a team opens its designs read-only, as with a view link. */
export async function applyTeamRole(designId: string): Promise<void> {
  const team = await teamOf(designId).catch(() => null);
  if (team?.role === "viewer" && useEditor.getState().design?.id === designId) useEditor.getState().actions.setMode("view");
}
