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
import { inviteUrl, parseInvite } from "@/cloud/inviteLink";
import { applySession, saveSession, useCloud } from "@/cloud/state";
import { stopSync } from "@/cloud/sync";
import { designsStore } from "@/dashboard/data";
import { boot, call, closeAll, PASSWORD, signUp, type Booted } from "@/server/accounts/testServer";
import { Hosts, dialogGone, emptyLibrary } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { AccountDialogs } from "./AccountDialogs";
import { openAccountDialog } from "./dialogState";
import { InvitePage } from "./InvitePage";
import { ResetPage } from "./ResetPage";
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
  // a toast outlives the test that showed it ("You joined Studio." twice would be found by the next test)
  act(() => toast.clear());
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

describe("an invite", () => {
  it("makes an account with the invite, shows the recovery code, and the person is in the team", async () => {
    const ann = await signUp(b, { name: "Ann" });
    const team = (await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Studio" } })).body.team;
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "viewer", uses: 1, hours: 1 } })).body.code;
    localStorage.setItem("craftly.account.server", b.base);
    const user = userEvent.setup();
    render(
      <>
        <InvitePage code={code} />
        <Hosts />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Join a team", level: 1 })).toBeTruthy();
    await user.type(screen.getByLabelText("Your name"), "Bob");
    await user.type(screen.getByLabelText("Email"), "bob@example.org");
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    // the page stays until the code is kept, although the person is signed in by now
    expect(await screen.findByRole("heading", { name: "Keep your recovery code" })).toBeTruthy();
    stopSync();
    expect(useCloud.getState().session?.teams).toEqual([{ id: team.id, name: "Studio", role: "viewer" }]);
    expect(useCloud.getState().session?.activeSpace).toBe(team.id);
  });

  it("takes the server the link names, shows its host plainly, and asks for no address", async () => {
    const ann = await signUp(b, { name: "Ann" });
    const team = (await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Studio" } })).body.team;
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    // no server from the build or an earlier visit: only the link names it
    const part = inviteUrl("http://app.example.org/", code, b.base).split("#/invite/")[1];
    const user = userEvent.setup();
    render(
      <>
        <InvitePage code={part} />
        <Hosts />
      </>,
    );
    expect(screen.getByText(`The team is on ${host()}.`)).toBeTruthy();
    expect(screen.queryByText(/No account server is set up/)).toBeNull();
    expect(screen.queryByLabelText("Account server")).toBeNull();
    await user.type(screen.getByLabelText("Your name"), "Bob");
    await user.type(screen.getByLabelText("Email"), "bob2@example.org");
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Keep your recovery code" })).toBeTruthy();
    stopSync();
    expect(useCloud.getState().session).toMatchObject({ server: b.base, teams: [{ id: team.id, name: "Studio", role: "editor" }] });
  });

  it("does not offer to join with a session of another server than the link names", async () => {
    const ann = await signUp(b, { name: "Ann" });
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    const part = inviteUrl("http://app.example.org/", "AbCdEfGhIjKlMnOpQrStUv", "https://elsewhere.example.org").split("#/invite/")[1];
    render(<InvitePage code={part} />);
    expect(screen.getByRole("alert").textContent).toBe(
      `This invite is for a team on elsewhere.example.org, but you are signed in on ${host()}. Sign out first, then open the link again.`,
    );
    expect(screen.queryByRole("button", { name: "Join the team" })).toBeNull();
  });

  it("lets a person who has an account sign in from the invite instead, and joins the team with that account", async () => {
    const ann = await signUp(b, { name: "Ann" });
    const bob = await signUp(b, { name: "Bob" });
    const team = (await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Studio" } })).body.team;
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    localStorage.setItem("craftly.account.server", b.base);
    const user = userEvent.setup();
    render(
      <>
        <InvitePage code={code} />
        <Hosts />
      </>,
    );
    // the switch between the two forms stays on the invite (it does not go to #/signin), and can go back
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in", level: 2 })).toBeTruthy();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create one" }));
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(window.location.hash).not.toBe("#/signin");

    await user.type(screen.getByLabelText("Email"), bob.email);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    stopSync();
    expect(screen.getAllByText("You joined Studio.").length).toBeGreaterThan(0);
    expect(useCloud.getState().session?.user.email).toBe(bob.email);
    expect(useCloud.getState().session?.teams).toEqual([{ id: team.id, name: "Studio", role: "editor" }]);
    expect(useCloud.getState().session?.activeSpace).toBe(team.id);
  });

  it("joins with one press for a person who is signed in, and says in words when the invite is used up", async () => {
    const ann = await signUp(b, { name: "Ann" });
    const bob = await signUp(b, { name: "Bob" });
    const carol = await signUp(b, { name: "Carol" });
    const team = (await call(b, "POST", `/api/teams`, { token: ann.token, body: { name: "Studio" } })).body.team;
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "viewer", uses: 1, hours: 1 } })).body.code;
    act(() => applySession({ server: b.base, token: bob.token, user: bob.user, device: "Test", teams: [], activeSpace: bob.user.id }));
    const user = userEvent.setup();
    const first = render(
      <>
        <InvitePage code={code} />
        <Hosts />
      </>,
    );
    expect(screen.getByText(`The team is on ${host()}.`)).toBeTruthy();
    expect(screen.getByText("Signed in as Bob")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Join the team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    stopSync();
    expect(screen.getAllByText("You joined Studio.").length).toBeGreaterThan(0);
    expect(useCloud.getState().session?.teams).toEqual([{ id: team.id, name: "Studio", role: "viewer" }]);
    first.unmount();

    // the invite had one use, and Bob took it
    act(() => applySession({ server: b.base, token: carol.token, user: carol.user, device: "Test", teams: [], activeSpace: carol.user.id }));
    render(
      <>
        <InvitePage code={code} />
        <Hosts />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Join the team" }));
    expect((await screen.findByRole("alert")).textContent).not.toBe("");
    expect(screen.getByRole("button", { name: "Join the team" })).toBeTruthy();
    expect(useCloud.getState().session?.teams).toEqual([]);
  });

  it("says so for a link that is not an invite", () => {
    render(<InvitePage code="not-a-code" />);
    expect(screen.getByText("This link is not an invite. Ask for a new one.")).toBeTruthy();
  });
});

describe("setting a new password", () => {
  const ADMIN_KEY = "an-operator-key-for-the-screens";
  const signIn = (server: Booted, email: string, password: string) => call(server, "POST", "/api/auth/signin", { body: { email, password, device: "Laptop" } });

  it("with the recovery code: asks for the email and the code, says a short password and a wrong code in words, then shows a new recovery code", async () => {
    const ann = await signUp(b);
    localStorage.setItem("craftly.account.server", b.base);
    const user = userEvent.setup();
    render(
      <>
        <ResetPage />
        <Hosts />
      </>,
    );
    expect(screen.getByText("Type your email and the recovery code you were given when you made your account.")).toBeTruthy();
    expect(screen.getByLabelText("New password").getAttribute("autocomplete")).toBe("new-password");
    await user.type(screen.getByLabelText("Email"), ` ${ann.email} `);
    await user.type(screen.getByLabelText("Recovery code"), "A".repeat(22));
    await user.type(screen.getByLabelText("New password"), "too short");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    // a password the server would refuse is not sent
    expect((await screen.findByRole("alert")).textContent).toBe("A password has at least 10 characters.");
    await user.type(screen.getByLabelText("New password"), " but now long enough");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    // a code that is not the person's: the server's refusal in words, and the form stays
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe("A password has at least 10 characters."));
    expect(screen.getByRole("button", { name: "Set new password" })).toBeTruthy();
    await user.clear(screen.getByLabelText("Recovery code"));
    await user.type(screen.getByLabelText("Recovery code"), ` ${ann.recoveryCode} `);
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Your password is set. Sign in with it. Every device was signed out.")).toBeTruthy();
    expect(screen.getByText("Your old recovery code is used up. Here is a new one.")).toBeTruthy();
    const fresh = screen.getByTestId("recovery-code").textContent;
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fresh).not.toBe(ann.recoveryCode);
    expect((await signIn(b, ann.email, "too short but now long enough")).status).toBe(200);
    expect((await signIn(b, ann.email, PASSWORD)).status).toBe(401);
    // keeping the new code goes on to signing in
    await user.click(screen.getByRole("button", { name: "I have kept it" }));
    expect(window.location.hash).toBe("#/signin");
  });

  it("with the operator's one-time link: asks only for the new password, and then offers to sign in", async () => {
    const withAdmin = await boot({}, { adminKey: ADMIN_KEY });
    const ann = await signUp(withAdmin);
    const made = await call(withAdmin, "POST", "/api/admin/accounts/reset", { body: { email: ann.email }, origin: null, headers: { "x-craftly-admin-key": ADMIN_KEY } });
    localStorage.setItem("craftly.account.server", withAdmin.base);
    const user = userEvent.setup();
    render(
      <>
        <ResetPage code={made.body.code} />
        <Hosts />
      </>,
    );
    expect(screen.getByText("This link lets you set a new password for your account.")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Recovery code")).toBeNull();
    await user.type(screen.getByLabelText("New password"), "set by the operator's link");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Your password is set. Sign in with it. Every device was signed out.")).toBeTruthy();
    // no recovery code was used, so there is no new one to keep: a link to sign in instead
    expect(screen.queryByTestId("recovery-code")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("#/signin");
    expect((await signIn(withAdmin, ann.email, "set by the operator's link")).status).toBe(200);
  });

  it("treats a link whose code is not a code as a reset with the recovery code, and refuses a server that is not an address", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ResetPage code="not-a-code" />
        <Hosts />
      </>,
    );
    expect(screen.getByLabelText("Recovery code")).toBeTruthy();
    await user.type(screen.getByLabelText("Account server"), "not a server at all");
    await user.type(screen.getByLabelText("New password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("That is not the address of a server.")).toBeTruthy();
    expect(screen.queryByRole("alert", { name: /password/ })).toBeNull();
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
    // (a commenter comments, reviews and approves without editing: docs/REVIEW.md)
    expect([...role.options].map((o) => o.value)).toEqual(["owner", "editor", "commenter", "viewer"]);
    await user.selectOptions(role, "viewer");
    await waitFor(async () =>
      expect((await call(b, "GET", `/api/teams/${team.id}`, { token: ann.token })).body.members.find((m: { id: string }) => m.id === bob.user.id).role).toBe("viewer"),
    );

    await user.click(screen.getByRole("button", { name: "Make invite" }));
    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    // the link names the account server, after the # (inviteLink.ts)
    expect(link.value).toMatch(/#\/invite\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(parseInvite(link.value.split("#/invite/")[1])?.server).toBe(b.base);
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

describe("the team page", () => {
  /** Ann owns "Studio", Bob edits in it; the session on this device is the one of `who`. */
  async function studio(who: "ann" | "bob" = "ann") {
    const ann = await signUp(b, { name: "Ann" });
    const bob = await signUp(b, { name: "Bob" });
    const team = (await call(b, "POST", "/api/teams", { token: ann.token, body: { name: "Studio" } })).body.team as { id: string };
    const code = (await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "editor", uses: 1, hours: 1 } })).body.code;
    await call(b, "POST", "/api/invites/redeem", { token: bob.token, body: { code } });
    const me = who === "ann" ? ann : bob;
    act(() =>
      applySession({
        server: b.base,
        token: me.token,
        user: me.user,
        device: "Test",
        teams: [{ id: team.id, name: "Studio", role: who === "ann" ? "owner" : "editor" }],
        activeSpace: me.user.id,
      }),
    );
    return { ann, bob, team };
  }
  const mountTeam = (teamId: string) =>
    render(
      <>
        <TeamPage teamId={teamId} />
        <Hosts />
      </>,
    );
  const teamsOnServer = async (token: string) => (await call(b, "GET", "/api/me", { token })).body.teams as Array<{ id: string; name: string }>;

  it("lets an owner revoke an invite, make one from emptied fields and copy its link, and rename the team", async () => {
    const { ann, team } = await studio();
    await call(b, "POST", `/api/teams/${team.id}/invites`, { token: ann.token, body: { role: "viewer", uses: 3, hours: 2 } });
    const user = userEvent.setup();
    mountTeam(team.id);
    expect(await screen.findByRole("heading", { name: "Studio", level: 1 })).toBeTruthy();
    expect(screen.getByText("Ann (you)")).toBeTruthy();
    // the owner is not offered to remove themself: that is "Leave team"
    expect(screen.queryByRole("button", { name: "Remove Ann" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("No open invites.")).toBeTruthy();

    // emptied fields are not sent empty: one use, and the 72 hours the field starts with (the fields' own range keeps the rest in bounds)
    await user.clear(screen.getByLabelText("Uses"));
    await user.clear(screen.getByLabelText("Valid for (hours)"));
    await user.click(screen.getByRole("button", { name: "Make invite" }));
    expect(await screen.findByText(/^Editor, 1 use left/)).toBeTruthy();
    const [invite] = (await call(b, "GET", `/api/teams/${team.id}/invites`, { token: ann.token })).body.invites;
    expect(invite.expiresAt - b.clock.now()).toBe(72 * 60 * 60 * 1000);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    // (user-event puts a clipboard of its own in the page, which the test reads back)
    expect(await navigator.clipboard.readText()).toBe((screen.getByLabelText("Invite link") as HTMLInputElement).value);
    expect(await screen.findByText("Invite link copied")).toBeTruthy();

    // no name, or the same name again, is not sent
    const field = screen.getByLabelText("Team name");
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.type(field, "Print shop");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Print shop", level: 1 })).toBeTruthy();
    expect((await teamsOnServer(ann.token)).map((t) => t.name)).toEqual(["Print shop"]);
    await waitFor(() => expect(useCloud.getState().session?.teams[0].name).toBe("Print shop"));
  });

  it("lets an owner remove a member after asking, and delete the team, which takes the person back to their own designs", async () => {
    const { ann, bob, team } = await studio();
    const user = userEvent.setup();
    mountTeam(team.id);
    await user.click(await screen.findByRole("button", { name: "Remove Bob" }));
    const ask = await screen.findByRole("dialog", { name: "Remove Bob" });
    expect(within(ask).getByText("Remove Bob from the team? They lose the team's designs at once.")).toBeTruthy();
    await user.click(within(ask).getByRole("button", { name: "Remove Bob" }));
    await waitFor(() => expect(screen.queryByText("Bob")).toBeNull());
    expect(await teamsOnServer(bob.token)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete team" }));
    const sure = await screen.findByRole("dialog", { name: "Delete team" });
    await user.click(within(sure).getByRole("button", { name: "Delete team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(await teamsOnServer(ann.token)).toEqual([]);
    expect(useCloud.getState().session?.teams).toEqual([]);
    expect(useCloud.getState().session?.activeSpace).toBe(ann.user.id);
  });

  it("shows a member the roles as words, no invites and no settings, and lets them leave after asking", async () => {
    const { bob, team } = await studio("bob");
    const user = userEvent.setup();
    mountTeam(team.id);
    expect(await screen.findByText("Bob (you)")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /^Role of/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Invites" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Rename team" })).toBeNull();
    // a change of mind keeps the person in the team
    await user.click(screen.getByRole("button", { name: "Leave team" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Leave team" })).getByRole("button", { name: "Cancel" }));
    await dialogGone();
    expect((await teamsOnServer(bob.token)).map((t) => t.id)).toEqual([team.id]);
    await user.click(screen.getByRole("button", { name: "Leave team" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Leave team" })).getByRole("button", { name: "Leave team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(await teamsOnServer(bob.token)).toEqual([]);
    expect(useCloud.getState().session?.teams).toEqual([]);
  });

  it("takes a member to the team's designs, says so for a team the person is not in, and asks a person who is not signed in to sign in", async () => {
    const { team } = await studio("bob");
    const user = userEvent.setup();
    const first = mountTeam(team.id);
    await user.click(await screen.findByRole("button", { name: "Back to the team's designs" }));
    expect(window.location.hash).toBe("#/projects");
    await waitFor(() => expect(useCloud.getState().session?.activeSpace).toBe(team.id));
    first.unmount();

    const carol = await signUp(b, { name: "Carol" });
    act(() => applySession({ server: b.base, token: carol.token, user: carol.user, device: "Test", teams: [], activeSpace: carol.user.id }));
    const second = mountTeam(team.id);
    expect(await screen.findByText("You are not in this team, or it is gone.")).toBeTruthy();
    second.unmount();

    await act(async () => saveSession(null));
    mountTeam(team.id);
    expect(screen.getByText("Sign in or create an account to join.")).toBeTruthy();
  });
});

describe("account settings", () => {
  const signInFrom = (email: string, device: string, password = PASSWORD) => call(b, "POST", "/api/auth/signin", { body: { email, password, device } });

  it("names the person and the server, lists the devices signed in, and signs out another device", async () => {
    const ann = await signUp(b, { name: "Ann" });
    await signInFrom(ann.email, "Laptop");
    await signInFrom(ann.email, "");
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    const user = userEvent.setup();
    render(
      <>
        <AccountDialogs />
        <Hosts />
      </>,
    );
    act(() => openAccountDialog("settings"));
    const dialog = await screen.findByRole("dialog", { name: "Account settings" });
    expect(within(dialog).getByText("Ann")).toBeTruthy();
    expect(within(dialog).getByText(ann.email)).toBeTruthy();
    expect(within(dialog).getByText(host())).toBeTruthy();
    expect(await within(dialog).findByText("This device")).toBeTruthy();
    // this device is not offered to sign out here (that is "Sign out"); a device without a name is called "A device"
    expect(within(dialog).getByRole("button", { name: "Sign out A device" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Sign out Laptop" }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Sign out Laptop" })).toBeNull());
    const left = (await call(b, "GET", "/api/me/sessions", { token: ann.token })).body.sessions as Array<{ device: string }>;
    expect(left).toHaveLength(2);
    expect(left.some((s) => s.device === "Laptop")).toBe(false);
  });

  it("changes the password: too short and a wrong current one are said in words, and the other devices are signed out", async () => {
    const ann = await signUp(b, { name: "Ann" });
    await signInFrom(ann.email, "Laptop");
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    const user = userEvent.setup();
    render(
      <>
        <AccountDialogs />
        <Hosts />
      </>,
    );
    act(() => openAccountDialog("settings"));
    const dialog = await screen.findByRole("dialog", { name: "Account settings" });
    await within(dialog).findByRole("button", { name: "Sign out Laptop" });
    const submit = within(dialog).getByRole("button", { name: "Change password" });
    // nothing to send until both fields are filled
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Current password"), "not my password at all");
    await user.type(within(dialog).getByLabelText("New password"), "short");
    await user.click(submit);
    expect((await within(dialog).findByRole("alert")).textContent).toBe("A password has at least 10 characters.");
    await user.type(within(dialog).getByLabelText("New password"), " but long enough now");
    await user.click(submit);
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).not.toBe("A password has at least 10 characters."));
    expect((await signInFrom(ann.email, "Phone", "short but long enough now")).status).toBe(401);

    await user.clear(within(dialog).getByLabelText("Current password"));
    await user.type(within(dialog).getByLabelText("Current password"), PASSWORD);
    await user.click(submit);
    expect(await screen.findByText("Your password is changed. Your other devices were signed out.")).toBeTruthy();
    expect((within(dialog).getByLabelText("Current password") as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText("New password") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Sign out Laptop" })).toBeNull());
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect((await signInFrom(ann.email, "Phone", "short but long enough now")).status).toBe(200);
  });
});

describe("moving designs into the account, one by one", () => {
  it("moves only the designs that stay ticked, and moves nothing while none is", async () => {
    await saveDesign(createDesign({ title: "Flyer", width: 100, height: 100 }));
    await saveDesign(createDesign({ title: "Menu", width: 100, height: 100 }));
    const ann = await signUp(b, { name: "Ann" });
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    stopSync();
    const user = userEvent.setup();
    render(
      <>
        <AccountDialogs />
        <Hosts />
      </>,
    );
    act(() => openAccountDialog("move"));
    const dialog = await screen.findByRole("dialog", { name: "Move 2 designs into your account?" });
    await user.click(within(dialog).getByRole("button", { name: "Choose" }));
    // every design starts ticked
    expect(within(dialog).getByRole("button", { name: "Move 2 designs" })).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: "Flyer" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Menu" }));
    expect((within(dialog).getByRole("button", { name: "Move 0 designs" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("checkbox", { name: "Menu" }));
    await user.click(within(dialog).getByRole("button", { name: "Move 1 design" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    stopSync();
    expect(screen.getAllByText("1 design is moving into your account.").length).toBeGreaterThan(0);
    const spaces = Object.fromEntries((await listDesigns()).map((d) => [d.title, d.space ?? null]));
    expect(spaces).toEqual({ Flyer: null, Menu: ann.user.id });
  });
});

describe("making a team", () => {
  it("makes the team from the switcher, opens its space and its page, and offers its members from the switcher", async () => {
    const ann = await signUp(b, { name: "Ann" });
    act(() => applySession({ server: b.base, token: ann.token, user: ann.user, device: "Test", teams: [], activeSpace: ann.user.id }));
    const user = userEvent.setup();
    render(
      <>
        <TeamSwitcher />
        <AccountDialogs />
        <Hosts />
      </>,
    );
    // in the person's own space there are no team members to show
    expect(screen.queryByRole("button", { name: "Team members" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Create a team" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a team" });
    const create = within(dialog).getByRole("button", { name: "Create team" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Team name"), "  Studio  {Enter}");
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/team\//));
    stopSync();
    const team = useCloud.getState().session?.teams[0];
    expect(team).toMatchObject({ name: "Studio", role: "owner" });
    expect(window.location.hash).toBe(`#/team/${encodeURIComponent(team?.id ?? "")}`);
    expect(useCloud.getState().session?.activeSpace).toBe(team?.id);
    expect(screen.getAllByText("Studio is made. Invite people from its page.").length).toBeGreaterThan(0);
    window.location.hash = "";
    await user.click(await screen.findByRole("button", { name: "Team members" }));
    expect(window.location.hash).toBe(`#/team/${encodeURIComponent(team?.id ?? "")}`);
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
