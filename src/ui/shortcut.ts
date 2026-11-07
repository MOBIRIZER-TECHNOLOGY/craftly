/**
 * Keyboard shortcut display helpers.
 *
 * Shortcuts are written the way the editor's hotkeys module names them
 * ("Ctrl+Shift+Z", "Ctrl+]", "Delete", "Shift+Arrow Up"). "Ctrl", "Cmd" and "Mod" all mean the
 * platform's primary modifier: shown as the Command key on macOS and as Ctrl elsewhere.
 */

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform || nav.userAgent);
}

const MAC_KEYS: Record<string, string> = {
  ctrl: "⌘",
  cmd: "⌘",
  command: "⌘",
  mod: "⌘",
  meta: "⌘",
  control: "⌃",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  enter: "↵",
  return: "↵",
  backspace: "⌫",
  delete: "⌦",
  del: "⌦",
  esc: "Esc",
  escape: "Esc",
  tab: "⇥",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  "arrow up": "↑",
  "arrow down": "↓",
  "arrow left": "←",
  "arrow right": "→",
};

const PC_KEYS: Record<string, string> = {
  ctrl: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  mod: "Ctrl",
  control: "Ctrl",
  meta: "Win",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  enter: "Enter",
  return: "Enter",
  backspace: "Backspace",
  delete: "Del",
  del: "Del",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  "arrow up": "↑",
  "arrow down": "↓",
  "arrow left": "←",
  "arrow right": "→",
};

function splitKeys(shortcut: string): string[] {
  const s = shortcut.trim();
  if (!s) return [];
  // "Ctrl++" means Ctrl and the plus key.
  const parts = s.endsWith("++") ? [...s.slice(0, -2).split("+"), "+"] : s.split("+");
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Splits a shortcut into display labels, one per key cap: "Ctrl+Shift+Z" -> ["Ctrl", "Shift", "Z"]. */
export function shortcutKeys(shortcut: string): string[] {
  const table = isMacPlatform() ? MAC_KEYS : PC_KEYS;
  return splitKeys(shortcut).map((key) => {
    const mapped = table[key.toLowerCase()];
    if (mapped) return mapped;
    return key.length === 1 ? key.toUpperCase() : key;
  });
}

/** Single-string rendering: "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatShortcut(shortcut: string): string {
  const keys = shortcutKeys(shortcut);
  return isMacPlatform() ? keys.join("") : keys.join("+");
}

/** Value for `aria-keyshortcuts` ("Control+Shift+Z Meta+Shift+Z"). */
export function ariaShortcut(shortcut: string): string {
  const keys = splitKeys(shortcut).map((key) => {
    const k = key.toLowerCase();
    if (k === "ctrl" || k === "cmd" || k === "mod" || k === "command" || k === "control") return "\0primary";
    if (k === "esc") return "Escape";
    if (k === "del") return "Delete";
    if (k === "arrow up" || k === "up") return "ArrowUp";
    if (k === "arrow down" || k === "down") return "ArrowDown";
    if (k === "arrow left" || k === "left") return "ArrowLeft";
    if (k === "arrow right" || k === "right") return "ArrowRight";
    return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  });
  const hasPrimary = keys.includes("\0primary");
  if (!hasPrimary) return keys.join("+");
  const render = (modifier: string) => keys.map((k) => (k === "\0primary" ? modifier : k)).join("+");
  return `${render("Control")} ${render("Meta")}`;
}
