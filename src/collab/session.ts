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
import type { Design } from "@/core/types";
import { applyOps, diffDesign, type Op } from "./ops";
import { parseServerMsg, type ClientMsg, type DeniedReason, type Role, type ServerMsg } from "./protocol";

export type SessionStatus = "offline" | "joining" | "live" | "ended";

export interface SessionOptions {
  /** Names this page load to the server, which numbers its batches by it. */
  client: string;
  /** What lets this browser in: shown in the first message of every connection, never in an address. */
  key: string;
  send(msg: ClientMsg): void;
  outbox?: Outbox;
  onOutbox?(outbox: Outbox): void;
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
}

const NOTHING: Outcome = { changed: false, ended: null };

export interface Outbox {
  client: string;
  nextSeq: number;
  queue: Batch[];
}

interface Batch {
  seq: number;
  ops: Op[];
}

export class Session {
  status: SessionStatus = "offline";
  role: Role | null = null;
  rev = 0;
  /** The design as the server has it, as far as this browser has heard. */
  server: Design | null = null;
  private queue: Batch[] = [];
  private nextSeq = 1;
  private shown: Design | null = null;

  constructor(private opts: SessionOptions) {
    if (opts.outbox) {
      this.queue = opts.outbox.queue;
      this.nextSeq = opts.outbox.nextSeq;
    }
  }

  private persist(): void {
    this.opts.onOutbox?.({ client: this.opts.client, nextSeq: this.nextSeq, queue: this.queue });
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
    this.persist();
  }

  /** The connection is open: ask for the design. */
  open(): void {
    if (this.status === "ended") return;
    this.status = "joining";
    this.opts.send({ t: "join", client: this.opts.client, key: this.opts.key });
  }

  /** The connection is gone; whatever was not confirmed is kept and sent again when there is another. */
  close(): void {
    if (this.status !== "ended") this.status = "offline";
  }

  /** A change this person made, as the design before and after it: queued, and sent when there is a connection. */
  edit(before: Design, after: Design): void {
    if (this.status === "ended" || this.role === "view") return;
    const ops = diffDesign(before, after);
    if (!ops.length) return;
    const batch = { seq: this.nextSeq++, ops };
    this.queue.push(batch);
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
        this.server = applyOps(this.server, msg.ops);
        this.rev = msg.rev;
        this.shown = null;
        return { changed: true, ended: null };
      }
    }
  }

  private welcome(msg: Extract<ServerMsg, { t: "welcome" }>): Outcome {
    this.role = msg.role;
    this.server = msg.design;
    this.rev = msg.rev;
    this.status = "live";
    // what the server has already applied is in the design it sent; the rest goes again, in order
    this.queue = this.queue.filter((b) => b.seq > msg.lastSeq);
    this.nextSeq = Math.max(this.nextSeq, msg.lastSeq + 1);
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
    this.opts.send({ t: "join", client: this.opts.client, key: this.opts.key });
    return NOTHING;
  }
}

/** The shared parts of `shared` laid over a design of this person's own library: the same design when they are the same already. */
export function withShared(local: Design, shared: Design): Design {
  if (
    local.pages === shared.pages &&
    local.title === shared.title &&
    local.width === shared.width &&
    local.height === shared.height &&
    local.unit === shared.unit &&
    local.typeId === shared.typeId &&
    local.guides === shared.guides
  )
    return local;
  const { guides: _guides, ...rest } = local;
  return {
    ...rest,
    title: shared.title,
    typeId: shared.typeId,
    width: shared.width,
    height: shared.height,
    unit: shared.unit,
    pages: shared.pages,
    ...(shared.guides ? { guides: shared.guides } : {}),
  };
}
