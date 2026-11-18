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
import type { Design, LiveLink } from "@/core/types";
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
  /**
   * Why a viewer sees the space's copy, read-only, and not the room: nobody who may edit has the design open live (`not-live`, also
   * when the last editor left and the room closed). Not a problem: there is nothing live to see.
   */
  notice: string | null;
  /**
   * The one line that says what became of edits made here that the team's room did not have when "Edit live" was pressed: kept as a
   * copy, "Title (edited on Device)", and the room's version is the one edited live.
   */
  kept: string | null;
}

const NONE = { link: null, session: null, joining: false, error: null, notice: null, kept: null };

export const useTeamLive = create<TeamLiveState>(() => ({ designId: null, ...NONE }));

const MAX_ASKS = 3;
let asks = 0;

/** "Edit live" refused because what was edited here has not reached the server. */
class Unsent extends Error {}

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
  useTeamLive.setState({ designId, joining: true, error: null, notice: null, ...(again ? {} : { kept: null }) });
  try {
    // what was edited here and not sent yet goes to the server first: the room is made from the server's design, so the room is not
    // joined over edits that did not get there (a conflict, a full space, a save that did not finish): they would be lost
    if (!again && team.role !== "viewer") {
      const [{ settleSaves }, sync] = await Promise.all([import("@/settleSaves"), import("@/cloud/sync")]);
      const saved = await settleSaves(3000);
      if (saved !== "saved") throw new Unsent(m.cloud.live.unsent);
      const sent = await sync.sendOne(designId);
      if (sent === "live") {
        // The team has the design open live, and the server takes no write of it until its room is written back, which may be
        // long. Waiting would hold the edit here and the person out of the room. So the edit is kept as a copy (as a conflict
        // keeps one), and the room's version is joined: nothing is lost, and nothing waits on anybody.
        const title = await sync.keepAsCopy(designId);
        if (title === null) throw new Unsent(m.cloud.live.unsent);
        // (said at once: the copy is there whether or not the room is reached after this)
        useTeamLive.setState({ kept: m.cloud.live.keptCopy(title) });
      } else if (sent !== "in-step") throw new Unsent(m.cloud.live.unsent);
    }
    const room = await api.openLive({ server: session.server, token: session.token }, team.space, designId);
    useTeamLive.setState({ designId, link: { server: session.server, room: room.room, key: "", role: room.role }, session: session.token, joining: false, error: null });
  } catch (error) {
    if (error instanceof api.CloudError && error.code === "not-live") {
      // a viewer, and nobody who may edit has it open live (or the last one left): the space's copy, read-only, and why
      useTeamLive.setState({ designId, ...NONE, notice: m.cloud.errors["not-live"] });
      return;
    }
    const words = error instanceof Unsent ? error.message : error instanceof api.CloudError && error.code === "offline" ? m.cloud.live.offline : api.cloudErrorText(error);
    useTeamLive.setState({ joining: false, error: words, link: null });
    throw new Error(words, { cause: error });
  }
}

/** Stops editing live: the editor leaves the room and the design here is what the room has, which it writes back itself. */
export function stopTeamLive(): void {
  useTeamLive.setState({ designId: null, ...NONE });
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
  let end: { reachedLive: boolean; unsent: number; room: Design | null } | null = null;
  const stop = connectLive(link, { session, onDenied, onStop: (e) => (end = e) });
  return () => {
    stop();
    // leaving a room ends the read-only mode it set: a viewer of the team keeps it all the same
    void applyTeamRole(designId);
    // What was done live is the room's, which writes it back: the copy here is in step, not something to send again. Only when the
    // room was joined, every edit of this person got there, and the copy here (once its last save is written) is what the room has;
    // anything else stays to be sent by sync, where the same content on both sides makes no copy.
    const ended = end;
    const room = ended?.reachedLive && ended.unsent === 0 ? ended.room : null;
    if (!room) return;
    void (async () => {
      const [{ settleSaves }, sync] = await Promise.all([import("@/settleSaves"), import("@/cloud/sync")]);
      await settleSaves(3000);
      await sync.markInStep(designId, room);
    })().catch(() => undefined);
  };
}

/** A viewer of a team opens its designs read-only, as with a view link. */
export async function applyTeamRole(designId: string): Promise<void> {
  const team = await teamOf(designId).catch(() => null);
  if (team?.role === "viewer" && useEditor.getState().design?.id === designId) useEditor.getState().actions.setMode("view");
}
