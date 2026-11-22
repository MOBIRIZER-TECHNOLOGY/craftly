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
import { withoutComments } from "@/core/comments";
import { withoutReview } from "@/core/review";
import type { Design, DesignComment } from "@/core/types";
import { applyOps, isCommentOp, isReviewOp, jsonEqual, type Op } from "./ops";
import { checkPresence, PRESENCE_STALE_MS, type PresenceState } from "./presence";
import { canEdit, checkOps, checkSets, COMMENTS, REVIEW, type ClientMsg, type Feature, type Role, type ServerMsg } from "./protocol";
import { seatProblem, type Restorable } from "./seats";

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
  /** How many comments that left the room it remembers (`GONE_KEPT`). */
  goneKept?: number;
}

/** Whatever receives what the room says to one connection. */
export interface Peer {
  send(msg: ServerMsg): void;
}

interface Member {
  client: string;
  role: Role;
  /** The number of this connection in the room, under which the others hear where this person is. */
  peer: number;
  /** Where this person last said they are, and when; null until they say it. In memory only: it is never saved. */
  presence: PresenceState | null;
  heard: number;
  /** Whether this browser said in its join that it understands comments: one that did not is sent nothing of them. */
  comments: boolean;
  /** The same for reviews (docs/REVIEW.md): one that did not is sent no review, and is never given the role `comment`. */
  review: boolean;
  /** The account of a seat of a bound room joined with a session, which `seatProblem` checks what it writes against. */
  account?: SeatAccount;
  /**
   * The name the others hear for this person whatever their browser says: their account's, for a seat of a bound room joined with
   * a session (the server knows who it is). Undefined for a join with a key, whose person names themselves.
   */
  name?: string;
}

/** What a browser said in its join that it understands (`joinFeatures` in protocol.ts reads it). */
export interface JoinFeatures {
  comments?: boolean;
  review?: boolean;
}

/** Who a seat of a bound room is: the account's id, and whether it is an owner of the room's space (who may delete any comment). */
export interface SeatAccount {
  id: string;
  owner: boolean;
}

export class Room {
  design: Design;
  rev: number;
  /** Called after a batch changed the design: where the host saves it. */
  onChange: ((room: Room) => void) | null = null;
  /** Saves what a batch made of the room, before the batch is acknowledged: the design, and what the room remembers of its clients. */
  commit?: (design: Design, rev: number, seqs: Record<string, number>, memory: Required<ClientMemory>) => Promise<void>;
  private members = new Map<Peer, Member>();
  /**
   * The comments that left this room (a page deleted with them, or deleted alone), by id, whole, as they left: a comment that comes
   * back with its page in a team's room keeps its authors only when it is exactly one of these, its text, pin, times, state and
   * every reply included (src/collab/seats.ts). In memory only, and at most `GONE_KEPT`: an undo after the room was let go brings the
   * page back and refuses its comments.
   */
  private gone = new Map<string, DesignComment>();
  private lastSeq = new Map<string, number>();
  private seen = new Map<string, number>();
  private floor: number;
  private numbered = 0;
  private now: () => number;
  private keepMs: number;
  private keepMost: number;
  private goneKept: number;

  constructor(design: Design, rev = 0, lastSeq: Record<string, number> = {}, options: RoomOptions = {}) {
    this.design = design;
    this.rev = rev;
    this.now = options.now ?? Date.now;
    this.keepMs = options.keepMs ?? CLIENTS_KEPT_MS;
    this.keepMost = options.keepMost ?? CLIENTS_KEPT;
    this.goneKept = options.goneKept ?? GONE_KEPT;
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
   * `base` is what the room would remember before it: the room as it is, or as the batches before this one in a group leave it.
   */
  private remember(client: string, seq: number, base: Memory): Memory {
    const at = this.now();
    const seqs = new Map(base.seqs).set(client, seq);
    const seen = new Map(base.seen).set(client, at);
    let floor = base.floor;
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
   * that the host can close them. `name`, when given, is the name the others hear for this person, over the one their browser says
   * (an account's, `Member.name`), and `account` who the seat is (`Member.account`). A browser that does not understand reviews is
   * let in to look where it would comment: it would refuse a role it does not know.
   */
  join(peer: Peer, client: string, role: Role, features?: JoinFeatures, name?: string, account?: SeatAccount): Peer[] {
    const replaced: Peer[] = [];
    for (const [other, member] of this.members) {
      if (member.client === client && other !== peer) {
        this.drop(other, member);
        replaced.push(other);
      }
    }
    // a connection that asks for the design again keeps its number, what it said about where it is, and what it understands
    const had = this.members.get(peer);
    const comments = features ? features.comments === true : (had?.comments ?? false);
    const review = features ? features.review === true : (had?.review ?? false);
    const fixed = name ?? had?.name;
    const seated = role === "comment" && !review ? "view" : role;
    const member: Member = { client, role: seated, peer: had?.peer ?? ++this.numbered, presence: had?.presence ?? null, heard: had?.heard ?? 0, comments, review };
    if (fixed !== undefined) member.name = fixed;
    const who = account ?? had?.account;
    if (who) member.account = who;
    this.members.set(peer, member);
    if (this.lastSeq.has(client)) this.seen.set(client, this.now());
    // A browser that understands comments is told that they are shared here, and is sent them with the design. One that did not
    // say so is from before comments: it is sent the design without them (it would keep a copy it can never bring up to date)
    // and no comment operation later (`batch`), and is told of no feature, as a server from before features would tell it none.
    // (the same for reviews: one that did not name them is sent the design without its review, and no review operation later)
    const shown = comments ? this.design : withoutComments(this.design);
    const named: Feature[] = [];
    if (comments) named.push(COMMENTS);
    if (review) named.push(REVIEW);
    const welcome: ServerMsg = {
      t: "welcome",
      role: seated,
      rev: this.rev,
      lastSeq: this.lastOf(client),
      design: review ? shown : withoutReview(shown),
      peer: member.peer,
      // the name the others hear for this person is the one it is shown under itself (an account's: `present`)
      ...(member.name ? { name: member.name } : {}),
    };
    peer.send(named.length ? { ...welcome, features: named } : welcome);
    // where the others are, as each last said it: without this a newcomer would see nobody until they move
    const at = this.now();
    for (const other of this.members.values()) {
      if (other === member || !other.presence) continue;
      // (somebody who fell silent is no longer the one who types in a text box: see `present`)
      const fresh = at - other.heard <= PRESENCE_STALE_MS;
      peer.send({ t: "presence", peer: other.peer, ...other.presence, editing: fresh ? other.presence.editing : null });
    }
    return replaced;
  }

  leave(peer: Peer): void {
    const member = this.members.get(peer);
    if (member) this.drop(peer, member);
  }

  /** Takes a connection out of the room, and tells the others that this person has gone if they ever heard of them. */
  private drop(peer: Peer, member: Member): void {
    this.members.delete(peer);
    if (member.presence) for (const other of this.members.keys()) other.send({ t: "presence", peer: member.peer, gone: true });
  }

  /**
   * What a person says about where they are, passed on to the others under the number of their connection, which a browser
   * cannot choose: nobody speaks for anybody else. It is kept in memory as the last word of that person (for whoever comes in
   * later) and nowhere else. It does not touch the design, the revision or the batch numbers, and nothing is answered. What
   * does not have the form it should is dropped without a word: it is not worth closing a connection over.
   *
   * ONE PERSON AT A TIME TYPES IN A TEXT BOX. Text typed into one box by two people at once is one value, of which one side
   * would be lost (ops.ts: the last writer wins). So whoever says first that they type in a box is the one, for as long as they
   * keep saying so: anybody who says the same of that box meanwhile is passed on, and remembered, as somebody who types in
   * nothing. The second browser hears that the first types there, as everybody does, and closes its own box (the editor does
   * that); the first never hears of the second's attempt. The order in which the server heard the two decides, so it is the same
   * for everybody. It cannot get stuck: it ends when the first says otherwise, leaves, or has not been heard of for
   * `PRESENCE_STALE_MS` (a browser that types repeats itself every few seconds). Somebody who only looks types in nothing and
   * has no selection.
   */
  private present(peer: Peer, member: Member, raw: unknown): void {
    const said = checkPresence(raw);
    if (typeof said === "string") return;
    const at = this.now();
    const state = canEdit(member.role) ? said : { ...said, selection: [], editing: null };
    // a person the server knows is heard under their account's name, never under one their browser claims
    if (member.name !== undefined) state.name = member.name;
    if (state.editing !== null) {
      for (const other of this.members.values()) {
        if (other !== member && other.presence?.editing === state.editing && at - other.heard <= PRESENCE_STALE_MS) state.editing = null;
      }
    }
    member.presence = state;
    member.heard = at;
    for (const other of this.members.keys()) if (other !== peer) other.send({ t: "presence", peer: member.peer, ...state });
  }

  /** The peers that have joined, so the host can close the connection of a client that has come back on another. */
  peers(): Peer[] {
    return [...this.members.keys()];
  }

  receive(peer: Peer, msg: ClientMsg): void | Promise<void> {
    const member = this.members.get(peer);
    if (!member) return;
    if (msg.t === "ping") peer.send({ t: "pong" });
    else if (msg.t === "ops") return this.receiveOps([{ peer, msg }]);
    else if (msg.t === "presence") this.present(peer, member, msg);
    else if (msg.t === "join") this.join(peer, member.client, member.role); // a client that wants the design again (what it understands is kept)
  }

  /**
   * GROUP COMMIT. Several batches, from one person or several, applied in the order given and saved with ONE write: the host hands
   * over whatever arrived while the last write ran, so that a room under many edits writes once per write's time, not once per edit.
   *
   * Nothing changes about what anybody is told, or when. Each batch is applied on top of the ones before it in the group, the way it
   * would have been on its own, and is checked against what they leave. The design they make together is saved, and only then is
   * anything taken over or said: every batch's answer and its operations to the others go out after that save, in the order of the
   * group, each with the revision it would have had alone. So nothing is acknowledged or passed on that is not on the disk.
   *
   * When the save fails, the room is as it was before the group, and every batch of the group that was to be applied is refused,
   * and so is the repeat of one of them in the same group (its first copy was never kept). An answer that did not depend on the
   * save (a refusal of a batch that was wrong, or the repeat of a batch saved before) is given either way. The error is thrown on.
   *
   * Except when the save refused the design only for its size (`DesignTooLarge`) and the group applied more than one batch: that
   * says nothing of each batch alone, and one that fits must not be refused because another came with it. Nothing has been
   * answered yet, so the batches are then taken again one at a time, each saved alone, as they were before group commit: those
   * that fit are kept, in order, and the one that would take the room past its limit is refused.
   */
  receiveOps(items: readonly { peer: Peer; msg: Extract<ClientMsg, { t: "ops" }> }[]): void | Promise<void> {
    let design = this.design;
    let kept: Memory = { seqs: this.lastSeq, seen: this.seen, floor: this.floor };
    // what each item is answered, in order: `saved` once the group is on the disk, `failed` if the save fails
    const answers: { saved: () => void; failed: () => void }[] = [];
    const applied: { peer: Peer; ops: Op[] }[] = [];
    const either = (send: () => void) => answers.push({ saved: send, failed: send });
    for (const { peer, msg } of items) {
      const member = this.members.get(peer);
      if (!member) continue; // went away before its turn: what it sent is not applied, as it would not have been alone
      const seq = msg.seq;
      const refuse = (reason: string) => either(() => peer.send({ t: "rejected", seq, reason }));
      if (!Number.isInteger(seq) || seq < 1) {
        either(() => peer.send({ t: "rejected", seq: Number(seq) || 0, reason: "a batch needs a number" }));
        continue;
      }
      if (member.role === "view") {
        refuse("this link is read-only");
        continue;
      }
      if (seq <= (kept.seqs.get(member.client) ?? kept.floor)) {
        // a repeat: of a batch saved before (always so), or of one earlier in this group (only so if the group is saved)
        const before = seq <= this.lastOf(member.client);
        const rev = this.rev + applied.length;
        answers.push({
          saved: () => peer.send({ t: "ack", seq, rev }),
          failed: () => peer.send(before ? { t: "ack", seq, rev: this.rev } : { t: "rejected", seq, reason: SAVE_FAILED }),
        });
        continue;
      }
      const ops = checkOps(msg.ops);
      if (typeof ops === "string") {
        refuse(ops);
        continue;
      }
      const next = applyOps(design, ops);
      // what the operations look like is fine; what they leave of the elements they changed is asked now that it is known
      // and whether this seat may do what they do: comment only, in its own name, change only its own words (src/collab/seats.ts)
      const account = member.account ? { ...member.account, name: member.name ?? "" } : undefined;
      const spoiled = checkSets(design, next, ops) ?? seatProblem(design, next, ops, { role: member.role, ...(account ? { account } : {}) }, this.restorable);
      if (spoiled) {
        refuse(spoiled);
        continue;
      }
      this.noteGone(design, next);
      design = next;
      kept = this.remember(member.client, seq, kept);
      applied.push({ peer, ops });
      const rev = this.rev + applied.length;
      answers.push({ saved: () => this.publish(peer, seq, rev, ops), failed: () => peer.send({ t: "rejected", seq, reason: SAVE_FAILED }) });
    }
    const settle = (how: "saved" | "failed") => {
      if (how === "saved" && applied.length) this.takeOver(design, kept);
      for (const answer of answers) answer[how]();
    };
    if (!applied.length || !this.commit) return settle("saved");
    const memory = { seen: Object.fromEntries(kept.seen), floor: kept.floor };
    return this.commit(design, this.rev + applied.length, Object.fromEntries(kept.seqs), memory).then(
      () => settle("saved"),
      (error: unknown) => {
        if (error instanceof DesignTooLarge && applied.length > 1) return this.oneByOne(items);
        settle("failed");
        throw error;
      },
    );
  }

  /** Notes the comments that a batch takes away (`gone`); the oldest are forgotten past `GONE_KEPT`. */
  private noteGone(before: Design, after: Design): void {
    if (!before.comments?.length || before.comments === after.comments) return;
    const left = new Set((after.comments ?? []).map((c) => c.id));
    for (const c of before.comments) {
      if (left.has(c.id)) continue;
      this.gone.delete(c.id);
      this.gone.set(c.id, c);
    }
    while (this.gone.size > this.goneKept) this.gone.delete(this.gone.keys().next().value as string);
  }

  /** Whether a comment is exactly one that left this room (`gone`): the same in every field, as JSON compares them. */
  private restorable: Restorable = (comment) => {
    const was = this.gone.get(comment.id);
    return was !== undefined && jsonEqual(was, comment);
  };

  /** The batches of a group that was too large to save at once, each applied and saved alone, in order (see `receiveOps`). */
  private async oneByOne(items: readonly { peer: Peer; msg: Extract<ClientMsg, { t: "ops" }> }[]): Promise<void> {
    let failure: unknown = null;
    for (const item of items) {
      try {
        await this.receiveOps([item]);
      } catch (error) {
        // that batch was refused (by its own `settle`); the ones after it go on, as separate writes would have
        failure ??= error;
      }
    }
    if (failure !== null) throw failure;
  }

  /** Takes over what a saved group made of the room: the design and what is remembered of the clients (the revision moves in `publish`). */
  private takeOver(design: Design, kept: Memory): void {
    this.design = design;
    // A client that joined while the save ran was welcomed with the number the room had for it then. If this group forgot it,
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
  }

  /** Tells the sender that its batch is in, at `rev`, and passes the batch on to everybody else. */
  private publish(peer: Peer, seq: number, rev: number, ops: Op[]): void {
    this.rev = rev;
    peer.send({ t: "ack", seq, rev });
    // A browser from before comments takes a kind of operation it does not know for a server that cannot be trusted, and ends its
    // session: it is sent the batch without them. It is still sent the batch, empty if need be, so that its revision moves on.
    // The same for one from before reviews.
    const cut = new Map<string, Op[]>();
    for (const [other, them] of this.members) {
      if (other === peer) continue;
      const kind = `${them.comments}/${them.review}`;
      let theirs = cut.get(kind);
      if (!theirs) cut.set(kind, (theirs = ops.filter((op) => (them.comments || !isCommentOp(op)) && (them.review || !isReviewOp(op)))));
      other.send({ t: "ops", rev, ops: theirs });
    }
    this.onChange?.(this);
  }
}

/** The most comments that left a room that it remembers, to let them come back with their page (`Room.gone`). */
export const GONE_KEPT = 5000;

/** What a browser is told of a batch that was to be applied when the write that should have kept it failed. */
export const SAVE_FAILED = "The server could not save this edit.";

/**
 * What `Room.commit` throws when it does not save a design only because the design is larger than a room may be. A group of
 * batches refused for this is taken again one batch at a time (`Room.receiveOps`), so that only a batch too large is refused.
 */
export class DesignTooLarge extends Error {
  constructor(message = "This shared design exceeds the room size limit.") {
    super(message);
    this.name = "DesignTooLarge";
  }
}

/** What the room remembers of its clients, as `remember` works it out. */
interface Memory {
  seqs: Map<string, number>;
  seen: Map<string, number>;
  floor: number;
}
