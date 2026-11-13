/**
 * One shared design on the server: the design as it stands, the revision it is at, and who is looking at it. Messages go in and
 * come out as values; sockets, files and clocks are the caller's (server/), so this runs the same in a test.
 *
 * Every batch of operations that a person who may edit sends is applied in the order it arrives, and gets the next revision. The
 * sender is told (`ack`) and everybody else is sent the same operations (`ops`), so all copies apply the same batches in the same
 * order and end up the same. A batch is numbered by its sender; a number that was seen before is answered but not applied again.
 *
 * WHAT IS REMEMBERED OF A CLIENT, AND FOR HOW LONG. To know a number that was seen before, the room keeps the last number it
 * applied for each client. A client is one page load, so that list would grow by one for every page load that ever edited, and
 * it is written with every save. It is bounded: a client that is not in the room and was last seen (joined, or had a batch
 * applied) more than `CLIENTS_KEPT_MS` ago is forgotten, and so are the ones seen longest ago when there are more than
 * `CLIENTS_KEPT`.
 *
 * Forgetting must never make a batch count twice. A forgotten client may come back and send again a batch that was applied (it
 * never heard the answer), and a room that simply had no entry for it would take that batch for new. So the room keeps one more
 * number, the floor: the highest last number of any client it ever forgot. A client it has no entry for is treated as one whose
 * last applied batch was the floor: it is welcomed with that number, and a batch of its numbered at or below it is answered and
 * not applied. Whatever a forgotten client had applied was numbered at or below its own last number, which is at or below the
 * floor, so none of it can be applied again; the floor never goes down and is saved in the same write that drops the entry.
 *
 * The price is paid by the forgotten client only: a batch of its that was sent and NOT applied before it went away for that
 * long is dropped too, because the room cannot tell the two apart. A client the room has never seen loses nothing: the welcome
 * tells it the floor, and a session counts on from there, renumbering what it has made and never sent (session.ts). A client
 * that is in the room is never forgotten, so its numbers always mean what they meant when it was welcomed.
 */
import type { Design } from "@/core/types";
import { applyOps } from "./ops";
import { canEdit, checkOps, checkSets, type ClientMsg, type Role, type ServerMsg } from "./protocol";

/** How long a client that is not in the room is remembered after it was last seen. */
export const CLIENTS_KEPT_MS = 30 * 24 * 60 * 60 * 1000;
/** The most clients a room remembers (those in the room are remembered whatever their number). */
export const CLIENTS_KEPT = 1000;

/** What a room remembers of its clients beside their last numbers (`seqs`), to be saved with them. */
export interface ClientMemory {
  /** When each client that has a last number was last seen, in milliseconds. A record from before this was kept has none. */
  seen?: Record<string, number>;
  /** The highest last number of any client that was forgotten: where a client the room does not know counts from. */
  floor?: number;
}

export interface RoomOptions extends ClientMemory {
  /** The time, in milliseconds; the host gives its clock. */
  now?: () => number;
  keepMs?: number;
  keepMost?: number;
}

/** Whatever receives what the room says to one connection. */
export interface Peer {
  send(msg: ServerMsg): void;
}

interface Member {
  client: string;
  role: Role;
}

export class Room {
  design: Design;
  rev: number;
  /** Called after a batch changed the design: where the host saves it. */
  onChange: ((room: Room) => void) | null = null;
  /** Saves what a batch made of the room, before the batch is acknowledged: the design, and what the room remembers of its clients. */
  commit?: (design: Design, rev: number, seqs: Record<string, number>, memory: Required<ClientMemory>) => Promise<void>;
  private members = new Map<Peer, Member>();
  private lastSeq = new Map<string, number>();
  private seen = new Map<string, number>();
  private floor: number;
  private now: () => number;
  private keepMs: number;
  private keepMost: number;

  constructor(design: Design, rev = 0, lastSeq: Record<string, number> = {}, options: RoomOptions = {}) {
    this.design = design;
    this.rev = rev;
    this.now = options.now ?? Date.now;
    this.keepMs = options.keepMs ?? CLIENTS_KEPT_MS;
    this.keepMost = options.keepMost ?? CLIENTS_KEPT;
    this.floor = Number.isSafeInteger(options.floor) && (options.floor as number) > 0 ? (options.floor as number) : 0;
    const opened = this.now();
    for (const [client, seq] of Object.entries(lastSeq)) {
      this.lastSeq.set(client, seq);
      // a record from before times were kept: the client counts as seen now, and is forgotten when it stays away from here on
      const at = options.seen && Object.hasOwn(options.seen, client) ? options.seen[client] : undefined;
      this.seen.set(client, typeof at === "number" && Number.isFinite(at) ? at : opened);
    }
  }

  get size(): number {
    return this.members.size;
  }

  /** The numbers of the last batch applied for each client, to be saved with the design. */
  seqs(): Record<string, number> {
    return Object.fromEntries(this.lastSeq);
  }

  /** What is remembered of the clients beside their numbers, to be saved with them. */
  memory(): Required<ClientMemory> {
    return { seen: Object.fromEntries(this.seen), floor: this.floor };
  }

  /** The last batch of a client that was applied; for a client the room has no entry for, the floor (see the top of this file). */
  private lastOf(client: string): number {
    return this.lastSeq.get(client) ?? this.floor;
  }

  /**
   * What the room remembers once the batch `seq` of `client` is applied: that number, and without the clients that have stayed
   * away for too long or are too many. Nothing of the room is changed here: the result is saved first and taken over after.
   */
  private remember(client: string, seq: number): { seqs: Map<string, number>; seen: Map<string, number>; floor: number } {
    const at = this.now();
    const seqs = new Map(this.lastSeq).set(client, seq);
    const seen = new Map(this.seen).set(client, at);
    let floor = this.floor;
    const here = new Set<string>();
    for (const member of this.members.values()) here.add(member.client);
    const forget = (name: string) => {
      floor = Math.max(floor, seqs.get(name) as number);
      seqs.delete(name);
      seen.delete(name);
    };
    for (const [name, last] of seen) if (!here.has(name) && at - last > this.keepMs) forget(name);
    while (seqs.size > this.keepMost) {
      let oldest: string | null = null;
      for (const [name, last] of seen) if (!here.has(name) && (oldest === null || last < (seen.get(oldest) as number))) oldest = name;
      if (oldest === null) break; // everybody left is in the room
      forget(oldest);
    }
    return { seqs, seen, floor };
  }

  /**
   * Lets a connection in: it is sent the design, the revision, and the last batch of its own that was applied. A client that comes
   * back on another connection replaces the old one, which is no longer told anything; the peers that were replaced are returned so
   * that the host can close them.
   */
  join(peer: Peer, client: string, role: Role): Peer[] {
    const replaced: Peer[] = [];
    for (const [other, member] of this.members) {
      if (member.client === client && other !== peer) {
        this.members.delete(other);
        replaced.push(other);
      }
    }
    this.members.set(peer, { client, role });
    if (this.lastSeq.has(client)) this.seen.set(client, this.now());
    peer.send({ t: "welcome", role, rev: this.rev, lastSeq: this.lastOf(client), design: this.design });
    return replaced;
  }

  leave(peer: Peer): void {
    this.members.delete(peer);
  }

  /** The peers that have joined, so the host can close the connection of a client that has come back on another. */
  peers(): Peer[] {
    return [...this.members.keys()];
  }

  receive(peer: Peer, msg: ClientMsg): void | Promise<void> {
    const member = this.members.get(peer);
    if (!member) return;
    if (msg.t === "ping") peer.send({ t: "pong" });
    else if (msg.t === "ops") return this.batch(peer, member, msg.seq, msg.ops);
    else if (msg.t === "join") this.join(peer, member.client, member.role); // a client that wants the design again
  }

  private batch(peer: Peer, member: Member, seq: number, raw: unknown): void | Promise<void> {
    if (!Number.isInteger(seq) || seq < 1) return void peer.send({ t: "rejected", seq: Number(seq) || 0, reason: "a batch needs a number" });
    if (!canEdit(member.role)) return void peer.send({ t: "rejected", seq, reason: "this link is read-only" });
    if (seq <= this.lastOf(member.client)) return void peer.send({ t: "ack", seq, rev: this.rev });
    const ops = checkOps(raw);
    if (typeof ops === "string") return void peer.send({ t: "rejected", seq, reason: ops });
    const next = applyOps(this.design, ops);
    // what the operations look like is fine; what they leave of the elements they changed is asked now that it is known
    const spoiled = checkSets(this.design, next, ops);
    if (spoiled) return void peer.send({ t: "rejected", seq, reason: spoiled });
    const kept = this.remember(member.client, seq);
    const publish = () => {
      this.design = next;
      this.rev++;
      // A client that joined while the save ran was welcomed with the number the room had for it then. If this batch forgot it,
      // it is kept after all: it is in the room now, and its numbers must go on meaning what its welcome said.
      for (const { client } of this.members.values()) {
        const last = this.lastSeq.get(client);
        if (last === undefined || kept.seqs.has(client)) continue;
        kept.seqs.set(client, last);
        kept.seen.set(client, this.seen.get(client) as number);
      }
      this.lastSeq = kept.seqs;
      this.seen = kept.seen;
      this.floor = kept.floor;
      peer.send({ t: "ack", seq, rev: this.rev });
      for (const other of this.members.keys()) if (other !== peer) other.send({ t: "ops", rev: this.rev, ops });
      this.onChange?.(this);
    };
    if (this.commit) return this.commit(next, this.rev + 1, Object.fromEntries(kept.seqs), { seen: Object.fromEntries(kept.seen), floor: kept.floor }).then(publish);
    publish();
  }
}
