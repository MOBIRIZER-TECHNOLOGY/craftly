/** The whole table of roles and actions, cell by cell: a change to one cell fails exactly one line here. */
import { describe, expect, it } from "vitest";
import { ACTIONS, can, isTeamRole, TEAM_ROLES, type Action, type TeamRole } from "./roles";

const MATRIX: Record<TeamRole, Record<Action, boolean>> = {
  owner: { read: true, write: true, upload: true, folders: true, deleteForever: true, manageMembers: true, invite: true, renameTeam: true, deleteTeam: true },
  editor: { read: true, write: true, upload: true, folders: true, deleteForever: false, manageMembers: false, invite: false, renameTeam: false, deleteTeam: false },
  viewer: { read: true, write: false, upload: false, folders: false, deleteForever: false, manageMembers: false, invite: false, renameTeam: false, deleteTeam: false },
};

describe("roles", () => {
  for (const role of TEAM_ROLES) {
    for (const action of ACTIONS) {
      it(`${role} ${MATRIX[role][action] ? "may" : "may not"} ${action}`, () => {
        expect(can(role, action)).toBe(MATRIX[role][action]);
      });
    }
  }

  it("the matrix above names every role and every action", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...TEAM_ROLES].sort());
    for (const role of TEAM_ROLES) expect(Object.keys(MATRIX[role]).sort()).toEqual([...ACTIONS].sort());
  });

  it("nothing that is not a role may do anything, also a role's name in other letters or from the prototype", () => {
    for (const action of ACTIONS) {
      for (const role of [null, undefined, "", "Owner", "admin", "__proto__", "constructor", "toString"]) expect(can(role as TeamRole, action)).toBe(false);
    }
    expect(isTeamRole("owner")).toBe(true);
    expect(isTeamRole("OWNER")).toBe(false);
  });
});
