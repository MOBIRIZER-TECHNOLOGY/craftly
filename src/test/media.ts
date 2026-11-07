/** `window.matchMedia` for jsdom, with an answer per query that a test can flip: `setMedia("(max-width: 899px)", true)`. */

const answers = new Map<string, boolean>();
const lists = new Set<{ query: string; fire(): void }>();

export function setMedia(query: string, matches: boolean): void {
  answers.set(query, matches);
  lists.forEach((l) => l.query === query && l.fire());
}

export function resetMedia(): void {
  answers.clear();
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const list = {
      get matches() {
        return answers.get(query) ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
      addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
      removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    lists.add({ query, fire: () => listeners.forEach((cb) => cb({ matches: list.matches, media: query } as MediaQueryListEvent)) });
    return list;
  };
}
