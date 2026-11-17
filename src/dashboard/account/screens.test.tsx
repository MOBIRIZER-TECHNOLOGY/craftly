/**
 * The account screens against a real account server on a port of its own (docs/ACCOUNTS.md, "Client"): sign up with the server
 * typed in and its host shown plainly, the recovery code, moving designs in, a wrong password in words, the team page (members,
 * roles, invites), the space switcher and listings by space, signing out.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign } from "@/core/factory";
import { getSummary, listDesigns, saveDesign } from "@/core/library";
import { applySession, saveSession, useCloud } from "@/cloud/state";
import { stopSync } from "@/cloud/sync";
import { designsStore } from "@/dashboard/data";
import { boot, call, closeAll, PASSWORD, signUp, type Booted } from "@/server/accounts/testServer";
import { Hosts, emptyLibrary } from "@/test/dashuiUtils";
import { AccountDialogs } from "./AccountDialogs";
import { openAccountDialog } from "./dialogState";
import { SignInPage } from "./SignInPage";
import { TeamPage } from "./TeamPage";
import { TeamSwitcher } from "./TeamSwitcher";

let b: Booted;

beforeEach(async () => {
  await emptyLibrary();
  localStorage.clear();
  b = await boot();
});

afterEach(async () => {
  stopSync();
  await act(async () => saveSession(null));
  await closeAll();
});

const host = () => new URL(b.base).host;

describe("signing up", () => {
  it("takes the server typed in, shows its host plainly, sets autocomplete, shows the recovery code once and offers to move designs in", async () => {
    await saveDesign(createDesign({ title: "Made before the account", width: 100, height: 100 }));
    const user = userEvent.setup();
    render(
      <>
        <SignInPage mode="signup" />
        <AccountDialogs />
        <Hosts />
      </>,
    );
    await user.type(screen.getByLabelText("Account server"), b.base);
    const name = screen.getByLabelText("Your name");
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect([name, email, password].map((field) => field.getAttribute("autocomplete"))).toEqual(["name", "username", "new-password"]);
    await user.type(name, "Ann");
    await user.type(email, "ann@example.org");
    await user.type(password, "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("A password has at least 10 characters.")).toBeTruthy();
    await user.clear(password);
    await user.type(password, PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Keep your recovery code" })).toBeTruthy();
    expect(screen.getByTestId("recovery-code").textContent).toMatch(/^[A-Za-z0-9_-]{22}$/);
    stopSync();
    expect(useCloud.getState().session?.user.email).toBe("ann@example.org");
    await user.click(screen.getByRole("button", { name: "I have kept it" }));
    const dialog = await screen.findByRole("dialog", { name: "Move 1 design into your account?" });
    await user.click(within(dialog).getByRole("button", { name: "Move all" }));
    stopSync();
    const [summary] = await listDesigns();
    expect(summary.space).toBe(useCloud.getState().session?.user.id);
  });

  it("names the host of a server that the build or an earlier visit gave, and says a wrong password in words", async () => {
    const person = await signUp(b);
    localStorage.setItem("craftly.account.server", b.base);
    const user = userEvent.setup();
    render(
      <>
        <SignInPage mode="signin" />
        <Hosts />
      </>,
    );
    expect(screen.getByText(host())).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change server" })).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe("current-password");
    await user.type(screen.getByLabelText("Email"), person.email);
    await user.type(screen.getByLabelText("Password"), "not the password at all");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That email and password do not match.");
    expect(useCloud.getState().session).toBeNull();
  });
});

describe("a team", () => {
  it("lists members with roles an owner can change, makes an invite shown once, and the switcher lists the team's designs", async () => {
    const ann = await signUp(b, { name: "Ann" });
    const bob = await signUp(b, { name: "Bob" });
    const team = (await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Studio" } })).body.team;
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    await call(b, "POST", "/api/invites/redeem", { token: bob.token, body: { code } });
    act(() =>
      applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [{ id: team.id, name: "Studio", role: "owner" }], activeSpace: ann.user.id }),
    );

    const user = userEvent.setup();
    render(
      <>
        <TeamSwitcher />
        <TeamPage teamId={team.id} />
        <Hosts />
      </>,
    );
    expect(await screen.findByRole("heading", { name: "Studio", level: 1 })).toBeTruthy();
    const role = screen.getByRole("combobox", { name: "Role of Bob" }) as HTMLSelectElement;
    expect(role.value).toBe("editor");
    await user.selectOptions(role, "viewer");
    await waitFor(async () =>
      expect((await call(b, "GET", `/api/teams/${team.id}`, { token: ann.token })).body.members.find((m: { id: string }) => m.id === bob.user.id).role).toBe("viewer"),
    );

    await user.click(screen.getByRole("button", { name: "Make invite" }));
    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toMatch(/#\/invite\/[A-Za-z0-9_-]{22}$/);
    expect(await screen.findByText(/^Editor, 5 uses left/)).toBeTruthy();

    // the switcher: the team's space lists the team's designs, and only them
    await saveDesign(createDesign({ title: "Mine", width: 10, height: 10 }));
    const unsubscribe = designsStore.subscribe(() => undefined);
    await user.selectOptions(screen.getByLabelText("Space"), team.id);
    await waitFor(() => expect(useCloud.getState().session?.activeSpace).toBe(team.id));
    const teamDesign = createDesign({ title: "Team flyer", width: 10, height: 10 });
    await saveDesign(teamDesign);
    expect((await getSummary(teamDesign.id))?.space).toBe(team.id);
    await waitFor(() => expect(designsStore.getSnapshot().value.map((d) => d.title)).toEqual(["Team flyer"]));
    unsubscribe();
  });
});

describe("signing out", () => {
  it("removes the account's designs from the device and keeps the device's own", async () => {
    const ann = await signUp(b, { name: "Ann" });
    await saveDesign(createDesign({ title: "Only here", width: 10, height: 10 }));
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    await saveDesign(createDesign({ title: "In the account", width: 10, height: 10 }));
    const user = userEvent.setup();
    render(
      <>
        <AccountDialogs />
        <Hosts />
      </>,
    );
    act(() => openAccountDialog("signout"));
    const dialog = await screen.findByRole("dialog", { name: "Sign out" });
    // the design in the account was never sent: keeping copies is what is offered
    expect(await within(dialog).findByText(/1 change has not reached the server yet/)).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: "Keep copies of my account's designs on this device" }));
    await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(useCloud.getState().session).toBeNull());
    expect((await listDesigns()).map((d) => d.title).sort()).toEqual(["Only here"]);
  });
});
