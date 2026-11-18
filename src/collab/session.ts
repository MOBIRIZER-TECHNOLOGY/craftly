/**
 * One browser's side of a shared design: what the server has confirmed, the changes this browser has made that the server has not
 * confirmed yet (in the order it made them, numbered), and the design to show, which is the first with the second replayed on top.
 * When something arrives from the server, the confirmed design moves on and the unconfirmed changes are replayed on it, so a change
 * of someone else lands in the middle of this person's work without taking it away, and a change of this person's that the server
 * refuses simply disappears. Messages go in and out as values; the socket, the reconnect timer and the store are the caller's.
 *
 * What the server says is not taken for granted: a link names the server and anybody can make a link. Every message is read with
 * `parseServerMsg` before any of it is used, and the first that cannot be used ends the session.
 */
import { withoutComments } from "@/core/comments";
import type { Design } from "@/core/types";
import { applyOps, diffDesign, isCommentOp, type Op } from "./ops";
import type { PresenceHeard } from "./presence";
import { checkSets, COMMENTS, parseServerMsg, type ClientMsg, type DeniedReason, type Feature, type Role, type ServerMsg } from "./protocol";

export type SessionStatus = "offline" | "joining" | "live" | "ended";

export interface SessionOptions {
  /** Names this page load to the server, which numbers its batches by it. */
  client: string;
  /** What lets this browser in: shown in the first message of every connection, never in an address. */
  key: string;
  /**
   * A session of an account in place of the key: what a member shows in a room bound to a design of their team (docs/ACCOUNTS.md).
   * The join then carries no key at all.
   */
  session?: string;
  send(msg: ClientMsg): void;
  outbox?: Outbox;
  onOutbox?(outbox: Outbox): void;
  /** What this browser says in its join that it understands (protocol.ts); none is a browser that shares only what every version does. */
  features?: Feature[];
}

/** What a message from the server means to whoever shows the design. */
export interface Outcome {
  /** The design to show is different now. */
  changed: boolean;
  /** The server turned this browser away, or the room is gone, or it said something that cannot be used: there is nothing more to do here. */
  ended: DeniedReason | null;
  /** The server let this browser in: the design is there. */
  joined?: boolean;
  rejected?: string;
  /** Where another person is, or that they have gone (presence.ts): read like everything else, and no part of the design. */
  presence?: PresenceHeard;
}

const NOTHING: Outcome = { changed: false, ended: null };

export interface Outbox {
  client: string;
  nextSeq: number;
  queue: Batch[];
  /**
   * The highest number of a batch that was ever handed to a connection under this name: such a batch may have been applied.
   * What an older version kept does not say; everything it numbered is then taken as sent.
   */
  sent?: number;
}

interface Batch {
  seq: number;
  ops: Op[];
}

export class Session {
  status: SessionStatus = "offline";
  role: Role | null = null;
  /** The number the server gave this connection, under which the others hear of this person; null without a connection, and with a server that gives none. */
  peer: number | null = null;
  /** The name the server hears this person under whatever this browser says (an account's), from its welcome; null for none. */
  name: string | null = null;
  rev = 0;
  /**
   * Whether comments are shared with this server: this browser said in its join that it understands them and the welcome said
   * that the server supports them. Until then, and with a server from before comments, they are this person's own: none is sent
   * (the operations are taken out of every batch) and none that the server holds is shown (docs/COLLABORATION.md, "Comments").
   */
  sharesComments = false;
  /** The design as the server has it, as far as this browser has heard. */
  server: Design | null = null;
  private queue: Batch[] = [];
  private nextSeq = 1;
  /**
   * The highest number of a batch that was handed to a connection under this name. A batch above it has never left this browser,
   * so the server cannot have applied it, whatever number the server says it counts from (see `welcome`).
   */
  private sent = 0;
  private shown: Design | null = null;

  constructor(private opts: SessionOptions) {
    if (opts.outbox) {
      this.queue = opts.outbox.queue;
      this.nextSeq = opts.outbox.nextSeq;
      const sent = opts.outbox.sent;
      this.sent = typeof sent === "number" && Number.isSafeInteger(sent) && sent >= 0 ? sent : this.nextSeq - 1;
    }
  }

  private persist(): void {
    this.opts.onOutbox?.({ client: this.opts.client, nextSeq: this.nextSeq, queue: this.queue, sent: this.sent });
  }

  /** The design to show: the server's, with this browser's unconfirmed changes on top. */
  get design(): Design | null {
    if (!this.server) return null;
    return (this.shown ??= this.queue.reduce((d, batch) => applyOps(d, batch.ops), this.server));
  }

  /** How many changes of this browser the server has not confirmed. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * The design as it is once the batch with this number has been applied, without the batches made after it: what has to be ready
   * (its images uploaded) before that batch is sent. Null when the batch no longer waits to be confirmed.
   */
  designAt(seq: number): Design | null {
    if (!this.server || !this.queue.some((b) => b.seq === seq)) return null;
    return this.queue.reduce((d, batch) => (batch.seq <= seq ? applyOps(d, batch.ops) : d), this.server);
  }

  /** Gives up a batch that was refused or cannot be sent: it is no longer shown or sent again. False when it was not waiting. */
  drop(seq: number): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((b) => b.seq !== seq);
    if (before === this.queue.length) return false;
    this.shown = null;
    this.persist();
    return true;
  }

  /**
   * Goes on under another name. The batches that wait keep their numbers and are sent again under the new name, of which the
   * server has seen none, so nothing that was not confirmed is lost.
   */
  rename(client: string): void {
    this.opts = { ...this.opts, client };
    this.sent = 0;
    this.persist();
  }

  /** The connection is open: ask for the design. */
  open(): void {
    if (this.status === "ended") return;
    this.status = "joining";
    this.join();
  }

  /** Asks for the design, saying what this browser understands when it understands more than every version does. */
  private join(): void {
    const features = this.opts.features ?? [];
    const credential = this.opts.session ? { session: this.opts.session } : { key: this.opts.key };
    this.opts.send(features.length ? { t: "join", client: this.opts.client, ...credential, features } : { t: "join", client: this.opts.client, ...credential });
  }

  /** What of a batch goes to this server: without the comment operations when it does not share comments. */
  private forServer(ops: Op[]): Op[] {
    return this.sharesComments ? ops : ops.filter((op) => !isCommentOp(op));
  }

  /** The connection is gone; whatever was not confirmed is kept and sent again when there is another. */
  close(): void {
    this.peer = null;
    this.name = null;
    if (this.status !== "ended") this.status = "offline";
  }

  /** A change this person made, as the design before and after it: queued, and sent when there is a connection. */
  edit(before: Design, after: Design): void {
    if (this.status === "ended" || this.role === "view") return;
    // (before the first welcome it is not known whether comments are shared: they wait with the rest, and the welcome decides)
    const all = diffDesign(before, after);
    const ops = this.status === "live" ? this.forServer(all) : all;
    if (!ops.length) return;
    const batch = { seq: this.nextSeq++, ops };
    this.queue.push(batch);
    // (noted as sent before it is kept for a reload: a batch that is on its way must never be kept as one that never left)
    if (this.status === "live") this.sent = batch.seq;
    this.persist();
    this.shown = null;
    if (this.status === "live") this.opts.send({ t: "ops", seq: batch.seq, ops });
  }

  /** What the server said, as it came over the wire: nothing of it is used before it has been read. */
  receive(raw: unknown): Outcome {
    if (this.status === "ended") return NOTHING; // for good: a closing socket still delivers what was on its way, and none of it is believed
    const msg = parseServerMsg(raw);
    if (msg === null) return NOTHING; // a kind of message that a newer server may send and this version does not know
    if (typeof msg === "string") return this.refuse();
    switch (msg.t) {
      case "welcome":
        return this.welcome(msg);
      case "denied":
        this.status = "ended";
        return { changed: false, ended: msg.reason };
      case "pong":
        return NOTHING;
      case "presence":
        return { changed: false, ended: null, presence: msg };
    }
    if (this.status !== "live" || !this.server) return NOTHING; // what was said before the design arrived is in the design
    switch (msg.t) {
      case "ack":
        return this.ack(msg.seq, msg.rev);
      case "rejected":
        return this.drop(msg.seq) ? { changed: true, ended: null, rejected: msg.reason } : NOTHING;
      case "ops": {
        if (msg.rev <= this.rev) return NOTHING; // heard already
        if (msg.rev !== this.rev + 1) return this.resync(); // one was missed
        // (comments that this browser did not agree to share with this server are not taken from it either)
        const ops = this.forServer(msg.ops);
        const next = applyOps(this.server, ops);
        // each operation has the form it should (parseServerMsg); what they leave of the elements they changed is asked here,
        // as the server asks it of a batch: a server that sends `x: "a"` for a shape is not a Craftly server
        if (checkSets(this.server, next, ops)) return this.refuse();
        this.server = next;
        this.rev = msg.rev;
        this.shown = null;
        return { changed: true, ended: null };
      }
    }
  }

  private welcome(msg: Extract<ServerMsg, { t: "welcome" }>): Outcome {
    this.role = msg.role;
    this.peer = msg.peer ?? null;
    this.name = msg.name ?? null;
    this.sharesComments = (this.opts.features ?? []).includes(COMMENTS) && (msg.features ?? []).includes(COMMENTS);
    // A server that does not share comments may still hold some, from the design that made its room: they are frozen there, and
    // are not shown. What this browser made of comments while it waited stays on its own copy, and is not sent.
    this.server = this.sharesComments ? msg.design : withoutComments(msg.design);
    if (!this.sharesComments) this.queue = this.queue.map((b) => ({ seq: b.seq, ops: this.forServer(b.ops) })).filter((b) => b.ops.length > 0);
    this.rev = msg.rev;
    this.status = "live";
    // What the server has already applied is in the design it sent; the rest goes again, in order. The server counts this client
    // from `lastSeq`: a batch at or below it that was sent may have been applied, and is given up. A batch that was never sent
    // cannot have been applied. Its number can still be at or below `lastSeq`, because a room that no longer remembers every
    // client counts one it does not know from above all it forgot (room.ts), and this browser may be new to it, or has gone on
    // under a new name. Such batches get the numbers after `lastSeq`, in their order, and nothing a person made is lost.
    const sent = this.sent;
    this.queue = this.queue.filter((b) => b.seq > msg.lastSeq || b.seq > sent);
    if (this.queue.some((b) => b.seq <= msg.lastSeq)) {
      // (every batch that is left was never sent: one that was sent and is left is above `lastSeq`, and so is all after it)
      let seq = msg.lastSeq;
      this.queue = this.queue.map((b) => ({ seq: ++seq, ops: b.ops }));
      this.nextSeq = seq + 1;
    }
    this.nextSeq = Math.max(this.nextSeq, msg.lastSeq + 1);
    // all of it is sent below, and is kept for a reload as sent before the first of it leaves
    if (this.queue.length) this.sent = Math.max(this.sent, this.queue[this.queue.length - 1].seq);
    this.persist();
    this.shown = null;
    for (const batch of this.queue) this.opts.send({ t: "ops", seq: batch.seq, ops: batch.ops });
    return { changed: true, ended: null, joined: true };
  }

  /** What arrived cannot have come from a Craftly server: none of it is used, and this server is not to be believed again. */
  private refuse(): Outcome {
    this.status = "ended";
    return { changed: false, ended: "invalid" };
  }

  private ack(seq: number, rev: number): Outcome {
    const first = this.queue[0];
    if (!first || first.seq !== seq || rev !== this.rev + 1 || !this.server) return first?.seq === seq || rev > this.rev ? this.resync() : NOTHING;
    // the server applied it after everything this browser has heard, so it joins the confirmed design; what is shown does not change
    this.server = applyOps(this.server, first.ops);
    this.queue.shift();
    this.persist();
    this.rev = rev;
    return NOTHING;
  }

  /** Something does not add up: ask for the design again. */
  private resync(): Outcome {
    this.status = "joining";
    this.join();
    return NOTHING;
  }
}

/**
 * The shared parts of `shared` laid over a design of this person's own library: the same design when they are the same already.
 * `comments`: whether the comments are shared with this server (`Session.sharesComments`); when they are not, this person's own
 * comments stay as they are.
 */
export function withShared(local: Design, shared: Design, comments = false): Design {
  if (
    local.pages === shared.pages &&
    local.title === shared.title &&
    local.width === shared.width &&
    local.height === shared.height &&
    local.unit === shared.unit &&
    local.typeId === shared.typeId &&
    local.guides === shared.guides &&
    (!comments || local.comments === shared.comments)
  )
    return local;
  const { guides: _guides, comments: own, ...rest } = local;
  const kept = comments ? shared.comments : own;
  return {
    ...rest,
    title: shared.title,
    typeId: shared.typeId,
    width: shared.width,
    height: shared.height,
    unit: shared.unit,
    pages: shared.pages,
    ...(shared.guides ? { guides: shared.guides } : {}),
    ...(kept ? { comments: kept } : {}),
  };
}
