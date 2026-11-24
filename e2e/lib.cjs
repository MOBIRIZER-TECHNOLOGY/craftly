/* Shared helpers for the browser journeys: finds a local Chrome / Edge / Chromium and launches it with playwright-core. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  const hit = CANDIDATES.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("No Chrome, Edge or Chromium found. Set CHROME_PATH to the browser executable.");
  return hit;
}

/**
 * The engine the journeys run in: Chrome (the default, a local install), or `BROWSER=firefox` / `BROWSER=webkit` for the builds
 * that `npx playwright-core install firefox webkit` downloads (WebKit is the engine of Safari, not Safari itself).
 */
const ENGINE = (process.env.BROWSER || "chromium").toLowerCase();
if (!["chromium", "chrome", "firefox", "webkit"].includes(ENGINE)) throw new Error(`BROWSER=${ENGINE}: use chromium, firefox or webkit`);
const isChromium = ENGINE === "chromium" || ENGINE === "chrome";

function engine() {
  const pw = require("playwright-core");
  return isChromium ? pw.chromium : pw[ENGINE];
}

/** Launches the browser; set HEADED=1 to watch it. */
async function launch() {
  return engine().launch({ ...(isChromium ? { executablePath: findChrome() } : {}), headless: !process.env.HEADED });
}

/** Launches the browser with a profile folder that survives between runs (used when something big is worth keeping, like a downloaded model). */
async function launchPersistent(userDataDir, options = {}) {
  return engine().launchPersistentContext(userDataDir, { ...(isChromium ? { executablePath: findChrome() } : {}), headless: !process.env.HEADED, ...options });
}

/** A fresh folder (with trailing separator) for screenshots and downloads of one journey. */
function outDir(name) {
  const dir = path.join(process.env.E2E_OUT || path.join(os.tmpdir(), "craftly-e2e"), name) + path.sep;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const BASE = (process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");

/**
 * A link to a shared design asks before it connects to a server that is new in this browser ("Join this shared design?"): this
 * says yes when it asks, and does nothing when the page went on by itself (a server that is known, a design that was joined before).
 * Returns whether it was asked.
 */
async function joinIfAsked(page, ms = 10000) {
  const join = page.getByRole("button", { name: "Join", exact: true });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await join.isVisible().catch(() => false)) {
      await join.click();
      return true;
    }
    // the editor, or the page that says why the link does not work: nothing was asked
    if (!page.url().includes("#/join/") || (await page.getByText("This shared design could not be opened").count())) return false;
    await page.waitForTimeout(100);
  }
  return false;
}

/**
 * Whether the server of `page` serves the app's sources (the dev server does; a production build answers every path with its
 * page). Asked with fetch, which says nothing in the console: an `import()` that fails logs "Failed to load module script" as a
 * console error even when the journey catches it, and the journeys fail on console errors.
 */
function servesSource(page) {
  return page
    .evaluate(async () => {
      const res = await fetch("/src/i18n/en/index.ts", { cache: "no-store" });
      return res.ok && /javascript/.test(res.headers.get("content-type") || "");
    })
    .catch(() => false);
}

module.exports = { launch, launchPersistent, outDir, joinIfAsked, servesSource, BASE, ENGINE, isChromium };
