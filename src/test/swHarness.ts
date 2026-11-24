/**
 * Runs `public/sw.js` outside a browser: the file is plain script that talks to `self`, `caches` and `fetch`, so it is
 * evaluated with stand-ins for those three (an in-memory Cache Storage that keeps the order caches were made in, a
 * network that can be switched off, and a worker scope that records what it was asked to do) in a `node:vm` context
 * that has only those, `URL` and `Response`. Its listeners are then fired by hand, the way the browser fires them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { vi } from "vitest";

export const ORIGIN = "http://localhost";

const absolute = (input: string | Request): string => new URL(typeof input === "string" ? input : input.url, `${ORIGIN}/`).href;

/** The files a server would answer with, and a switch for "no connection". */
export class FakeNetwork {
  online = true;
  readonly calls: string[] = [];
  private readonly files = new Map<string, () => Response>();

  /** Answers GET `path` with `body`. A function makes a fresh response for each request. */
  serve(path: string, body: string | (() => Response), type = "text/plain"): this {
    this.files.set(path, typeof body === "function" ? body : () => new Response(body, { status: 200, headers: { "content-type": type } }));
    return this;
  }

  async fetch(input: string | Request): Promise<Response> {
    const url = absolute(input);
    this.calls.push(url);
    if (!this.online) throw new TypeError("Failed to fetch");
    const make = this.files.get(new URL(url).pathname);
    return make ? make() : new Response("not found", { status: 404 });
  }
}

export class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly network: FakeNetwork) {}

  async add(request: string | Request): Promise<void> {
    const response = await this.network.fetch(request);
    if (!response.ok) throw new TypeError(`Request failed: ${response.status}`);
    this.entries.set(absolute(request), response);
  }
  async addAll(requests: Array<string | Request>): Promise<void> {
    for (const request of requests) await this.add(request);
  }
  async put(request: string | Request, response: Response): Promise<void> {
    this.entries.set(absolute(request), response);
  }
  async match(request: string | Request): Promise<Response | undefined> {
    return this.entries.get(absolute(request))?.clone();
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: string | Request): Promise<boolean> {
    return this.entries.delete(absolute(request));
  }
}

/** Cache Storage: names come back in the order the caches were made, and `match` looks in all of them. */
export class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly network: FakeNetwork) {}

  async open(name: string): Promise<FakeCache> {
    let store = this.stores.get(name);
    if (!store) this.stores.set(name, (store = new FakeCache(this.network)));
    return store;
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async match(request: string | Request): Promise<Response | undefined> {
    for (const store of this.stores.values()) {
      const hit = await store.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

export interface WorkerOptions {
  buildId?: string;
  network?: FakeNetwork;
  /** pass the caches of an earlier worker to play an update over the same storage */
  caches?: FakeCaches;
}

type Listener = (event: unknown) => void;

export interface Worker {
  network: FakeNetwork;
  caches: FakeCaches;
  buildId: string;
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  /** fire "install" and wait for everything the worker handed to waitUntil */
  install(): Promise<void>;
  /** fire "activate" and wait for everything the worker handed to waitUntil */
  activate(): Promise<void>;
  /** fire "message"; `port` plays the MessageChannel port a page sends along */
  message(data: unknown, port?: { postMessage: (value: unknown) => void }): void;
  /** fire "fetch": the response the worker chose, or undefined when it let the browser handle the request */
  request(url: string, init?: { method?: string; mode?: string; headers?: Record<string, string>; cache?: RequestCache }): Promise<Response | undefined>;
  /** the listeners it registered */
  listening(): string[];
}

/** Evaluates sw.js the way the build stamps it (the build id replaces `__BUILD_ID__`) and hands back its controls. */
export function loadWorker(options: WorkerOptions = {}): Worker {
  const buildId = options.buildId ?? "build1";
  const network = options.network ?? new FakeNetwork();
  const caches = options.caches ?? new FakeCaches(network);
  const listeners = new Map<string, Listener[]>();
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const scope = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    skipWaiting,
    clients: { claim },
  };
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8").replaceAll("__BUILD_ID__", buildId);
  runInNewContext(source, { self: scope, caches, fetch: (input: string | Request) => network.fetch(input), URL, Response }, { filename: "sw.js" });

  const extendable = async (type: string) => {
    const pending: Array<Promise<unknown>> = [];
    for (const listener of listeners.get(type) ?? []) listener({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };

  return {
    network,
    caches,
    buildId,
    skipWaiting,
    claim,
    install: () => extendable("install"),
    activate: () => extendable("activate"),
    message(data, port) {
      for (const listener of listeners.get("message") ?? []) listener({ data, ports: port ? [port] : [] });
    },
    async request(url, init = {}) {
      const request = new Request(new URL(url, `${ORIGIN}/`).href, { method: init.method ?? "GET", headers: init.headers, cache: init.cache });
      // a Request made here has the mode "cors": navigations need it said
      const shaped = init.mode ? Object.defineProperty(request, "mode", { value: init.mode }) : request;
      let answer: Promise<Response> | undefined;
      for (const listener of listeners.get("fetch") ?? []) listener({ request: shaped, respondWith: (promise: Promise<Response>) => (answer = promise) });
      return answer;
    },
    listening: () => [...listeners.keys()],
  };
}
