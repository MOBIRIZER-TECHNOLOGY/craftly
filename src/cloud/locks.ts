/**
 * The locks that keep tabs out of each other's way (docs/ACCOUNTS.md, "The engine"): `craftly-sync`, held by the one tab that
 * syncs, and `craftly-design-<id>`, held by an editor while the design is open, which sync leaves alone meanwhile. They are the
 * browser's Web Locks, shared by every tab of the site. Where a browser has none (and in the tests), they hold within this page.
 */

interface LockLike {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
  query?(): Promise<{ held?: Array<{ name?: string }> }>;
}

const locks = (): LockLike | null => {
  const found = (globalThis.navigator as { locks?: LockLike } | undefined)?.locks;
  return found && typeof found.request === "function" ? found : null;
};

/** What this page holds where there are no Web Locks. */
const heldHere = new Set<string>();

export const SYNC_LOCK = "craftly-sync";
export const designLock = (id: string) => `craftly-design-${id}`;

/** Takes the lock as soon as it is free and holds it until the returned function is called (or the page goes). */
export function holdLock(name: string): () => void {
  return acquireLock(name).release;
}

/**
 * `holdLock`, and also when the lock is taken: `acquired` resolves once it is held (at once where there are no Web Locks), or when
 * the request fails or it is released before it was ever held.
 */
export function acquireLock(name: string): { release: () => void; acquired: Promise<void> } {
  const browser = locks();
  if (!browser) {
    heldHere.add(name);
    return { release: () => void heldHere.delete(name), acquired: Promise.resolve() };
  }
  let release: () => void = () => undefined;
  let released = false;
  let taken: () => void = () => undefined;
  const acquired = new Promise<void>((resolve) => (taken = resolve));
  const held = new Promise<void>((resolve) => {
    release = () => {
      released = true;
      taken();
      resolve();
    };
  });
  void browser
    .request(name, {}, () => {
      taken();
      return released ? Promise.resolve() : held;
    })
    .catch(() => undefined)
    .finally(taken);
  return { release: () => release(), acquired };
}

/** Runs `work` holding the lock when it is free now; null, without running it, when somebody holds it. */
export async function tryLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  const browser = locks();
  if (!browser) {
    if (heldHere.has(name)) return null;
    heldHere.add(name);
    try {
      return await work();
    } finally {
      heldHere.delete(name);
    }
  }
  let ran = false;
  const result = await browser.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    ran = true;
    return work();
  });
  return ran ? (result as T) : null;
}

/** The names of the locks held now, by any tab. */
export async function heldLocks(): Promise<Set<string>> {
  const browser = locks();
  if (!browser?.query) return new Set(heldHere);
  try {
    const state = await browser.query();
    return new Set((state.held ?? []).map((lock) => lock.name ?? "").filter(Boolean));
  } catch {
    return new Set();
  }
}
