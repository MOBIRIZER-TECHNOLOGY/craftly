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

/** Launches the browser; set HEADED=1 to watch it. */
async function launch() {
  const { chromium } = require("playwright-core");
  return chromium.launch({ executablePath: findChrome(), headless: !process.env.HEADED });
}

/** Launches the browser with a profile folder that survives between runs (used when something big is worth keeping, like a downloaded model). */
async function launchPersistent(userDataDir, options = {}) {
  const { chromium } = require("playwright-core");
  return chromium.launchPersistentContext(userDataDir, { executablePath: findChrome(), headless: !process.env.HEADED, ...options });
}

/** A fresh folder (with trailing separator) for screenshots and downloads of one journey. */
function outDir(name) {
  const dir = path.join(process.env.E2E_OUT || path.join(os.tmpdir(), "craftly-e2e"), name) + path.sep;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const BASE = (process.env.BASE || "http://127.0.0.1:5173").replace(/\/$/, "");

module.exports = { launch, launchPersistent, outDir, BASE };
