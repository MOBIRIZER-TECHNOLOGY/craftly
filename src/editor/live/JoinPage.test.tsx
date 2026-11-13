/**
 * The page that a link to a shared design opens: a link that is not one of ours, a link to a design that is already on this device,
 * a link to a new one (kept in the library with the link and opened), a link that does not work, and a person who goes away first.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { getDesign, saveDesign } from "@/core/library";
import type { Design, LiveLink } from "@/core/types";
import { clearLibrary } from "@/test/helpers";
import * as connection from "./connection";
import { findShared, saveJoined } from "./joined";
import { JoinPage } from "./JoinPage";
import { isKnownServer, rememberServer } from "./knownServers";
import { joinToken } from "./links";
import { usePresence } from "./presence";

vi.mock("./connection", async (original) => ({ ...(await original<typeof import("./connection")>()), joinDesign: vi.fn() }));

const link: LiveLink = { server: "https://live.example.test", room: "TW-FaxWt8edjpnT-bGQyjA", key: "WjGO30NJy5udhntaj-8j9w", role: "edit" };
const shared = (): Design => createDesign({ title: "Shared with you", width: 800, height: 600, pages: [createPage({ elements: [createShape("rect", { id: "a" })] })] });
const join = vi.mocked(connection.joinDesign);

beforeEach(async () => {
  await clearLibrary();
  localStorage.clear();
  join.mockReset();
  // the server of the link is one this person has dealt with: the question for a new one has tests of its own below
  rememberServer(link.server);
});

describe("a link that is not one of ours", () => {
  it("says so and offers the way home", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpen = vi.fn();
    render(<JoinPage token="this-is-not-a-token" onOpen={onOpen} />);
    expect(await screen.findByText(/not a link that Craftly made/)).toBeTruthy();
    expect(join).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(window.location.hash).toBe("#/");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("a link to a design that is not on this device yet", () => {
  it("connects, keeps a copy in the library that carries the link and what the key allows, and opens it", async () => {
    join.mockResolvedValue({ design: shared(), role: "view" });
    const onOpen = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    expect(screen.getByRole("status", { name: "Joining the shared design" })).toBeTruthy();
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    const id = onOpen.mock.calls[0][0] as string;
    const copy = (await getDesign(id))!;
    expect(copy).toMatchObject({ id, title: "Shared with you", starred: false, trashedAt: null, folderId: null, live: { ...link, role: "view" } });
    expect(copy.id).not.toBe(shared().id);
    expect(join).toHaveBeenCalledWith(link);
  });

  it("opens the same copy the next time, without connecting", async () => {
    join.mockResolvedValue({ design: shared(), role: "edit" });
    const first = vi.fn();
    const view = render(<JoinPage token={joinToken(link)} onOpen={first} />);
    await waitFor(() => expect(first).toHaveBeenCalled());
    view.unmount();
    join.mockClear();
    const second = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={second} />);
    await waitFor(() => expect(second).toHaveBeenCalledWith(first.mock.calls[0][0]));
    expect(join).not.toHaveBeenCalled();
  });

  it("makes a new copy when the one that was kept is in the trash or gone", async () => {
    join.mockResolvedValue({ design: shared(), role: "edit" });
    const first = vi.fn();
    const view = render(<JoinPage token={joinToken(link)} onOpen={first} />);
    await waitFor(() => expect(first).toHaveBeenCalled());
    view.unmount();
    const kept = (await getDesign(first.mock.calls[0][0] as string))!;
    await saveDesign({ ...kept, trashedAt: Date.now() });
    expect(await findShared(link)).toBeNull();
    const second = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={second} />);
    await waitFor(() => expect(second).toHaveBeenCalled());
    expect(second.mock.calls[0][0]).not.toBe(first.mock.calls[0][0]);
  });

  it("says why when the link does not work, and goes nowhere", async () => {
    join.mockRejectedValue(new Error("This shared design is no longer there."));
    const onOpen = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    expect(await screen.findByText("This shared design is no longer there.")).toBeTruthy();
    expect(screen.getByText("This shared design could not be opened")).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("says something even when what went wrong is not an error with a message", async () => {
    join.mockRejectedValue("nope");
    render(<JoinPage token={joinToken(link)} onOpen={vi.fn()} />);
    expect(await screen.findByText("The shared design could not be opened.")).toBeTruthy();
  });

  it("does nothing more when the person has gone away before the design arrived", async () => {
    let arrive: (v: { design: Design; role: "edit" }) => void = () => undefined;
    join.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const onOpen = vi.fn();
    const view = render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await waitFor(() => expect(join).toHaveBeenCalled());
    view.unmount();
    arrive({ design: shared(), role: "edit" });
    await new Promise((r) => setTimeout(r, 50));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("a link to a server that is new on this device", () => {
  beforeEach(() => localStorage.clear());
  const question = () => screen.findByRole("heading", { name: "Join this shared design?" });

  it("asks before it connects, names the server, and starts on the answer that changes nothing", async () => {
    const onOpen = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    expect(await question()).toBeTruthy();
    expect(screen.getByText(/This link connects to live\.example\.test, a server this device has not used before\./)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to home" })));
    expect(join).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(isKnownServer(link.server)).toBe(false);
  });

  it("joins when the person says so, and does not ask about that server again", async () => {
    join.mockResolvedValue({ design: shared(), role: "edit" });
    const onOpen = vi.fn();
    const first = render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await question();
    await userEvent.setup().click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(join).toHaveBeenCalledWith(link);
    expect(isKnownServer(link.server)).toBe(true);
    first.unmount();

    // another room of the same server: no question
    const other: LiveLink = { ...link, room: "AB-FaxWt8edjpnT-bGQyjB" };
    render(<JoinPage token={joinToken(other)} onOpen={onOpen} />);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Join this shared design?" })).toBeNull();
  });

  it("asks again when another link to another new server is opened after a join that failed, and no longer shows the old problem", async () => {
    join.mockRejectedValue(new Error("This shared design is no longer there."));
    const onOpen = vi.fn();
    const view = render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await question();
    await userEvent.setup().click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("This shared design is no longer there.")).toBeTruthy();
    expect(join).toHaveBeenCalledTimes(1);

    // the hash changes to a link of a server nobody said yes to: the page stays mounted and gets another token
    const elsewhere: LiveLink = { ...link, server: "https://other.example.test" };
    view.rerender(<JoinPage token={joinToken(elsewhere)} onOpen={onOpen} />);
    expect(await question()).toBeTruthy();
    expect(screen.getByText(/This link connects to other\.example\.test,/)).toBeTruthy();
    expect(screen.queryByText("This shared design is no longer there.")).toBeNull();
    expect(join).toHaveBeenCalledTimes(1);
    expect(isKnownServer(elsewhere.server)).toBe(false);
  });

  it("does not go on asking about the server of the link before when the next link leads to a server that is known", async () => {
    const onOpen = vi.fn();
    const view = render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await question();
    const known: LiveLink = { ...link, server: "https://known.example.test" };
    rememberServer(known.server);
    join.mockResolvedValue({ design: shared(), role: "edit" });
    view.rerender(<JoinPage token={joinToken(known)} onOpen={onOpen} />);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(join).toHaveBeenCalledWith(known);
    expect(screen.queryByRole("heading", { name: "Join this shared design?" })).toBeNull();
    expect(isKnownServer(link.server)).toBe(false);
  });

  it("goes home and connects to nothing when the person says no", async () => {
    window.location.hash = "#/join/x";
    render(<JoinPage token={joinToken(link)} onOpen={vi.fn()} />);
    await question();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to home" }));
    expect(window.location.hash).toBe("#/");
    expect(join).not.toHaveBeenCalled();
    expect(isKnownServer(link.server)).toBe(false);
  });

  it("does not ask for a design that was joined before: it is opened from the library", async () => {
    await saveJoined(shared(), link);
    const onOpen = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(join).not.toHaveBeenCalled();
  });
});

describe("the name the others will see", () => {
  beforeEach(() => {
    localStorage.clear();
    usePresence.setState({ name: "" });
  });

  it("is asked for with the question, is not needed to join, and is kept on this device", async () => {
    join.mockResolvedValue({ design: shared(), role: "edit" });
    const onOpen = vi.fn();
    render(<JoinPage token={joinToken(link)} onOpen={onOpen} />);
    await screen.findByRole("heading", { name: "Join this shared design?" });
    const name = screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement;
    expect(name.value).toBe("");
    const user = userEvent.setup();
    await user.type(name, "Ana");
    expect(localStorage.getItem("craftly.live.name")).toBe("Ana");
    await user.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });
});
