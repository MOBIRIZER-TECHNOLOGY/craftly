/**
 * "Your team" in the Share panel (TeamLiveSection.tsx): what it says and offers to an editor, a commenter (docs/REVIEW.md) and a
 * viewer of the team, while joining, once live, with a notice or a kept copy, and when the room cannot be had. The team's room
 * itself is teamLive.ts's (teamLive.dom.test.ts); here who the person is in the team is given.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useCloud, type CloudSession } from "@/cloud/state";
import { createDesign } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { useLiveStatus } from "./connection";
import * as teamLive from "./teamLive";
import { TeamLiveSection } from "./TeamLiveSection";

vi.mock("./teamLive", async (importOriginal) => ({ ...(await importOriginal<typeof import("./teamLive")>()), teamOf: vi.fn(), startTeamLive: vi.fn() }));

const role = vi.fn<() => "owner" | "editor" | "commenter" | "viewer" | null>();
(teamLive.teamOf as Mock).mockImplementation(async () => {
  const r = role();
  return r ? { space: "team_0123456789abcdef", role: r } : null;
});
const start = teamLive.startTeamLive as Mock;

const mount = async () => {
  render(<TeamLiveSection />);
  await act(async () => undefined);
};

beforeEach(() => {
  resetEditor();
  useEditor.getState().actions.openDesign(createDesign({ title: "Team flyer", width: 100, height: 100 }));
  useCloud.setState({ loaded: true, session: { token: "t" } as unknown as CloudSession });
  useLiveStatus.setState({ status: "off", reason: null, role: null, stopped: false });
  teamLive.useTeamLive.setState(teamLive.useTeamLive.getInitialState(), true);
  start.mockReset();
});
afterEach(() => useCloud.setState({ loaded: false, session: null }));

describe("Your team in the Share panel", () => {
  it("is not there for a design that is not a team's, nor while nobody is signed in", async () => {
    role.mockReturnValue(null);
    await mount();
    expect(screen.queryByRole("heading", { name: "Your team" })).toBeNull();
    useCloud.setState({ session: null });
    await mount();
    expect(screen.queryByRole("heading", { name: "Your team" })).toBeNull();
  });

  it("offers an editor to edit live, and says why it could not", async () => {
    role.mockReturnValue("editor");
    start.mockRejectedValueOnce(new Error("The server is not there."));
    await mount();
    expect(screen.getByText(/press “Edit live with your team” edit it with you/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Edit live with your team" }));
    expect(start).toHaveBeenCalledWith(useEditor.getState().design!.id);
    expect((await screen.findByRole("alert")).textContent).toBe("The server is not there.");
    start.mockRejectedValueOnce("not an error");
    await userEvent.click(screen.getByRole("button", { name: "Edit live with your team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("not an error");
  });

  it("offers a commenter to review live, and says what they can do", async () => {
    role.mockReturnValue("commenter");
    start.mockResolvedValue(undefined);
    await mount();
    expect(screen.getByText(/You are a commenter in this team/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Review live with your team" }));
    expect(start).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tells a viewer they look, and says why there is nothing live to see", async () => {
    role.mockReturnValue("viewer");
    await mount();
    expect(screen.getByText(/You are a viewer in this team/)).toBeTruthy();
    act(() => teamLive.useTeamLive.setState({ designId: useEditor.getState().design!.id, notice: "Nobody is editing this design live.", kept: "Kept as a copy." }));
    expect(screen.getByText("Nobody is editing this design live.")).toBeTruthy();
    expect(screen.getByText("Kept as a copy.")).toBeTruthy();
  });

  it("shows that it is joining, and once live, how it is live and how to stop", async () => {
    role.mockReturnValue("commenter");
    await mount();
    const id = useEditor.getState().design!.id;
    act(() => teamLive.useTeamLive.setState({ designId: id, joining: true }));
    expect(screen.getByRole("button", { name: "Joining…" }).getAttribute("aria-busy")).toBe("true");
    act(() => {
      teamLive.useTeamLive.setState({ designId: id, joining: false, link: { server: "https://a.example", room: "r", key: "", role: "comment" }, session: "s" });
      useLiveStatus.setState({ status: "live", reason: null, role: "comment", stopped: false });
    });
    expect(screen.getByText("Live, commenting")).toBeTruthy();
    act(() => useLiveStatus.setState({ status: "connecting", reason: null, role: null, stopped: false }));
    expect(screen.getByText("Connecting...")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop editing live" }));
    expect(teamLive.useTeamLive.getState().link).toBeNull();
  });

  it("is not there for a design shared by a link", async () => {
    role.mockReturnValue("editor");
    const d = useEditor.getState().design!;
    useEditor.setState({ design: { ...d, live: { server: "https://a.example", room: "r", key: "k", role: "edit" } } });
    await mount();
    expect(screen.queryByRole("heading", { name: "Your team" })).toBeNull();
  });
});
