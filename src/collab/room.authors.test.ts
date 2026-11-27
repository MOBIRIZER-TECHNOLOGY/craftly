/**
 * Comments in a room whose people the server knows (a team's, joined with sessions: `join(..., name)`): what each person adds is
 * signed with their account's name, whatever their browser wrote, and the words of a comment or an answer are changed by its
 * author only. Resolving, moving and deleting stay open to every editor. A room joined with keys is as it was: people name
 * themselves there, and the server cannot tell them apart.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Design, DesignComment } from "@/core/types";
import type { Op } from "./ops";
import type { ServerMsg } from "./protocol";
import { NOT_YOUR_COMMENT, Room, type Peer } from "./room";

const start = (): Design => createDesign({ title: "Team", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
const author = (name: string) => ({ name, colorIndex: 1 });
const comment = (id: string, name: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: author(name),
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A person in the room: with `account`, joined as the server knows them (a session); without, with a key. */
function person(room: Room, client: string, account?: string) {
  const heard: ServerMsg[] = [];
  const peer: Peer = { send: (msg) => heard.push(wire(msg)) };
  room.join(peer, client, "edit", { comments: true }, account);
  const say = async (seq: number, ops: Op[]) => {
    await room.receive(peer, { t: "ops", seq, ops: wire(ops) });
    return heard.filter((m) => (m.t === "ack" || m.t === "rejected") && m.seq === seq).pop();
  };
  return { heard, say };
}

describe("comments in a room whose people are known", () => {
  it("signs a comment and an answer with the account's name, not the one the browser wrote, for everybody", async () => {
    const room = new Room(start());
    const bob = person(room, "bob-laptop", "Bob Lee");
    const ann = person(room, "ann-laptop", "Ann Wu");
    expect(await bob.say(1, [{ k: "comment.add", comment: comment("c1", "Ann Wu (owner)"), index: 0 }])).toMatchObject({ t: "ack" });
    expect(room.design.comments?.[0].author.name).toBe("Bob Lee");
    expect(await bob.say(2, [{ k: "reply.add", comment: "c1", reply: { id: "r1", author: author("Ann Wu"), createdAt: 2, text: "me too" }, index: 0 }])).toMatchObject({
      t: "ack",
    });
    expect(room.design.comments?.[0].replies[0].author.name).toBe("Bob Lee");
    // what Ann was sent is the signed one
    const told = ann.heard.filter((m) => m.t === "ops").flatMap((m) => (m.t === "ops" ? m.ops : []));
    expect(JSON.stringify(told)).not.toContain("Ann Wu (owner)");
    expect(JSON.stringify(told)).toContain("Bob Lee");
  });

  it("refuses a change to the words of somebody else's comment or answer, whole, and lets its author change them", async () => {
    const room = new Room(start());
    const ann = person(room, "ann-laptop", "Ann Wu");
    const bob = person(room, "bob-laptop", "Bob Lee");
    await ann.say(1, [{ k: "comment.add", comment: comment("c1", "Ann Wu"), index: 0 }]);
    await ann.say(2, [{ k: "reply.add", comment: "c1", reply: { id: "r1", author: author("Ann Wu"), createdAt: 2, text: "first" }, index: 0 }]);
    const rev = room.rev;
    expect(await bob.say(1, [{ k: "comment.set", id: "c1", set: { text: "Ann says: delete everything", editedAt: 3 } }])).toMatchObject({
      t: "rejected",
      reason: NOT_YOUR_COMMENT,
    });
    expect(
      await bob.say(2, [
        { k: "el.set", page: "p", id: "a", set: { x: 9 } },
        { k: "reply.set", comment: "c1", id: "r1", set: { text: "edited" } },
      ]),
    ).toMatchObject({
      t: "rejected",
      reason: NOT_YOUR_COMMENT,
    });
    expect(room.rev).toBe(rev);
    expect(room.design.comments?.[0].text).toBe("note c1");
    expect(await ann.say(3, [{ k: "comment.set", id: "c1", set: { text: "better words", editedAt: 4 } }])).toMatchObject({ t: "ack" });
    expect(room.design.comments?.[0].text).toBe("better words");
  });

  it("lets anybody who edits resolve a comment, move its pin and delete it", async () => {
    const room = new Room(start());
    const ann = person(room, "ann-laptop", "Ann Wu");
    const bob = person(room, "bob-laptop", "Bob Lee");
    await ann.say(1, [{ k: "comment.add", comment: comment("c1", "Ann Wu"), index: 0 }]);
    expect(await bob.say(1, [{ k: "comment.set", id: "c1", set: { resolved: true, anchor: { x: 5, y: 5 } } }])).toMatchObject({ t: "ack" });
    expect(room.design.comments?.[0]).toMatchObject({ resolved: true, anchor: { x: 5, y: 5 } });
    expect(await bob.say(2, [{ k: "comment.del", id: "c1" }])).toMatchObject({ t: "ack" });
    expect(room.design.comments ?? []).toHaveLength(0);
  });

  it("lets a person change the words of what they added earlier in the same batch", async () => {
    const room = new Room(start());
    const bob = person(room, "bob-laptop", "Bob Lee");
    expect(
      await bob.say(1, [
        { k: "comment.add", comment: comment("c1", "whoever"), index: 0 },
        { k: "comment.set", id: "c1", set: { text: "typo fixed", editedAt: 2 } },
      ]),
    ).toMatchObject({ t: "ack" });
    expect(room.design.comments?.[0]).toMatchObject({ text: "typo fixed", author: { name: "Bob Lee" } });
  });

  it("leaves a room joined with keys as it was: people name themselves, and anybody may edit words", async () => {
    const room = new Room(start());
    const ann = person(room, "ann");
    const bob = person(room, "bob");
    await ann.say(1, [{ k: "comment.add", comment: comment("c1", "Ann"), index: 0 }]);
    expect(room.design.comments?.[0].author.name).toBe("Ann");
    expect(await bob.say(1, [{ k: "comment.set", id: "c1", set: { text: "tidied", editedAt: 3 } }])).toMatchObject({ t: "ack" });
  });
});
