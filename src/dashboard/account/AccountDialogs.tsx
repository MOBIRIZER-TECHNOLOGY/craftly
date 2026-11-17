/** The account dialogs, one at a time, as `accountDialogs.ts` asks for them. Loaded with the first one asked for. */
import { AccountDialog } from "./AccountDialog";
import { closeAccountDialog, useAccountDialogs } from "./dialogState";
import { MoveDesignsDialog } from "./MoveDesignsDialog";
import { SignOutDialog } from "./SignOutDialog";
import { CreateTeamDialog } from "./TeamSwitcher";

export function AccountDialogs() {
  const open = useAccountDialogs((s) => s.open);
  return (
    <>
      <AccountDialog open={open === "settings"} onClose={closeAccountDialog} />
      <SignOutDialog open={open === "signout"} onClose={closeAccountDialog} />
      <MoveDesignsDialog open={open === "move"} onClose={closeAccountDialog} />
      <CreateTeamDialog open={open === "createTeam"} onClose={closeAccountDialog} />
    </>
  );
}
