/**
 * One shared design on the server: the design as it stands, the revision it is at, and who is looking at it. Messages go in and
 * come out as values; sockets, files and clocks are the caller's (server/), so this runs the same in a test.
 *
 * Every batch of operations that a person who may edit sends is applied in the order it arrives, and gets the next revision. The
 * sender is told (`ack`) and everybody else is sent the same operations (`ops`), so all copies apply the same batches in the same
 * order and end up the same. A batch is numbered by its sender; a number that was seen before is answered but not applied again.
 */
import type { Design } from "@/core/types";
import { applyOps } from "./ops";
import { canEdit, checkOps, type ClientMsg, type Role, type ServerMsg } from "./protocol";

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
  private members = new Map<Peer, Member>();
  private lastSeq = new Map<string, number>();

  constructor(design: Design, rev = 0, lastSeq: Record<string, number> = {}) {
    this.design = design;
    this.rev = rev;
    for (const [client, seq] of Object.entries(lastSeq)) this.lastSeq.set(client, seq);
  }

  get size(): number {
    return this.members.size;
  }

  /** The numbers of the last batch applied for each client, to be saved with the design. */
  seqs(): Record<string, number> {
    return Object.fromEntries(this.lastSeq);
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
    peer.send({ t: "welcome", role, rev: this.rev, lastSeq: this.lastSeq.get(client) ?? 0, design: this.design });
    return replaced;
  }

  leave(peer: Peer): void {
    this.members.delete(peer);
  }

  /** The peers that have joined, so the host can close the connection of a client that has come back on another. */
  peers(): Peer[] {
    return [...this.members.keys()];
  }

  receive(peer: Peer, msg: ClientMsg): void {
    const member = this.members.get(peer);
    if (!member) return;
    if (msg.t === "ping") peer.send({ t: "pong" });
    else if (msg.t === "ops") this.batch(peer, member, msg.seq, msg.ops);
    else if (msg.t === "join") this.join(peer, member.client, member.role); // a client that wants the design again
  }

  private batch(peer: Peer, member: Member, seq: number, raw: unknown): void {
    if (!Number.isInteger(seq) || seq < 1) return void peer.send({ t: "rejected", seq: Number(seq) || 0, reason: "a batch needs a number" });
    if (!canEdit(member.role)) return void peer.send({ t: "rejected", seq, reason: "this link is read-only" });
    if (seq <= (this.lastSeq.get(member.client) ?? 0)) return void peer.send({ t: "ack", seq, rev: this.rev });
    const ops = checkOps(raw);
    if (typeof ops === "string") return void peer.send({ t: "rejected", seq, reason: ops });
    this.design = applyOps(this.design, ops);
    this.rev++;
    this.lastSeq.set(member.client, seq);
    peer.send({ t: "ack", seq, rev: this.rev });
    for (const other of this.members.keys()) if (other !== peer) other.send({ t: "ops", rev: this.rev, ops });
    this.onChange?.(this);
  }
}
