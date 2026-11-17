/**
 * Which account dialog is open (the account settings, signing out, moving designs in, making a team): the account menu, the
 * sign-in page and the team switcher ask for one, and `AccountDialogs` (loaded only when one is asked for) shows it.
 */
import { create } from "zustand";

export type AccountDialogName = "settings" | "signout" | "move" | "createTeam";

export const useAccountDialogs = create<{ open: AccountDialogName | null; loaded: boolean }>(() => ({ open: null, loaded: false }));

export const openAccountDialog = (open: AccountDialogName) => useAccountDialogs.setState({ open, loaded: true });
export const closeAccountDialog = () => useAccountDialogs.setState({ open: null });

/** The address of the server a person typed last on this device (only when the build names none). */
const TYPED_KEY = "craftly.account.server";

export function typedServer(): string {
  try {
    return localStorage.getItem(TYPED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberTypedServer(server: string): void {
  try {
    localStorage.setItem(TYPED_KEY, server);
  } catch {
    /* it is asked for again next time */
  }
}
