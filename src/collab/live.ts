/**
 * A browser's connection to a shared design: it opens the socket, joins, hands what arrives to the `Session`, sends what the person
 * changes, keeps the line alive with pings, and when the connection is lost comes back (waiting longer each time, with some jitter so
 * that a server that restarts is not met by every browser at the same moment) without losing a change. The socket is made by
 * `createSocket` (the browser's WebSocket by default), so tests can make one up.
 */
import type { Design } from "@/core/types";
import type { ClientMsg, DeniedReason } from "./protocol";
import { Session } from "./session";

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
  /** The whole address, with the room and the key in it: ws://host/ws?room=...&key=... */
  url: string;
  /** Names this page load to the server; another one is made when none is given. */
  client?: string;
  createSocket?: (url: string) => SocketLike;
  /** What to show has changed: read `live.design`. */
  onChange(): void;
  onStatus?(status: LiveStatus, reason: DeniedReason | null): void;
}

const OPEN = 1;
const PING_EVERY_MS = 15_000;
const SILENCE_LIMIT_MS = 45_000;
const WAIT_MIN_MS = 500;
const WAIT_MAX_MS = 10_000;

const newName = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Live {
  status: LiveStatus = "connecting";
  denied: DeniedReason | null = null;
  readonly session: Session;
  private socket: SocketLike | null = null;
  private stopped = false;
  private everLive = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastHeard = 0;

  constructor(private opts: LiveOptions) {
    const client = opts.client ?? newName();
    this.session = new Session({ client, send: (msg) => this.send(msg) });
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
    socket.onopen = () => {
      this.lastHeard = Date.now();
      this.session.open();
      this.startPings();
    };
    socket.onmessage = (event) => {
      this.lastHeard = Date.now();
      let heard: unknown;
      try {
        heard = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.hear(heard);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
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

  private send(msg: ClientMsg): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(msg));
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
      this.attempts = 0;
      this.everLive = true;
      this.setStatus("live");
    }
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
