/**
 * Live editing in bad weather: several browsers edit one design at random while their connections are slow, drop and come back,
 * and the server now and then restarts from what it saved. Once everything has been delivered, every browser shows exactly the
 * server's design. Along the way, at every step, two things hold: what a browser shows is what it has confirmed with its own
 * unconfirmed changes on top, and what it has confirmed is exactly what the server had at that revision. Seeded, so a failure
 * names the seed and the step that reproduce it.
 */
import { describe, expect, it } from "vitest";
import { createDesign, createGroup, createPage, createShape, createText, solid } from "@/core/factory";
import type { Design, DesignElement, GroupElement, Page } from "@/core/types";
import { random, type Random } from "@/test/random";
import { designsEqual } from "./ops";
import type { ClientMsg, ServerMsg } from "./protocol";
import { Room, type Peer } from "./room";
import { Session, withShared } from "./session";

/* ---------------- random edits of a design: pure, and nothing like the library's own code ---------------- */

const COLORS = ["#ff0000", "#00aa00", "#0000ff", "#f5a623", "#222222"];

const flat = (list: readonly DesignElement[]): DesignElement[] => list.flatMap((e) => (e.type === "group" ? [e, ...flat(e.children)] : [e]));

/** The list with the element `id` (at any depth) replaced by `fn(it)`, or taken out when that is null. */
function mapElement(list: readonly DesignElement[], id: string, fn: (e: DesignElement) => DesignElement | null): DesignElement[] {
  return list.flatMap((e) => {
    if (e.id === id) {
      const made = fn(e);
      return made ? [made] : [];
    }
    return e.type === "group" ? [{ ...e, children: mapElement(e.children, id, fn) } as GroupElement] : [e];
  });
}

function randomEdit(d: Design, r: Random, fresh: () => string): Design {
  const page = r.pick(d.pages);
  const els = flat(page.elements);
  const inPage = (fn: (p: Page) => Page): Design => ({ ...d, pages: d.pages.map((p) => (p.id === page.id ? fn(p) : p)) });
  const onElement = (fn: (e: DesignElement) => DesignElement | null): Design => {
    if (!els.length) return d;
    const id = r.pick(els).id;
    return inPage((p) => ({ ...p, elements: mapElement(p.elements, id, fn) }));
  };
  const make = (): DesignElement =>
    r.next() < 0.7
      ? createShape("rect", { id: fresh(), x: r.int(900), y: r.int(500), width: 40 + r.int(200), height: 40 + r.int(100) })
      : createText({ id: fresh(), text: "Hi", x: r.int(900), y: r.int(500) });
  switch (r.int(17)) {
    case 0:
    case 1:
      return onElement((e) => ({ ...e, x: r.int(900), y: r.int(500) }));
    case 2:
      return onElement((e) => ({ ...e, width: 20 + r.int(300), rotation: r.pick([0, 45, 90]) }));
    case 3:
      return onElement((e) => (e.type === "shape" ? { ...e, fill: solid(r.pick(COLORS)) } : { ...e, opacity: r.pick([0.4, 1]) }));
    case 4:
      return inPage((p) => ({
        ...p,
        elements: [...p.elements.slice(0, r.int(p.elements.length + 1)), make(), ...p.elements.slice(r.int(p.elements.length + 1))].filter((e, i, all) => all.indexOf(e) === i),
      }));
    case 5: {
      const groups = els.filter((e): e is GroupElement => e.type === "group");
      if (!groups.length) return d;
      const g = r.pick(groups);
      return inPage((p) => ({ ...p, elements: mapElement(p.elements, g.id, (e) => ({ ...e, children: [...(e as GroupElement).children, make()] }) as GroupElement) }));
    }
    case 6:
    case 7:
      return onElement(() => null);
    case 8: {
      // bring one element of the page to another place in its list
      const list = page.elements;
      if (list.length < 2) return d;
      const from = r.int(list.length);
      const rest = list.filter((_, i) => i !== from);
      rest.splice(r.int(rest.length + 1), 0, list[from]);
      return inPage((p) => ({ ...p, elements: rest }));
    }
    case 9: {
      const members = r.some(page.elements, 3);
      if (members.length < 2) return d;
      const ids = new Set(members.map((m) => m.id));
      const at = Math.max(...page.elements.map((e, i) => (ids.has(e.id) ? i : -1)));
      const group = createGroup(members, { id: fresh(), x: 0, y: 0, width: 300, height: 100 });
      const rest = page.elements.filter((e) => !ids.has(e.id));
      rest.splice(Math.min(at - (members.length - 1), rest.length), 0, group);
      return inPage((p) => ({ ...p, elements: rest }));
    }
    case 10: {
      const groups = page.elements.filter((e): e is GroupElement => e.type === "group");
      if (!groups.length) return d;
      const g = r.pick(groups);
      return inPage((p) => ({ ...p, elements: p.elements.flatMap((e) => (e.id === g.id ? g.children : [e])) }));
    }
    case 11:
      return { ...d, pages: [...d.pages, createPage({ id: fresh(), elements: [make()] })] };
    case 12:
      return d.pages.length < 2 ? d : { ...d, pages: d.pages.filter((p) => p.id !== page.id) };
    case 13: {
      const pages = [...d.pages];
      const [moved] = pages.splice(r.int(pages.length), 1);
      pages.splice(r.int(pages.length + 1), 0, moved);
      return { ...d, pages };
    }
    case 14:
      return inPage((p) => ({ ...p, name: r.pick(["One", "Two", undefined]), background: solid(r.pick(COLORS)) }));
    case 15:
      return { ...d, title: r.pick(["A", "B", "C"]), width: r.pick([800, 1000, 1200]) };
    default:
      return onElement((e) => (e.shadow || e.blur ? { ...e, shadow: undefined, blur: undefined } : { ...e, blur: 3 }));
  }
}

/* ---------------- the network and the browsers on it ---------------- */

const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m)) as T;

class Browser {
  up: ClientMsg[] = [];
  down: ServerMsg[] = [];
  connected = false;
  shown: Design;
  session: Session;
  peer: Peer;
  counter = 0;
  resent = 0;
  welcomes = 0;
  private sentSeqs = new Set<number>();
  constructor(
    readonly id: string,
    initial: Design,
  ) {
    this.shown = initial;
    this.session = new Session({
      client: id,
      key: "k",
      send: (m) => {
        if (!this.connected) return;
        if (m.t === "ops") {
          if (this.sentSeqs.has(m.seq)) this.resent++;
          this.sentSeqs.add(m.seq);
        }
        this.up.push(wire(m));
      },
    });
    this.peer = {
      send: (m) => {
        if (this.connected) this.down.push(wire(m));
      },
    };
  }
  fresh = () => `${this.id}.${++this.counter}`;
}

function simulate(seed: number, browsers: number, steps: number) {
  const r = random(seed);
  const initial = createDesign({
    title: "Sim",
    width: 1000,
    height: 600,
    pages: [0, 1].map((p) => createPage({ id: `p${p}`, elements: [0, 1, 2].map((i) => createShape("rect", { id: `s${p}${i}`, x: i * 120, y: 50, width: 100, height: 50 })) })),
  });
  const history: Design[] = [initial];
  let room = new Room(initial);
  const hook = (rm: Room) => {
    rm.onChange = (x) => {
      history[x.rev] = x.design;
    };
  };
  hook(room);
  const all = Array.from({ length: browsers }, (_, i) => new Browser(`b${i}`, initial));
  const stats = { drops: 0, restarts: 0, edits: 0, resent: 0, welcomes: 0 };
  let step = 0;
  const fail = (what: string): never => {
    throw new Error(`seed ${seed}, step ${step}: ${what}`);
  };

  const connect = (b: Browser) => {
    b.connected = true;
    b.session.open();
  };
  const drop = (b: Browser) => {
    b.connected = false;
    b.up = [];
    b.down = [];
    room.leave(b.peer);
    b.session.close();
    stats.drops++;
  };
  const deliverUp = (b: Browser) => {
    const m = b.up.shift();
    if (!m) return;
    if (m.t === "join") room.join(b.peer, b.id, "edit");
    else room.receive(b.peer, m);
  };
  const deliverDown = (b: Browser) => {
    const m = b.down.shift();
    if (!m) return;
    if (m.t === "welcome") b.welcomes++;
    const out = b.session.receive(m);
    if (out.changed) b.shown = withShared(b.shown, b.session.design!);
  };
  const check = () => {
    for (const b of all) {
      const server = b.session.server;
      if (!server) continue;
      if (!designsEqual(server, history[b.session.rev])) fail(`${b.id}: what it has confirmed (revision ${b.session.rev}) is not what the server had then`);
      if (!designsEqual(b.shown, b.session.design!)) fail(`${b.id}: what it shows is not what it has confirmed with its own changes on top`);
    }
  };

  all.forEach(connect);
  for (; step < steps; step++) {
    const b = r.pick(all);
    const roll = r.next();
    if (roll < 0.4) {
      if (b.session.design) {
        const next = randomEdit(b.shown, r, b.fresh);
        if (next !== b.shown) {
          b.session.edit(b.shown, next);
          b.shown = next;
          stats.edits++;
        }
      }
    } else if (roll < 0.62) deliverUp(b);
    else if (roll < 0.84) deliverDown(b);
    else if (roll < 0.88) {
      for (let n = r.int(6); n > 0; n--) {
        deliverUp(b);
        deliverDown(b);
      }
    } else if (roll < 0.94) {
      if (b.connected) drop(b);
      else connect(b);
    } else if (roll < 0.945) {
      // the server restarts from what it saved; every connection is lost
      const saved = new Room(room.design, room.rev, room.seqs());
      for (const x of all) if (x.connected) drop(x);
      room = saved;
      hook(room);
      stats.restarts++;
    } else if (!b.connected) connect(b);
    check();
  }

  // peace: everyone is connected, and everything is delivered until nothing is left
  for (const b of all) if (!b.connected) connect(b);
  for (let round = 0; round < 10_000; round++) {
    let moved = false;
    for (const b of all) {
      if (b.up.length) {
        deliverUp(b);
        moved = true;
      }
      if (b.down.length) {
        deliverDown(b);
        moved = true;
      }
    }
    check();
    if (!moved) break;
    if (round === 9_999) fail("the messages never ran out");
  }
  for (const b of all) {
    if (b.session.status !== "live") fail(`${b.id} is ${b.session.status}`);
    if (b.session.pending) fail(`${b.id} still has ${b.session.pending} changes the server has not confirmed`);
    if (!designsEqual(b.shown, room.design)) fail(`${b.id} shows another design than the server's`);
    if (b.session.rev !== room.rev) fail(`${b.id} is at revision ${b.session.rev}, the server at ${room.rev}`);
    stats.resent += b.resent;
    stats.welcomes += b.welcomes;
  }
  if (!designsEqual(history[room.rev], room.design)) fail("the history of the server lost its last design");
  return { ...stats, rev: room.rev };
}

describe("live editing in bad weather", () => {
  it("ends with every browser showing the server's design, however the messages and connections behave", () => {
    const totals = { drops: 0, restarts: 0, edits: 0, resent: 0, welcomes: 0, rev: 0 };
    for (let seed = 1; seed <= 150; seed++) {
      const out = simulate(seed, 2 + (seed % 3), 140);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += out[k];
    }
    // the run was not a quiet one: connections dropped, servers restarted, batches were sent again, changes were really made
    expect(totals.edits).toBeGreaterThan(4_000);
    expect(totals.drops).toBeGreaterThan(800);
    expect(totals.restarts).toBeGreaterThan(50);
    expect(totals.resent).toBeGreaterThan(1_000);
    expect(totals.welcomes).toBeGreaterThan(800);
    expect(totals.rev).toBeGreaterThan(3_500);
  });

  it("also converges when only one browser is working and the connection keeps going away", () => {
    for (let seed = 1000; seed < 1040; seed++) simulate(seed, 1, 120);
  });

  it("also converges with many browsers working on the same few elements", () => {
    for (let seed = 2000; seed < 2020; seed++) simulate(seed, 6, 200);
  });
});
