/**
 * Comments between a room and its browsers, wired by hand (as sync.test.ts does): two people commenting at the same moment, an
 * older browser in a room with a newer one, a newer browser with an older server, and a server that cannot be trusted.
 */
import { describe, expect, it } from "vitest";
import { MAX_COMMENT_TEXT } from "@/core/comments";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { CommentReply, Design, DesignComment } from "@/core/types";
import type { Op } from "./ops";
import type { ClientMsg, Feature, Role, ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";
import { Session, withShared } from "./session";

const author = (name: string) => ({ name, colorIndex: name.length % 12 });
const comment = (id: string, extra: Partial<DesignComment> = {}): DesignComment => ({
  id,
  pageId: "p",
  anchor: { x: 1, y: 2 },
  author: author("Ann"),
  createdAt: 1,
  text: `note ${id}`,
  resolved: false,
  replies: [],
  ...extra,
});
const reply = (id: string, name = "Bob"): CommentReply => ({ id, author: author(name), createdAt: 3, text: `reply ${id}` });
const start = (comments?: DesignComment[]): Design => {
  const made = createDesign({ title: "Shared", width: 800, height: 600, pages: [createPage({ id: "p", elements: [createShape("rect", { id: "a" })] })] });
  return comments ? { ...made, comments } : made;
};
const ids = (d: Design | null | undefined) => (d?.comments ?? []).map((c) => c.id).sort();

/**
 * A browser with a manual wire. `features` is what its join says it understands: none is a browser from before comments.
 * `server` says how the room answers a join: "new" reads the features as this server does, "old" ignores them as a server from
 * before comments does (its welcome names none, and it passes every operation on to everybody).
 */
class Browser {
  session: Session;
  shown: Design;
  up: ClientMsg[] = [];
  down: ServerMsg[] = [];
  ended = false;
  peer: Peer = { send: (m) => this.down.push(JSON.parse(JSON.stringify(m)) as ServerMsg) };
  constructor(
    readonly room: Room,
    readonly id: string,
    readonly features: Feature[] = ["comments"],
    readonly server: "new" | "old" = "new",
    readonly role: Role = "edit",
  ) {
    this.session = new Session({ client: id, key: "k", send: (m) => this.up.push(m), features });
    this.shown = start();
    this.session.open();
    this.flush();
  }
  edit(fn: (d: Design) => Design) {
    const next = fn(this.shown);
    this.session.edit(this.shown, next);
    this.shown = next;
  }
  flush() {
    for (let guard = 0; guard < 100 && (this.up.length || this.down.length); guard++) {
      while (this.up.length) {
        const m = this.up.shift()!;
        if (m.t === "join") this.room.join(this.peer, this.id, this.role, this.server === "new" ? { comments: (m.features ?? []).includes("comments") } : undefined);
        else void this.room.receive(this.peer, m);
      }
      while (this.down.length) {
        const out = this.session.receive(this.down.shift()!);
        if (out.ended) this.ended = true;
        if (out.changed) this.shown = withShared(this.shown, this.session.design!, this.session.sharesComments);
      }
    }
  }
}

const addComment = (c: DesignComment) => (d: Design) => ({ ...d, comments: [...(d.comments ?? []), c] });
const onComment = (id: string, fn: (c: DesignComment) => DesignComment) => (d: Design) => ({ ...d, comments: (d.comments ?? []).map((c) => (c.id === id ? fn(c) : c)) });

describe("two people who comment at the same moment", () => {
  it("both keep their comment, everywhere", () => {
    const room = new Room(start());
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit(addComment(comment("from-ann")));
    bob.edit(addComment(comment("from-bob", { author: author("Bob") })));
    ann.flush();
    bob.flush();
    ann.flush();
    expect(ids(room.design)).toEqual(["from-ann", "from-bob"]);
    expect(ids(ann.shown)).toEqual(["from-ann", "from-bob"]);
    expect(ids(bob.shown)).toEqual(["from-ann", "from-bob"]);
  });

  it("keep both a reply and a resolve made at the same moment", () => {
    const room = new Room(start([comment("c")]));
    const [ann, bob] = [new Browser(room, "ann"), new Browser(room, "bob")];
    ann.edit(onComment("c", (c) => ({ ...c, resolved: true })));
    bob.edit(onComment("c", (c) => ({ ...c, replies: [...c.replies, reply("r")] })));
    ann.flush();
    bob.flush();
    ann.flush();
    for (const d of [room.design, ann.shown, bob.shown]) {
      expect(d.comments![0].resolved).toBe(true);
      expect(d.comments![0].replies.map((r) => r.id)).toEqual(["r"]);
    }
  });

  it("are both welcomed with the comments of the room, and the room keeps them in its design", () => {
    const room = new Room(start([comment("c", { replies: [reply("r")] })]));
    const ann = new Browser(room, "ann");
    expect(ann.session.sharesComments).toBe(true);
    expect(ann.shown.comments).toEqual([comment("c", { replies: [reply("r")] })]);
  });
});

describe("an older browser in a room with a newer one", () => {
  it("is welcomed with a design without comments, which it accepts", () => {
    const room = new Room(start([comment("c")]));
    const old = new Browser(room, "old", []);
    expect(old.ended).toBe(false);
    expect(old.session.status).toBe("live");
    expect(old.session.server!.comments).toBeUndefined();
  });

  it("is sent no comment operation, stays in step and is not ended, and its own edits still reach the newer one", () => {
    const room = new Room(start());
    const [ann, old] = [new Browser(room, "ann"), new Browser(room, "old", [])];
    const heard: Op[][] = [];
    const send = old.peer.send;
    old.peer.send = (m) => {
      if (m.t === "ops") heard.push(m.ops);
      send(m);
    };
    ann.edit(addComment(comment("c")));
    ann.edit((d) => ({ ...d, title: "Renamed" }));
    ann.flush();
    old.flush();
    expect(heard).toEqual([[], [{ k: "design", set: { title: "Renamed" } }]]);
    expect(old.ended).toBe(false);
    expect(old.session.rev).toBe(room.rev);
    expect(old.shown.title).toBe("Renamed");
    old.edit((d) => ({ ...d, title: "From the old one" }));
    old.flush();
    ann.flush();
    expect(ann.shown.title).toBe("From the old one");
    expect(ids(ann.shown)).toEqual(["c"]);
    expect(ids(room.design)).toEqual(["c"]);
  });

  it("is still not sent comments when it asks for the design again", () => {
    const room = new Room(start([comment("c")]));
    const old = new Browser(room, "old", []);
    void room.receive(old.peer, { t: "join", client: "old", key: "k" });
    const welcome = old.down.find((m) => m.t === "welcome");
    expect(welcome && "design" in welcome ? welcome.design.comments : "none").toBeUndefined();
  });
});

describe("a newer browser with an older server", () => {
  it("keeps its comments on its own copy, sends none of them, and still sends everything else", () => {
    const room = new Room(start());
    const ann = new Browser(room, "ann", ["comments"], "old");
    expect(ann.session.sharesComments).toBe(false);
    ann.edit(addComment(comment("mine")));
    expect(ann.up).toEqual([]);
    expect(ann.session.pending).toBe(0);
    ann.edit((d) => ({ ...d, title: "Renamed" }));
    ann.flush();
    expect(room.design.title).toBe("Renamed");
    expect(room.design.comments).toBeUndefined();
    expect(ids(ann.shown)).toEqual(["mine"]);
  });

  it("does not show comments that such a server holds from the design that made the room, and its own stay", () => {
    const room = new Room(start([comment("frozen")]));
    const ann = new Browser(room, "ann", ["comments"], "old");
    expect(ann.session.server!.comments).toBeUndefined();
    ann.edit(addComment(comment("mine")));
    room.design = { ...room.design, title: "Moved on" };
    void room.receive(ann.peer, { t: "join", client: "ann", key: "k" });
    ann.flush();
    expect(ids(ann.shown)).toEqual(["mine"]);
  });

  it("gives up the comments it made while it was away when the server turns out not to share them", () => {
    const room = new Room(start());
    const session = new Session({ client: "ann", key: "k", send: () => undefined, features: ["comments"] });
    session.edit(start(), addComment(comment("offline"))(start()));
    expect(session.pending).toBe(1);
    session.receive({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: room.design });
    expect(session.pending).toBe(0);
  });
});

describe("a server that cannot be trusted", () => {
  const welcomed = () => {
    const session = new Session({ client: "me", key: "k", send: () => undefined, features: ["comments"] });
    session.open();
    session.receive({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: start(), features: ["comments"] });
    return session;
  };

  it("may send comments with text that looks like code: it stays text", () => {
    const session = welcomed();
    const text = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const out = session.receive({ t: "ops", rev: 1, ops: [{ k: "comment.add", comment: comment("c", { text }), index: 0 }] });
    expect(out.ended).toBeNull();
    expect(session.design!.comments![0].text).toBe(text);
  });

  it("ends the session when it sends a comment that is too long or has an id that is not one", () => {
    for (const bad of [comment("c", { text: "x".repeat(MAX_COMMENT_TEXT + 1) }), comment("../c")]) {
      const session = welcomed();
      expect(session.receive({ t: "ops", rev: 1, ops: [{ k: "comment.add", comment: bad, index: 0 }] }).ended).toBe("invalid");
    }
  });

  it("is not believed about comments it was not asked about: a browser that did not say it understands them keeps none", () => {
    const session = new Session({ client: "me", key: "k", send: () => undefined });
    session.open();
    session.receive({ t: "welcome", role: "edit", rev: 0, lastSeq: 0, design: start([comment("c")]), features: ["comments"] });
    expect(session.sharesComments).toBe(false);
    expect(session.server!.comments).toBeUndefined();
    session.receive({ t: "ops", rev: 1, ops: [{ k: "comment.add", comment: comment("d"), index: 0 }] });
    expect(session.server!.comments).toBeUndefined();
    expect(session.rev).toBe(1);
  });
});

describe("the join of a browser", () => {
  it("says what it understands when it was told, and nothing more when it was not", () => {
    const said: ClientMsg[] = [];
    new Session({ client: "me", key: "k", send: (m) => said.push(m), features: ["comments"] }).open();
    new Session({ client: "me", key: "k", send: (m) => said.push(m) }).open();
    expect(said).toEqual([
      { t: "join", client: "me", key: "k", features: ["comments"] },
      { t: "join", client: "me", key: "k" },
    ]);
  });
});

describe("what a design takes from a shared one", () => {
  it("takes the comments only from a server that shares them, and keeps its own otherwise", () => {
    const local = start([comment("mine")]);
    const shared = { ...start([comment("theirs")]), pages: local.pages };
    expect(ids(withShared(local, shared, true))).toEqual(["theirs"]);
    expect(ids(withShared(local, shared, false))).toEqual(["mine"]);
    expect(ids(withShared(local, shared))).toEqual(["mine"]);
    expect("comments" in withShared(local, { ...shared, comments: undefined as never }, true)).toBe(false);
    expect(withShared(local, { ...local }, true)).toBe(local);
  });
});
