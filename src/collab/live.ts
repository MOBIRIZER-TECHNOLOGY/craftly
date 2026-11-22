/**
 * A browser's connection to a shared design: it opens the socket, joins, hands what arrives to the `Session`, sends what the person
 * changes, keeps the line alive with pings, and when the connection is lost comes back (waiting longer each time, with some jitter so
 * that a server that restarts is not met by every browser at the same moment) without losing a change. The socket is made by
 * `createSocket` (the browser's WebSocket by default), so tests can make one up.
 */
import type { Design } from "@/core/types";
import { m } from "@/i18n";
import type { PresenceHeard, PresenceState } from "./presence";
import type { ClientMsg, DeniedReason, Feature } from "./protocol";
import { Session, type Outbox } from "./session";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "denied" | "closed";

/** What `Live` needs of a WebSocket. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface LiveOptions {
  /** The address of the room: ws://host/ws?room=... The key is not in it, for every server and proxy that an address passes writes it in a log. */
  url: string;
  /** What lets this person in: shown in the first message of every connection. */
  key: string;
  /** A member's session in place of the key, for a room bound to a design of their team (`SessionOptions.session`). */
  session?: string;
  /** Names this page load to the server; another one is made when none is given. */
  client?: string;
  /** What this browser says in its join that it understands beyond what every version does (protocol.ts). */
  features?: Feature[];
  outbox?: Outbox;
  onOutbox?(outbox: Outbox): void;
  prepareEdit?(design: Design): Promise<void>;
  onRejected?(reason: string): void;
  onSendError?(reason: string): void;
  createSocket?: (url: string) => SocketLike;
  /** What to show has changed: read `live.design`. */
  onChange(): void;
  onStatus?(status: LiveStatus, reason: DeniedReason | null): void;
  /** Where another person in the room is, or that they have gone: what the server passed on, after it has been read. */
  onPresence?(heard: PresenceHeard): void;
}

const OPEN = 1;
const PING_EVERY_MS = 15_000;
const SILENCE_LIMIT_MS = 45_000;
const WAIT_MIN_MS = 500;
const WAIT_MAX_MS = 10_000;
/** The code the server closes a connection with when the same client has joined on another one (src/server/live.ts). */
const REPLACED = 4000;

/**
 * What `prepareEdit` rejects with when trying again cannot help (an image the server will never take, or one that is gone): the edit
 * is given up as one that the server refused, and the connection goes on. Any other error is taken for a passing one and tried again.
 */
export class PermanentSendError extends Error {}

const newName = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Live {
  status: LiveStatus = "connecting";
  denied: DeniedReason | null = null;
  readonly session: Session;
  private socket: SocketLike | null = null;
  private stopped = false;
  private everLive = false;
  private attempts = 0;
  /** an edit could not be prepared for sending and has not got through since */
  private stuck = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;
  private sends = Promise.resolve();

  constructor(private opts: LiveOptions) {
    const client = opts.outbox?.client ?? opts.client ?? newName();
    this.session = new Session({
      client,
      key: opts.key,
      session: opts.session,
      send: (msg) => this.send(msg),
      outbox: opts.outbox,
      onOutbox: opts.onOutbox,
      features: opts.features,
    });
  }

  /** Whether comments are shared with this server (`Session.sharesComments`): false until the welcome says so. */
  get sharesComments(): boolean {
    return this.session.sharesComments;
  }

  /** Whether reviews are shared with this server (`Session.sharesReview`): false until the welcome says so. */
  get sharesReview(): boolean {
    return this.session.sharesReview;
  }

  /** The design to show: what the server has confirmed with this person's unconfirmed changes on top. */
  get design(): Design | null {
    return this.session.design;
  }

  start(): void {
    if (this.stopped || this.socket) return;
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket ? this.opts.createSocket(this.opts.url) : (new WebSocket(this.opts.url) as unknown as SocketLike);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.sends = Promise.resolve();
    socket.onopen = () => {
      this.lastHeard = Date.now();
      this.session.open();
      this.startPings();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastHeard = Date.now();
      let heard: unknown;
      try {
        heard = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.hear(heard);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      // The server closes a connection this way when another one joins under the same name. This page did not make that other
      // one (it lets go of its socket before it opens the next), so it is another tab that started with a copy of what this tab
      // keeps for a reload, name and batch numbers included. Under one name the two would close each other's connection for good
      // and number different batches alike, of which the server applies only the first. This one goes on under a name of its own.
      if ((event as { code?: unknown } | null)?.code === REPLACED) this.session.rename(newName());
      this.lost();
    };
    socket.onerror = () => undefined;
  }

  /** Closes the connection for good. */
  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.stopPings();
    const socket = this.socket;
    this.socket = null;
    this.session.close();
    socket?.close();
    this.setStatus("closed");
  }

  /** A change this person made, as the design before it and after it. */
  edit(before: Design, after: Design): void {
    this.session.edit(before, after);
  }

  /** The number under which the others hear of this person: null while not in the room, and with a server that knows no presence. */
  get peer(): number | null {
    return this.session.status === "live" ? this.session.peer : null;
  }

  /** The name the server hears this person under whatever this browser says (an account's): null while not in the room, and for none. */
  get fixedName(): string | null {
    return this.session.status === "live" ? this.session.name : null;
  }

  /**
   * Says where this person is, at once and not behind the edits that wait for an image: whether it was said. It is said only in
   * the room, and only to a server that gave this connection a number: one from before there was presence would count the
   * messages against what this connection may send and pass none of them on. Nothing is kept: what is not said now is not said later.
   */
  present(state: PresenceState): boolean {
    if (this.peer === null || this.socket?.readyState !== OPEN) return false;
    this.send({ t: "presence", ...state });
    return true;
  }

  private send(msg: ClientMsg): void {
    const socket = this.socket;
    if (socket?.readyState !== OPEN) return;
    const prepare = this.opts.prepareEdit;
    if (msg.t !== "ops" || !prepare) {
      socket.send(JSON.stringify(msg));
      return;
    }
    this.sends = this.sends
      .then(async () => {
        if (socket !== this.socket) return;
        // Read when its turn has come, and without the batches made after it: a batch before this one may have been given up
        // meanwhile, and what a later batch needs is not a reason to hold this one back.
        const design = this.session.designAt(msg.seq);
        if (!design) return; // it left the queue while it waited here
        await prepare(design);
        if (this.stuck) {
          this.stuck = false;
          this.attempts = 0;
        }
        if (socket === this.socket && socket.readyState === OPEN) socket.send(JSON.stringify(msg));
      })
      .catch((error: unknown) => {
        if (socket !== this.socket) return;
        const reason = error instanceof Error ? error.message : m.core.sharedImageNotSent;
        if (error instanceof PermanentSendError) {
          // Trying again cannot help, and every edit behind this one would wait for it for ever. It is given up the way an edit
          // that the server refused is, the person is told the same way, and the connection stays for the rest.
          if (!this.session.drop(msg.seq)) return;
          this.opts.onRejected?.(reason);
          this.opts.onChange();
          return;
        }
        // The same edit is tried again after the next welcome. Until it gets through, a welcome does not bring the wait back to
        // the shortest, or a server that lets this browser in and then fails the upload would be asked twice a second for good.
        this.stuck = true;
        this.opts.onSendError?.(reason);
        socket.close();
        this.lost();
      });
  }

  private hear(heard: unknown): void {
    const outcome = this.session.receive(heard);
    if (outcome.ended) {
      this.denied = outcome.ended;
      this.stopPings();
      this.setStatus("denied", outcome.ended);
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      return;
    }
    if (outcome.joined) {
      if (!this.session.pending) this.stuck = false;
      if (!this.stuck) this.attempts = 0;
      this.everLive = true;
      this.setStatus("live");
    }
    if (outcome.presence) this.opts.onPresence?.(outcome.presence);
    if (outcome.rejected !== undefined) this.opts.onRejected?.(outcome.rejected);
    if (outcome.changed) this.opts.onChange();
  }

  /** The socket is gone: say so, and come back after a wait. */
  private lost(): void {
    this.socket = null;
    this.stopPings();
    this.session.close();
    if (this.stopped || this.status === "denied") return;
    this.setStatus(this.everLive ? "reconnecting" : "connecting");
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry) return;
    const wait = Math.min(WAIT_MAX_MS, WAIT_MIN_MS * 2 ** this.attempts) * (0.7 + Math.random() * 0.6);
    this.attempts++;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.start();
    }, wait);
  }

  private startPings(): void {
    this.stopPings();
    this.pinger = setInterval(() => {
      if (Date.now() - this.lastHeard > SILENCE_LIMIT_MS) {
        // the network went away without a word, as it does when a laptop sleeps or the wifi changes
        const socket = this.socket;
        if (socket) socket.onclose = null;
        socket?.close();
        this.lost();
        return;
      }
      this.send({ t: "ping" });
    }, PING_EVERY_MS);
  }

  private stopPings(): void {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
  }

  private setStatus(status: LiveStatus, reason: DeniedReason | null = null): void {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus?.(status, reason);
  }
}
