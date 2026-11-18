/**
 * "Work together" in the Share panel and the state of the connection in the top bar: what a person sees before sharing, what the
 * server says when it cannot be reached, the two links after, copying them, stopping, and what somebody who was given a link sees.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { toast } from "@/ui";
import type { LiveLink } from "@/core/types";
import { chromeDesign } from "@/test/chromeUtils";
import { resetEditor } from "@/test/helpers";
import { useLiveStatus } from "./connection";
import { LiveBadge, LiveSection, liveStatusText } from "./LiveSection";
import { parseJoinToken } from "./links";
import { usePresence } from "./presence";
import { stopTeamLive, useTeamLive } from "./teamLive";
import { cloud as enCloud } from "@/i18n/en/cloud";
import { cloud as hiCloud } from "@/i18n/hi/cloud";

const made = { ownerKey: "owner-key", room: "TW-FaxWt8edjpnT-bGQyjA", editKey: "WjGO30NJy5udhntaj-8j9w", viewKey: "BXQddjRR35eABAbZ6Hib_Q" };
const link: LiveLink = { server: "https://live.example.test", room: made.room, key: made.editKey, role: "edit", viewKey: made.viewKey, ownerKey: made.ownerKey };

const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
let calls: Array<{ url: string; init?: RequestInit }>;
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  resetEditor();
  useEditor.getState().actions.openDesign(chromeDesign("Shared"));
  useLiveStatus.setState({ status: "off", reason: null, role: null });
  calls = [];
  respond = (_url, init) => answer(init?.method === "DELETE" ? 200 : 201, init?.method === "DELETE" ? { ok: true } : made);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }),
  );
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const field = (name: string | RegExp) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("when the server turns this browser away, or is turned away", () => {
  it.each([
    ["invalid", /does not accept/i],
    ["no-access", /not allowed in/i],
    ["not-found", /no longer there/i],
    ["server-error", /server has a problem/i],
  ] as const)("says why, in words, for %s", (reason, words) => {
    useEditor.getState().actions.setLiveLink(link);
    useLiveStatus.setState({ status: "denied", reason, role: null });
    render(<LiveSection />);
    expect(screen.getByRole("alert").textContent).toMatch(words);
  });

  it("says nothing of the kind while the connection is fine", () => {
    useEditor.getState().actions.setLiveLink(link);
    useLiveStatus.setState({ status: "live", reason: null, role: "edit" });
    render(<LiveSection />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("while the design is edited live with its team (no link)", () => {
  const teamLink: LiveLink = { server: "https://accounts.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "", role: "edit" };
  afterEach(() => stopTeamLive());

  it("offers no link session beside it, and the top bar shows the Live badge", () => {
    act(() => useTeamLive.setState({ designId: useEditor.getState().design!.id, link: teamLink, session: "s" }));
    useLiveStatus.setState({ status: "live", reason: null, role: "edit" });
    render(
      <>
        <LiveSection />
        <LiveBadge />
      </>,
    );
    expect(screen.queryByRole("button", { name: "Start live session" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Work together" })).toBeNull();
    const badge = screen.getByRole("status");
    expect(badge.textContent).toBe(liveStatusText("live", "edit"));
    expect(badge.getAttribute("title")).toBe("Live with your team");
  });

  it("says, in English and in Hindi, that a member is live only once they press the button", () => {
    // a member who opens the design is not live until they press "Edit live with your team": the words say that
    for (const catalog of [enCloud, hiCloud]) expect(catalog.live.hint).toContain(`“${catalog.live.editLive}”`);
  });

  it("offers the link session again, and no badge, once the team's room is left", () => {
    act(() => useTeamLive.setState({ designId: useEditor.getState().design!.id, link: teamLink, session: "s" }));
    act(() => stopTeamLive());
    render(
      <>
        <LiveSection />
        <LiveBadge />
      </>,
    );
    expect(screen.getByRole("button", { name: "Start live session" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("before the design is shared", () => {
  it("explains what it is for and asks for a server, remembering the address that was used", async () => {
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    expect(screen.getByRole("heading", { name: "Work together" })).toBeTruthy();
    expect(field("Server address").value).toBe("http://localhost:8787");
    await user.clear(field("Server address"));
    await user.type(field("Server address"), "live.example.test");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeTruthy());
    expect(calls[0].url).toBe("https://live.example.test/api/rooms");
    expect(localStorage.getItem("craftly.live.server")).toBe("https://live.example.test");
  });

  it("offers the address that was used last time, and cannot start without one", async () => {
    localStorage.setItem("craftly.live.server", "https://last.example.test");
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    expect(field("Server address").value).toBe("https://last.example.test");
    await user.clear(field("Server address"));
    expect((screen.getByRole("button", { name: "Start live session" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says in words why it could not start, and stays as it was", async () => {
    respond = () => answer(413, { error: "the design is too big" });
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    expect(await screen.findByText("the design is too big")).toBeTruthy();
    expect(useEditor.getState().design!.live).toBeUndefined();
    expect(screen.getByRole("button", { name: "Start live session" })).toBeTruthy();
    respond = () => {
      throw new TypeError("fetch failed");
    };
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
    await user.clear(field("Server address"));
    await user.type(field("Server address"), "not a server");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    expect(await screen.findByText(/not the address of a server/)).toBeTruthy();
  });
});

describe("on a server that asks for a key to start sharing", () => {
  const keyField = () => screen.queryByLabelText("Key to start sharing") as HTMLInputElement | null;
  const sentKey = (call: { init?: RequestInit }) => new Headers(call.init?.headers).get("x-craftly-create-key");
  /** A server that has the key "right-key": what `createRoom` of src/server/live.ts answers. */
  const keyed = (_url: string, init?: RequestInit) => {
    const shown = new Headers(init?.headers).get("x-craftly-create-key");
    if (!shown) return answer(401, { error: "this server asks for a key to start sharing", code: "create-key-needed" });
    if (shown !== "right-key") return answer(403, { error: "that key to start sharing is not right", code: "create-key-wrong" });
    return answer(201, made);
  };

  it("shows no field for a key until a server asks for one", async () => {
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    expect(keyField()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeTruthy());
    expect(sentKey(calls[0])).toBeNull();
  });

  it("asks for the key when the server wants one, in a field that hides what is typed, and shares with it", async () => {
    respond = keyed;
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(keyField()).toBeTruthy());
    expect(keyField()!.type).toBe("password");
    expect(screen.getByText("This server asks for a key to start sharing. Whoever runs it can give it to you.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // nothing went wrong: it is a question
    expect(document.activeElement).toBe(keyField());
    // nothing to send yet
    expect((screen.getByRole("button", { name: "Start live session" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(keyField()!, "right-key");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeTruthy());
    expect(calls.map(sentKey)).toEqual([null, "right-key"]);
  });

  it("says so plainly when the key is wrong, and lets the person try another", async () => {
    respond = keyed;
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(keyField()).toBeTruthy());
    await user.type(keyField()!, "a-guess");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That key is not right. Check it with whoever runs the server.");
    expect(useEditor.getState().design!.live).toBeUndefined();
    await user.clear(keyField()!);
    await user.type(keyField()!, "right-key");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeTruthy());
  });

  it("does not keep the key on this device, and does not show it to another server", async () => {
    respond = keyed;
    const user = userEvent.setup({ delay: null });
    const { unmount } = render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(keyField()).toBeTruthy());
    await user.type(keyField()!, "a-guess");
    // another address: the question was the other server's, and so was the key
    await user.clear(field("Server address"));
    await user.type(field("Server address"), "other.example.test");
    expect(keyField()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(keyField()).toBeTruthy());
    expect(keyField()!.value).toBe("");
    expect(sentKey(calls[calls.length - 1])).toBeNull();
    await user.type(keyField()!, "right-key");
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeTruthy());
    const kept = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), useEditor.getState().design]);
    expect(kept).not.toContain("right-key");
    // and the panel does not have it the next time it is opened
    act(() => useEditor.getState().actions.setLiveLink(null));
    unmount();
    render(<LiveSection />);
    expect(keyField()).toBeNull();
  });

  it("shows a refusal that is not about the key as before", async () => {
    respond = () => answer(401, { error: "sign in first" });
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Start live session" }));
    expect(await screen.findByText("sign in first")).toBeTruthy();
    expect(keyField()).toBeNull();
  });
});

describe("once it is shared", () => {
  const shared = () => act(() => useEditor.getState().actions.setLiveLink(link));

  it("shows the two links, one that lets people edit and one that only lets them look, that lead back to this design's room", () => {
    shared();
    render(<LiveSection />);
    const edit = field("Edit link").value;
    const view = field("View link").value;
    expect(edit).toContain("#/join/");
    expect(parseJoinToken(edit.split("#/join/")[1])).toEqual({ server: link.server, room: link.room, key: link.key, role: "edit" });
    expect(parseJoinToken(view.split("#/join/")[1])).toEqual({ server: link.server, room: link.room, key: link.viewKey, role: "view" });
    expect(edit).not.toBe(view);
  });

  it("copies a link, and says so", async () => {
    shared();
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Copy the edit link" }));
    expect(writeText).toHaveBeenCalledWith(field("Edit link").value);
    expect(await screen.findByRole("button", { name: "Copy the edit link" })).toHaveProperty("textContent", "Copied");
    await user.click(screen.getByRole("button", { name: "Copy the view link" }));
    expect(writeText).toHaveBeenLastCalledWith(field("View link").value);
  });

  it("tells the person when the link could not be copied, and selects it for them to copy by hand", async () => {
    shared();
    const user = userEvent.setup({ delay: null });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    render(<LiveSection />);
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    await user.click(screen.getByRole("button", { name: "Copy the edit link" }));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not be copied/));
    await user.click(field("Edit link"));
    expect(field("Edit link").selectionEnd).toBe(field("Edit link").value.length);
  });

  it("asks before it stops, and closes the room for everybody when it does", async () => {
    shared();
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    const ask = screen.getByRole("group", { name: "Stop sharing" });
    expect(within(ask).getByText(/Everybody is sent away/)).toBeTruthy();
    await user.click(within(ask).getByRole("button", { name: "Keep sharing" }));
    expect(screen.queryByRole("group", { name: "Stop sharing" })).toBeNull();
    expect(calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    await user.click(within(screen.getByRole("group", { name: "Stop sharing" })).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeUndefined());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `https://live.example.test/api/rooms/${made.room}`, init: { method: "DELETE", headers: { "x-craftly-key": made.ownerKey } } });
    expect(screen.getByRole("button", { name: "Start live session" })).toBeTruthy();
  });

  it("keeps the link and says why when the server cannot be asked to stop", async () => {
    shared();
    respond = () => {
      throw new TypeError("fetch failed");
    };
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    await user.click(screen.getByRole("button", { name: "Stop sharing" }));
    await user.click(within(screen.getByRole("group", { name: "Stop sharing" })).getByRole("button", { name: "Stop sharing" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/could not be stopped/));
    expect(useEditor.getState().design!.live).toEqual(link);
  });

  it("shows how the connection is", () => {
    shared();
    useLiveStatus.setState({ status: "live", reason: null, role: "edit" });
    render(<LiveSection />);
    expect(screen.getByText("Live")).toBeTruthy();
    act(() => useLiveStatus.setState({ status: "reconnecting" }));
    expect(screen.getByText("Reconnecting...")).toBeTruthy();
    act(() => useLiveStatus.setState({ status: "denied", reason: "no-access" }));
    expect(screen.getByText("Not allowed in")).toBeTruthy();
  });
});

describe("for somebody who was given a link", () => {
  it("is told what they may do, and leaving keeps the design as their own and does not close the room, even with a key that could", async () => {
    act(() => useEditor.getState().actions.setLiveLink({ server: link.server, room: link.room, key: link.key, role: "edit" })); // no key to look: not the one who started it
    const user = userEvent.setup({ delay: null });
    render(<LiveSection />);
    expect(screen.getByText(/editing this design together with the person who shared it/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Edit link" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText(/stays on this device as your own copy/)).toBeTruthy();
    await user.click(within(screen.getByRole("group", { name: "Stop sharing" })).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(useEditor.getState().design!.live).toBeUndefined());
    expect(calls).toEqual([]); // nothing was asked of the server
  });

  it("is told when they can only look", () => {
    act(() => useEditor.getState().actions.setLiveLink({ server: link.server, room: link.room, key: made.viewKey, role: "view" }));
    render(<LiveSection />);
    expect(screen.getByText("You can look at this design, not change it.")).toBeTruthy();
  });
});

describe("the state of the connection in the top bar", () => {
  it("is not there for a design that is not shared", () => {
    const { container } = render(<LiveBadge />);
    expect(container.textContent).toBe("");
  });

  it("says how the connection is, in the way a person would", () => {
    act(() => useEditor.getState().actions.setLiveLink(link));
    const { container } = render(<LiveBadge />);
    act(() => useLiveStatus.setState({ status: "connecting" }));
    expect(container.textContent).toBe("Connecting...");
    act(() => useLiveStatus.setState({ status: "live", role: "edit" }));
    expect(container.textContent).toBe("Live");
    expect(container.querySelector(".cf-live-badge--live")).toBeTruthy();
    act(() => useLiveStatus.setState({ status: "live", role: "view" }));
    expect(container.textContent).toBe("Live, view only");
    act(() => useLiveStatus.setState({ status: "off", role: null }));
    expect(container.textContent).toBe("Not connected");
  });

  it("has words for every state", () => {
    expect(liveStatusText("connecting", null)).toBe("Connecting...");
    expect(liveStatusText("reconnecting", "edit")).toBe("Reconnecting...");
    expect(liveStatusText("denied", null)).toBe("Not allowed in");
    expect(liveStatusText("closed", null)).toBe("Not connected");
  });
});

describe("the name the others see", () => {
  beforeEach(() => usePresence.setState({ name: "" }));

  it("is asked for where sharing starts, and is kept on this device as soon as it is typed", async () => {
    render(<LiveSection />);
    await userEvent.type(field("Your name"), "Ana");
    expect(localStorage.getItem("craftly.live.name")).toBe("Ana");
    expect(screen.getByRole("button", { name: "Start live session" })).toBeTruthy(); // and a name is not needed to start
  });

  it("can be changed while the design is shared, by the person who shares it and by one who was given a link", async () => {
    useEditor.getState().actions.setLiveLink(link);
    const owner = render(<LiveSection />);
    await userEvent.type(field("Your name"), "Bo");
    expect(localStorage.getItem("craftly.live.name")).toBe("Bo");
    owner.unmount();
    useEditor.getState().actions.setLiveLink({ server: link.server, room: link.room, key: link.key, role: "edit" });
    render(<LiveSection />);
    expect(field("Your name").value).toBe("Bo");
  });
});
