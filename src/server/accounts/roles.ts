/**
 * What each role in a team may do, as one table and nothing else: every request of a team asks `can(role, action)` and never
 * compares roles by hand, so that the rules are read (and tested, roles.test.ts) in one place.
 *
 *   owner   everything: members, invites, the team's name, deleting the team, deleting a design forever; a team always has one
 *   editor  makes, edits, trashes and restores designs and folders, and uploads
 *   viewer  reads and downloads
 *
 * A person's own space is theirs as an owner. There are no permissions per folder in this version.
 */

export type TeamRole = "owner" | "editor" | "viewer";
export const TEAM_ROLES: readonly TeamRole[] = ["owner", "editor", "viewer"];

export type Action =
  /** list the changes, open a design, its revisions, an upload */
  | "read"
  /** make or change a design, its details (title, folder, star, the trash), restore a revision */
  | "write"
  /** put an upload */
  | "upload"
  /** make, rename, move or remove a folder */
  | "folders"
  /** delete a design for good (a tombstone): what the trash is there to prevent by mistake */
  | "deleteForever"
  /** change someone's role, or remove someone */
  | "manageMembers"
  /** make, list and revoke invites */
  | "invite"
  | "renameTeam"
  | "deleteTeam";

export const ACTIONS: readonly Action[] = ["read", "write", "upload", "folders", "deleteForever", "manageMembers", "invite", "renameTeam", "deleteTeam"];

const TABLE: Readonly<Record<TeamRole, ReadonlySet<Action>>> = {
  owner: new Set(ACTIONS),
  editor: new Set<Action>(["read", "write", "upload", "folders"]),
  viewer: new Set<Action>(["read"]),
};

export const isTeamRole = (value: unknown): value is TeamRole => value === "owner" || value === "editor" || value === "viewer";

/** Whether a role may do an action. Anything that is not a role may do nothing. */
export function can(role: TeamRole | null | undefined, action: Action): boolean {
  return !!role && isTeamRole(role) && TABLE[role].has(action);
}
